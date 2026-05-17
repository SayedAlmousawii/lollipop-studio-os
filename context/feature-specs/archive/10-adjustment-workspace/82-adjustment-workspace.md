# 82 — Adjustment Workspace

## Goal

Introduce an **Adjustment Workspace**: a staged, operational editing layer that sits between "editing the customer's order" and "creating immutable accounting records." Replaces the current behavior where every post-lock line edit immediately produces a new ADJ invoice. Staff can freely add, remove, swap, and re-quantify items during a single customer conversation; only on **Finalize** does the system emit one consolidated ADJ document (positive, negative, or zero-net).

This preserves invoice immutability and audit safety while eliminating ADJ-document explosion, premature manager approval, and accounting noise leaking into operational UX.

## Read First

Items under `archive/` are **historical reference for context only** — they describe shipped behavior to integrate with, not active specs to extend. The active code in `server/services/` and the current schema are authoritative.

- `context/reviews/ui-ux-cleanup-post-financialhardening/ux-03.md` — source planning document
- `context/architecture-summary.md` — invoice / ADJ / order header relationships (authoritative)
- `context/feature-specs/archive/09-financial-stabilization/79a-adjustment-cause-ledger-and-paid-reversal.md` — historical: ADJ cause/reversal model
- `context/feature-specs/archive/09-financial-stabilization/79d-pos-reductive-edit-manager-prompt.md` — historical: existing manager-approval-on-reduction path (this spec relocates it)
- `context/feature-specs/archive/09-financial-stabilization/80b-invoice-lock-snapshot-and-db-immutability.md` — historical: locked-invoice immutability contract
- `context/feature-specs/archive/09-financial-stabilization/81c-canonical-order-header-settlement-summary.md` — historical: operational summary surface

## Rules

- The locked invoice remains **immutable**. Nothing in this feature modifies a posted invoice or its lines.
- The workspace itself is **not an accounting document**. It has no document number, never appears in revenue/AR reports, and is invisible to accounting views.
- Only **one open workspace per locked invoice** at any time. Sequential workspaces are allowed across the order's lifetime.
- The old "edit on a locked invoice → immediate ADJ" path is **removed**. The workspace is the only post-lock edit path.
- Manager approval evaluation happens **only at Finalize**, never during in-workspace edits.
- Approval rule: required **iff the finalized net total decreases** vs. the pre-workspace effective total, where "net total" means the **post-discount, tax-inclusive customer-payable amount**. Item-level swaps that net to zero on this basis do not require approval.
- **Takeover authorization**: only users with the manager role can take over a workspace open by another user. Cashiers cannot.
- **Cancellation authorization**: the current workspace owner OR any manager can cancel an open workspace.
- **Parent invoice voided/refunded while workspace open**: the workspace is auto-cancelled with a `parent_invoice_voided` event logged; the cancel is system-initiated.
- A zero-net workspace with non-empty edits still emits an ADJ document (composition record). A workspace with no edits is a true no-op.
- Payments are **not** recorded inside the workspace. Payment posting happens against the issued ADJ after finalize.
- All in-workspace edits log to an event stream for forensics; only the finalized net result becomes an accounting record. Cancelled workspaces retain the event log.

## Scope

### In Scope

- New entity `AdjustmentWorkspace` and child `AdjustmentWorkspaceEvent`
- Workspace lifecycle: `open → finalized | cancelled` (+ takeover semantics)
- Backend service: workspace open/edit/finalize/cancel/takeover operations
- Finalize compute: net delta calculation → emit one consolidated ADJ (positive, negative, zero-net) or no-op
- Removal of the current immediate-ADJ-on-locked-edit code path
- Locked-invoice operational UI: read-only gate + "Open Adjustment Workspace" CTA
- Workspace UI: composition diff, pending additions/removals, live balance delta, lightweight advisory chip when finalize would require approval, Finalize / Cancel / (Take Over) actions
- Operational "effective composition" computation = base locked composition + cumulative finalized ADJs
- Operational dashboards surface open workspaces; accounting / revenue reports do **not**
- Manager-approval gate at the Finalize step (replaces / relocates the 79d immediate-reduction prompt)
- Refund-pending flag emission when finalize produces a credit-note while the parent invoice is fully paid

### Out of Scope

- Actual refund issuance (cash, voucher, store credit). Workspace emits the credit note + refund-pending flag only; downstream refund/voucher feature handles disbursement.
- Discount, tax, or payment-term edits inside the workspace.
- Pre-lock POS editing (unchanged).
- Restructuring of locked invoices, ADJ chain, or credit-note primitives themselves.
- Wallet / store-credit / voucher systems (future).
- Partial-fulfillment-aware swap math (production already started on a line). v1 warns and allows; deeper guard is future work.

## Implementation Direction

### 1. Data model

Add two new tables:

`adjustment_workspaces`
- `id` (uuid, pk)
- `invoice_id` (fk → invoices, the locked parent)
- `order_id` (fk → orders, denormalized for query)
- `status` (`open` | `finalized` | `cancelled`)
- `opened_by_user_id`, `opened_at`
- `last_activity_at`
- `current_owner_user_id` (for takeover; nullable, defaults to opener)
- `version` (int, default 0) — optimistic-lock counter incremented on every mutating service call; clients must echo the last seen version on `applyEdit` / `finalizeWorkspace` / `cancelWorkspace`. Mismatch → reject with conflict error.
- `base_snapshot_json` — shape defined below
- `pending_changes_json` — shape defined below
- `finalized_adjustment_invoice_id` (nullable, set on finalize)
- `cancelled_reason` (nullable; system writes `parent_invoice_voided` when auto-cancelled)
- Unique partial index: `(invoice_id) WHERE status = 'open'` — enforces single open workspace per invoice.

`adjustment_workspace_events`
- `id`, `workspace_id` (fk), `actor_user_id` (nullable for system events), `at`
- `event_type` (`opened` | `edit_added` | `edit_removed` | `edit_modified` | `package_swapped` | `taken_over` | `finalized` | `cancelled` | `parent_invoice_voided`)
- `payload_json` (before/after for the affected line(s))

Schema change to existing `orders` table:
- Add `refund_pending` (boolean, default `false`). Set to `true` when a workspace finalize emits a negative-net ADJ against a fully-paid parent. Cleared by the downstream refund/voucher feature (out of scope).

Both new tables live outside the accounting/AR query surface. Do **not** expose them via existing invoice/AR endpoints.

**`base_snapshot_json` shape** — full operational composition captured at open-time, sufficient to render and to diff against:

```ts
{
  capturedAt: ISO8601,
  lines: Array<{
    lineId: string,           // stable id from effective composition
    kind: 'package' | 'item' | 'addon',
    refId: string,            // package/item/addon catalog id
    label: string,
    quantity: number,
    unitPrice: Money,         // post-discount unit price
    lineTotalGross: Money,    // pre-tax
    lineTotalNet: Money,      // post-discount, tax-inclusive (customer-payable)
    taxBreakdown: Array<{ code: string, amount: Money }>
  }>,
  totals: {
    gross: Money,             // pre-tax
    discount: Money,
    tax: Money,
    netPayable: Money         // authoritative basis for approval comparison
  }
}
```

`Money` = the existing project Money type (do not invent a new one).

**`pending_changes_json` shape** — discriminated union of staged edits, applied in order. The orchestrator never mutates `base_snapshot_json`; it only appends/edits/removes entries here.

```ts
{
  edits: Array<Edit>
}

type Edit =
  | { id: string, op: 'add_line',       kind: 'item' | 'addon', refId: string, quantity: number }
  | { id: string, op: 'remove_line',    targetLineId: string }                   // targets a base line
  | { id: string, op: 'modify_quantity', targetLineId: string, newQuantity: number }
  | { id: string, op: 'swap_package',   fromPackageRefId: string, toPackageRefId: string }
  | { id: string, op: 'swap_addon',     targetLineId: string, toAddonRefId: string }
```

Each `Edit.id` is client-stable so the same edit can be modified or removed before finalize. `swap_*` ops are **first-class** (not paired add+remove) so the net-delta algorithm can recognize zero-net swaps without composition tricks.

### 2. Backend services

New module: `server/services/adjustment-workspace/` (mirror existing service-layer conventions used by the invoice and ADJ services).

Core operations:
- `openWorkspace(invoiceId, userId)` — guards: invoice must be locked, no open workspace exists. Captures `base_snapshot_json` from current effective composition.
- `applyEdit(workspaceId, userId, edit)` — mutates `pending_changes_json`, appends an event. Recomputes net delta server-side (do not trust client totals).
- `takeOverWorkspace(workspaceId, userId)` — flips `current_owner_user_id`, appends `taken_over` event. Allowed for any authenticated staff; logged for audit.
- `cancelWorkspace(workspaceId, userId, reason?)` — flips status, appends event. No accounting artifact.
- `finalizeWorkspace(workspaceId, userId, approvalContext?)` — the only path that touches accounting:
  1. Recompute net delta from `pending_changes_json` against `base_snapshot_json`.
  2. If no edits → no-op, flip status, return.
  3. If net total decreases → require `approvalContext` (manager-approved). Reject otherwise.
  4. Build one ADJ invoice (positive, negative, or zero-net composition record) via the existing ADJ creation primitives. Link `finalized_adjustment_invoice_id`.
  5. If parent invoice is fully paid AND ADJ net is negative → set a `refund_pending` flag on the order (downstream refund feature consumes this).
  6. Flip status to `finalized`, append `finalized` event.

The finalize path must be transactional: ADJ emission + workspace status flip + event log must commit together or roll back together.

### 3. Removal of the old path

Delete the code path that creates an ADJ invoice on direct post-lock line edits. The locked-invoice editing UI becomes read-only and surfaces the workspace CTA instead. The 79d "POS reductive-edit manager prompt" relocates to the Finalize step — preserve the prompt component but move its trigger.

### 4. Effective composition computation

A single helper (server-side, also exposed for UI read) computes the **operational reality** of an order by folding the base invoice composition with each finalized ADJ in chronological order:

```
effective_composition(order):
  state = composition_from(base_locked_invoice)        // same shape as base_snapshot_json.lines
  for adj in finalized_adjustments(order) ordered by created_at:
    for entry in adj.lines:                             // ADJ lines are signed
      apply_signed_entry(state, entry)
  return state
```

ADJ line entries are **signed**: a positive entry adds quantity / introduces a new line; a negative entry reduces quantity / removes a line. Zero-net swap ADJs contain a paired negative + positive entry on the same composition slot. The apply rule:

- Match by `(kind, refId)` against existing state lines. If a match exists, sum quantities; if quantity drops to zero, drop the line.
- If no match exists and the signed quantity is positive, append a new line.
- A negative entry that has no matching state line is an integrity error → reject (should never occur if ADJs are emitted via this feature's finalize path).

This algorithm is the **single source of truth** for both:
- rendering the operational composition on the order page, and
- capturing `base_snapshot_json` at workspace open.

Accounting views continue to render the underlying invoice + ADJ chain unchanged; they never call this helper.

### 5. Net-delta algorithm (finalize)

At Finalize, the service produces one ADJ from `base_snapshot_json` + `pending_changes_json`. Steps:

1. **Apply edits to a working copy of the base snapshot**, in `edits[]` order, using the same apply rules as above but at the snapshot level. Each edit produces a `proposedComposition`.
2. **Compute per-line deltas** by diffing `proposedComposition` against `base_snapshot_json.lines`, keyed by `(kind, refId)`. Each delta has a signed `quantityDelta` and resulting signed `lineTotalNetDelta`.
3. **Recognize swaps**: a `swap_package` or `swap_addon` edit emits **paired** signed entries on the ADJ (one negative, one positive) rather than being collapsed into net add/remove. This preserves audit clarity for zero-net swaps.
4. **Compute totals delta**:
   - `grossDelta`, `discountDelta`, `taxDelta`, `netPayableDelta` — each is `proposedTotals - baseTotals` using the project's existing money math.
5. **Approval check**: `requiresManagerApproval = netPayableDelta < 0`. The basis is **post-discount, tax-inclusive customer-payable** — i.e. `totals.netPayable` from the snapshot/proposed composition. No other basis is consulted.
6. **Branch the ADJ emission**:
   - `netPayableDelta > 0` → positive ADJ
   - `netPayableDelta < 0` → negative ADJ (credit note semantics)
   - `netPayableDelta == 0 && edits.length > 0` → zero-net ADJ recording the signed line entries
   - `edits.length == 0` → no-op (no ADJ)
7. **Refund-pending**: if `netPayableDelta < 0` AND parent invoice fully paid → set `orders.refund_pending = true` in the same transaction.

The whole sequence runs server-side inside one DB transaction; client-supplied totals are advisory only and never trusted.

### 6. UI surfaces

**UI architecture (read before building):**

The workspace is **not** a mode flag on the existing POS/order page, and it is **not** a full duplicate of that page. Implement it as a **dedicated surface that shares leaf components with the POS page but has its own orchestrator**.

- **Shared (reuse existing components):** line row, item picker, package selector, add-on list, quantity stepper, price display primitives. Bug fixes and design tweaks happen once.
- **Distinct (workspace-only):** route / top-level panel, state container, edit handlers (stage into `pending_changes_json` rather than commit-through), diff view, advisory chip, finalize / cancel / takeover controls, base-snapshot rendering.
- **Do not** add a `mode === 'workspace'` branch to existing POS edit handlers. Pre-lock POS commits immediately; workspace stages. Mixing those rules in one orchestrator creates conditional spaghetti and a fragile state machine.

Concretely: the locked-invoice order page stays as the entry point (read-only effective composition + CTA). "Open Adjustment Workspace" routes to (or opens a full-screen panel rendering) a dedicated workspace component tree with its own state. That component tree imports the same leaf UI building blocks the POS page uses.

Locked-invoice order page (operational):
- Read-only composition view rendering the **effective composition**.
- If no open workspace: primary CTA "Open Adjustment Workspace".
- If open workspace by current user: CTA "Resume Workspace".
- If open workspace by other user: banner "Workspace open by {name} since {time}". A "Take Over" action is rendered **only for users with the manager role**; cashiers see the banner without the action.

Workspace screen:
- Top: small advisory chip area (right-aligned, single-line). When pending net is negative, render `Manager approval required on finalize`. No modal, no large banner.
- Left column: original (frozen) composition with subdued styling.
- Right column: working composition with inline add/remove/qty/package-swap controls.
- Footer: live net delta (`+`, `-`, or `0`), Finalize / Cancel buttons. Finalize is **disabled only when there are zero edits** (a true no-op). Finalize is **enabled** for zero-net composition changes (e.g. equal-priced swaps) — those still produce a zero-net ADJ recording the composition change. Cancel is available to the current owner or any manager.
- Finalize confirmation surfaces the consolidated diff and (if applicable) the manager-approval prompt inline.

Operational dashboard / order list:
- Open-workspace indicator (chip) on the order row.
- Filter: "Has open workspace".

Accounting / revenue views:
- No surface changes. Workspaces are invisible here.

### 7. Approval routing

Reuse the existing manager-approval mechanism. The advisory chip is purely informational client-side; the authoritative check runs server-side inside `finalizeWorkspace`. Server rejects finalize attempts that require approval but lack `approvalContext`.

### 8. Implementation order

Build in this order. Each phase must be exercisable (manually or by tests) before the next begins. The old immediate-ADJ-on-edit path is **removed last** so post-lock editing is never broken mid-deploy.

1. **Schema** — migrations for `adjustment_workspaces` and `adjustment_workspace_events`, including the partial unique index on `(invoice_id) WHERE status = 'open'`. Down-migration included.
2. **Effective composition helper** — server-side function computing `base + cumulative finalized ADJs`. Pure, easily unit-tested. Used by both the locked-invoice read view and workspace base-snapshot capture.
3. **Workspace lifecycle service (no finalize)** — `openWorkspace`, `applyEdit`, `cancelWorkspace`, `takeOverWorkspace`. Event logging wired up. No accounting side-effects yet.
4. **Finalize service + ADJ emission** — `finalizeWorkspace` with transactional ADJ emission, net-delta math, zero-net/positive/negative branching, `refund_pending` flag on fully-paid parents. **Server-side approval-requirement check is stubbed in this phase**: the service computes `requiresManagerApproval` and rejects unapproved finalizes, but the UI prompt is not yet wired — phase 7 connects the real prompt.
5. **Locked-invoice operational UI gate** — read-only effective composition, "Open / Resume / Take Over" CTAs (take-over visible to managers only), open-by-other banner. At this point the old immediate-ADJ path still exists as a fallback.
6. **Workspace UI (dedicated surface)** — orchestrator, diff view, advisory chip, finalize/cancel controls. Wired to the lifecycle and finalize services. Manual end-to-end pass.
7. **Approval-prompt UI relocation** — wire the 79d manager-approval prompt into the Finalize confirmation step (not the immediate-reduction trigger). The server-side check from phase 4 already exists; this phase only moves the **UI prompt component** to its new trigger point and ensures the same approval primitive still works.
8. **Remove the old immediate-ADJ-on-edit path** — delete the code path, switch the locked-invoice UI to read-only-only (no fallback). Regression test confirms no ADJ is emitted from direct line edits.
9. **Operational dashboard surfaces** — open-workspace chip on order rows, "Has open workspace" filter. Verify accounting/revenue reports are untouched.
10. **Observability + post-implementation docs** — metrics counters, audit-log query views, architecture/UI summary updates, progress tracker entry.

Tests (next section) are written incrementally per phase, not deferred to the end.

### 9. Tests

- Unit: net-delta computation across additions / removals / swaps / quantity changes / package swap.
- Unit: approval requirement evaluation (decrease → required; zero-net swap → not required; increase → not required).
- Integration: open → multiple edits → finalize emits exactly one ADJ document.
- Integration: open → edits → cancel emits zero ADJ documents; event log retained.
- Integration: refund-pending flag set iff parent fully paid AND finalize net negative.
- Integration: concurrency — second open attempt on same invoice rejected; takeover succeeds and logs event.
- Integration: zero-net swap emits a zero-net ADJ document recording the composition change.
- Regression: removed immediate-ADJ-on-edit path no longer produces ADJ on locked-invoice line edits.

## Observability Checklist

### Dashboards / Metrics

- Counter: workspaces opened, finalized, cancelled (per day, per user).
- Counter: finalized ADJs broken down by `positive | negative | zero_net`.
- Counter: takeover events (signal of contention or workflow problems).
- Counter: refund-pending flags emitted.
- Gauge: currently-open workspaces (operational dashboard).
- Audit log: every workspace event row queryable by invoice / order / user / date.

### Rollback Plan

- Schema: drop `adjustment_workspaces` and `adjustment_workspace_events` via down-migration.
- Code: re-enable the removed immediate-ADJ-on-edit path (kept in git history; not behind a flag).
- Data: no non-recoverable data — workspaces never produced accounting records on their own; the ADJ documents they emit are independent and valid post-rollback.
- Caveat: if rolled back while workspaces are open, those drafts are lost (their pending edits do not auto-convert to ADJs). Document this risk; recommend draining open workspaces before rollback.

### Customer-Visible Surface

- No direct customer-facing change. Customers see fewer, cleaner ADJ documents on their order over time.
- Staff: post-lock editing flow changes substantially. Training note required.
- Managers: receive fewer interruption-style approval prompts; approval requests now batch at finalize.

## Post-Implementation

- Update `context/architecture-summary.md` with the operational-vs-accounting split and the workspace entity.
- Update `context/ui-context-summary.md` with the workspace screen and locked-invoice gating.
- Update `context/progress-tracker.md` on completion.
- Add memory entry summarizing the architectural decision (workspace as operational layer, immutability preserved).

## Acceptance Criteria

- Locked invoices cannot be edited directly; the only post-lock edit path is via an `AdjustmentWorkspace`.
- Only one workspace can be open per locked invoice at a time; second open attempt is rejected with a clear error; takeover succeeds and logs an event.
- A workspace session with N in-session edits produces **exactly one** ADJ document on finalize (positive, negative, or zero-net) — never N.
- A workspace finalized with no net change and no edits produces zero ADJ documents.
- A workspace finalized with a net decrease requires manager approval; finalize rejects without it.
- A workspace finalized with net negative against a fully-paid parent invoice sets the order's `refund_pending` flag.
- All operational views render effective composition; accounting views are unchanged.
- Open workspaces appear on operational dashboards and never in revenue/AR reports.
- Cancelled workspaces produce zero accounting artifacts and retain their event log.
- The removed immediate-ADJ-on-edit code path is gone; regression test confirms it no longer fires.
- `npm run build` passes.
- `npm run lint` passes.
