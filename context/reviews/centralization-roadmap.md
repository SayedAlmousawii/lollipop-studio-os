# Studio OS Centralization Roadmap — Final PR-by-PR Plan

Generated: 2026-05-19
Sources: `context/reviews/centralization-inventory.md`, `context/reviews/centralization-visual-plan.md`

This document is the implementation contract that supersedes the visual plan for sequencing. The inventory and visual plan remain as background analysis; this file is what feature specs derive from.

---

## 1. Final Architecture Decision

### Core principle

There is **one financial truth per FinancialCase**, but **many surface-specific projections** of it.

The canonical read layer is **not** a single one-size-fits-all DTO that every UI renders verbatim. It is:

- **One core read model** — `FinancialCaseSummary` — owns the financial math: invoice total, effective paid, deposit applied, remaining, overpaid/refund capacity, linked documents, status classification.
- **Surface-specific projector functions** — pure mappers in the service layer — each take `FinancialCaseSummary` and produce the shape a specific UI needs: header chip, financial-tab block, sales sidebar, payment dialog, orders table row, booking page, invoice list row.

Surfaces are allowed (encouraged) to render different fields, copy, badges, and density. They are **not** allowed to recompute the math, parse formatted money, or assemble totals from partial invoice/order rows.

```text
FinancialCase (DB)
        │
        ▼
FinancialCaseSummary   ← single source of truth (math + status)
        │
   ┌────┼─────────┬──────────────┬────────────────┬────────────┐
   ▼    ▼         ▼              ▼                ▼            ▼
header  financial sales sidebar  payment dialog   orders table booking page
chip    tab       projection     projection       projection   projection
projection projection
```

The same principle applies to:

- **OrderCompositionViewModel** — one composition truth, projected for draft POS, locked POS, current-composition card, overview tab, production tab.
- **Edit-mode policy** — one rule engine, projected as `blockedReason` + `routeTarget` + `requiresApproval` + `userFacingMessage` per surface.
- **Workflow policies** — one rule engine per workflow area (booking / editing / production / delivery), projected as available actions, blockers, labels per surface.

### What this changes vs the visual plan

The visual plan's mermaid arrow `OrderDetailsVM → Header / Financials / Sales / Sidebars / BookingPage / OrderTable / Tabs / Dialogs` is **misleading** if read as "every consumer takes the same DTO". The correction:

- `getOrderDetailsView(orderId)` is for the **order details page only**. It composes section-specific projections internally.
- Other surfaces (orders table, booking page, payment dialog) take their **own** projector function of the underlying canonical read model — not the order-details view.

### Boundaries that stay untouched

Write services remain authoritative. Read models never bypass write services for mutations. Pages and components never read DB directly.

---

## 2. Ordered Feature Specs (PR-by-PR)

Each spec is a single PR. Each PR is shippable on its own, behind a temporary discrepancy log if the swap risks parity issues. No spec rewrites a write service.

### Spec Splitting Note

R0–R12 remain the **strategic roadmap** — the architectural sequence is what matters. At drafting time, several roadmap items are split into sub-specs so each PR has a single coherent surface, single review scope, and single parity-testing target:

| Roadmap item | Drafted as |
|---|---|
| R1 | R1a (core summary + R2-needed projectors + discrepancy logger) + R1b (remaining projectors) |
| R3 | R3a (header + orders table) + R3b (booking page — booking-stage projection) |
| R7 | R7a (core composition view model + metadata) + R7b (projectors + adjustment-workspace adapter) |
| R8 | R8a (draft sidebar + POS package composition) + R8b (add-on marketplace) + R8c (overview + production deliverables) |
| R10 | R10a (booking) + R10b (editing) + R10c (production) + R10d (delivery) |

R2, R4, R5, R6, R9, R11, R12 ship as single specs. Net: roughly 20 feature specs across the roadmap.

The descriptions below remain at the roadmap level (Rn). Each Rn-with-splits row in the table above expands into its sub-specs only when the actual feature spec file is drafted.

### Spec R1 — `FinancialCaseSummary` read model + projectors (no UI changes)

> **Drafted as R1a + R1b.** R1a: core `getFinancialCaseSummary` + the two projectors R2 needs (`toFinancialTabBlock`, `toSalesSidebarLocked`) + discrepancy logger + reconciliation wiring. R1b: remaining 5 projectors (header, draft sidebar, payment dialog, orders table, booking page, invoice list) as R3 prep.

**Goal:** Add the canonical financial read model and its surface projectors. Do not swap any UI yet.

**Deliverables:**
- `src/modules/financial-cases/financial-case-summary.service.ts` — `getFinancialCaseSummary(financialCaseId | orderId | bookingId)`.
- `src/modules/financial-cases/projections/` — one pure projector per surface:
  - `toOrderHeaderFinancial.ts`
  - `toFinancialTabBlock.ts`
  - `toSalesSidebarLocked.ts` / `toSalesSidebarDraft.ts`
  - `toPaymentDialogContext.ts`
  - `toOrdersTableRow.ts`
  - `toBookingPageFinancial.ts`
  - `toInvoiceListRow.ts`
- Each projector returns a typed DTO matching what its surface needs (different shapes per surface).
- Math sources: `invoice.service`, `payment.service`, `invoice.calculation.ts`, `order-settlement.ts` — re-used, not duplicated.
- Discrepancy logger that compares each projector to the existing legacy derivation when called via a wrapper (used in R2–R5).

**Acceptance:**
- No call sites consume the new service yet.
- Unit tests cover deposit-applied, credit-noted, refunded, overpaid, multi-document, missing-FinancialCase fallback states.
- Snapshot of each projector for 8–10 representative orders matches legacy computed values.

---

### Spec R2 — Swap Financials tab + Sales locked sidebar to projectors

**Goal:** First UI swap. Highest-value, lowest-risk surfaces (already use service data, just inconsistent).

**Deliverables:**
- `app/orders/[orderId]/page.tsx` Financials tab consumes `toFinancialTabBlock` projection.
- Sales locked sidebar consumes `toSalesSidebarLocked` projection.
- Remove `deriveOrderDetailsFinancialSummary` from the page.
- Keep the discrepancy logger live; remove it in R6.

**Acceptance:**
- Header vs Financials tab discrepancy log (`order_details.financials_tab.header_discrepancy`) goes silent for the swapped surfaces.
- Visual parity confirmed on draft, locked, locked+adjustment, refunded, overpaid orders.

---

### Spec R3 — Swap order header, orders table, booking page financial readouts

> **Drafted as R3a + R3b.** R3a: header + orders table (same `summarizeInvoices` / `mapPaymentStatus` removal path). R3b: booking page (consumes the booking-stage projection — different shape, different invariants, separate parity-test fixture).

**Goal:** Bring all read-only financial badges/labels onto the same source.

**Deliverables:**
- Order header cards in `app/orders/[orderId]/page.tsx` use `toOrderHeaderFinancial`.
- `src/components/orders/orders-table.tsx` uses `toOrdersTableRow` — and stops parsing formatted money strings.
- `app/bookings/[bookingId]/page.tsx` uses `toBookingPageFinancial`; remove "package total minus deposit" arithmetic.
- `summarizeInvoices()` + `mapPaymentStatus()` in `order.service.ts` are removed (or reduced to a thin adapter that calls the new projection).

**Acceptance:**
- One canonical "payment status" enum drives every badge.
- The `booking.page.package_balance` legacy field is no longer rendered.

---

### Spec R4 — Centralize money formatting + remove string parsing

**Goal:** One formatter; no UI parses formatted money.

**Deliverables:**
- `src/lib/formatting/money.ts` — `formatMoney(amount, { currency, density })` and `parseMoneyInput(raw)` for forms.
- Replace formatting from: `financial-sidebar-primitives.tsx`, `financial-format.ts`, `order-settlement-summary.tsx`, `pos-record-payment-dialog.tsx`, `configuration-summary-chip.tsx`, `credit-note-approval-fields.tsx`, `current-composition-card.tsx`, service-layer `formatMoney()` helpers.
- Delete the formatted-string parsing in `orders-table.tsx` (already gone after R3, verify).

**Acceptance:**
- One `formatMoney` import path across the repo.
- No `parseFloat(invoice.remainingAmount)` style calls remain.

---

### Spec R5 — Move direct DB reads out of server actions and pages

**Goal:** Restore the service-only DB boundary.

**Deliverables:**
- Move direct `db` reads from `app/orders/[orderId]/actions.ts` (`resolveConfigureSessionRoute`, `recordUpgradePaymentAction` parsing of remaining amount, etc.) into service helpers.
- Move direct `db` reads from `app/bookings/new/page.tsx` into a booking loader service.
- Server actions only call service functions; they never `import { db }`.

**Acceptance:**
- Grep `from "@/lib/db"` (or equivalent) in `app/` returns zero results outside service-only allowed paths.

---

### Spec R6 — Remove discrepancy loggers, declare financial swap complete

**Goal:** Confirm parity; lock in the new layer.

**Deliverables:**
- Remove the temporary discrepancy logger.
- Add an invariant test asserting projections derive only from `FinancialCaseSummary` (no other inputs).
- Remove `getOrderFinancialSummary` shims if any remain.

**Acceptance:**
- No legacy financial summary derivation paths exist outside `financial-case-summary.service.ts`.

---

### Spec R7 — `OrderCompositionViewModel` + projectors (no UI changes)

> **Drafted as R7a + R7b.** R7a: core view model (base / effective / pending) with structured `displayKind` / `fromLabel` / `toLabel` metadata replacing label parsing. R7b: surface projectors (`toDraftPOSComposition`, `toLockedPOSComposition`, `toCurrentCompositionCard`, `toOverviewTab`, `toProductionDeliverables`) + rewrite of `derivePOSWorkspaceFromAdjustmentWorkspace()` as a thin adapter. POS workspace byte-equivalence is the key risk in R7b.

**Goal:** Same pattern as R1, applied to composition.

**Deliverables:**
- `src/modules/orders/composition/order-composition.service.ts` exposes:
  - `baseComposition`, `effectiveComposition` (post-finalized-adjustments), `pendingAdjustmentComposition`
  - `packageLines`, `addOns`, `extraPhotos`, `sessionConfigurations`, `deliverables`, `totals`
  - Structured metadata on adjustment lines (`displayKind`, `fromLabel`, `toLabel`) so `buildCompositionView()` does **not** parse labels.
- Projectors: `toDraftPOSComposition`, `toLockedPOSComposition`, `toCurrentCompositionCard`, `toOverviewTab`, `toProductionDeliverables`.
- `derivePOSWorkspaceFromAdjustmentWorkspace()` becomes a thin adapter over the new model.

**Acceptance:**
- POS workspace output is byte-equivalent to legacy for a snapshot of representative orders.
- `composition-view.model.ts` parses no labels; metadata-driven only.

---

### Spec R8 — Swap composition consumers

> **Drafted as R8a + R8b + R8c.** R8a: draft sidebar + POS package composition (photo helpers move from `pos-package-composition.tsx` into the service-layer projector). R8b: add-on marketplace (counts + category filters consume the projector). R8c: order overview tab + production deliverables (switch from `OrderDetail.packageLines` to `effectiveComposition`). Each consumer has its own regression surface.

**Goal:** Move POS draft sidebar, current composition card, overview tab, production tab onto the new projectors.

**Deliverables:**
- `financial-sidebar-draft.tsx` consumes `toDraftPOSComposition` for preview totals — no client math.
- `pos-package-composition.tsx` photo preview helpers move into the service-layer projector, leaving the component as a pure renderer.
- `pos-add-on-marketplace.tsx` consumes the projector for add-on counts/category filters.
- Order overview uses `effectiveComposition`, not `OrderDetail.packageLines`.

**Acceptance:**
- Removing `buildPhotoLineDraft`, `resolveBillingMode`, `getPhotoLinePreview`, `resolvePhotoPayload` from `pos-package-composition.tsx` does not change behavior.

---

### Spec R9 — `OrderEditModePolicy`

**Goal:** Centralize locked / draft / adjustment edit rules and messaging.

**Deliverables:**
- `src/modules/orders/policies/edit-mode-policy.ts` returning `{ mode, canEditDirectly, shouldOpenAdjustmentWorkspace, requiresManagerApproval, blockedReason?, routeTarget? }`.
- Consumers: `financial-sidebar-draft.tsx`, `pos-package-composition.tsx`, `pos-add-on-marketplace.tsx`, `app/orders/[orderId]/actions.ts` route resolver, `app/orders/[orderId]/adjustment-workspace/actions.ts` stage schema selector.
- Service-layer write guards (`assertDirectPOSMutationAllowed`, etc.) keep authority; the policy reads the same rules so messages cannot drift.

**Acceptance:**
- Locked notices in three POS components come from one source.
- The configure-session route classification is policy-driven, not action-local.

---

### Spec R10 — Workflow policy builders

> **Drafted as R10a + R10b + R10c + R10d**, one per workflow area: R10a booking (`buildBookingWorkflowPolicy` + `booking-status-actions.tsx`), R10b editing (`buildEditingWorkflowPolicy` + `editing-workflow-form.tsx`), R10c production (`buildProductionWorkflowPolicy` + `production-workflow-form.tsx`), R10d delivery (`buildDeliveryWorkflowPolicy` + `delivery-workflow-form.tsx`, including FinancialCaseSummary-sourced payment settlement in `mapOrderDeliveryWorkflow()`). Each has its own service, form, and state matrix.

**Goal:** Centralize action availability + labels for booking, editing, production, delivery.

**Deliverables:**
- `buildBookingWorkflowPolicy`, `buildEditingWorkflowPolicy`, `buildProductionWorkflowPolicy`, `buildDeliveryWorkflowPolicy`.
- Return: available actions, blocked actions + reasons, required dependencies, next-status labels, manager-override requirement.
- Wired into: `booking-status-actions.tsx` (replace `STATUS_ACTIONS`), `editing-workflow-form.tsx`, `production-workflow-form.tsx`, `delivery-workflow-form.tsx`.
- `mapOrderDeliveryWorkflow()` reads payment settlement from the FinancialCaseSummary, not `summarizeInvoices()`.

**Acceptance:**
- No component hardcodes a workflow action list.
- Removing a transition in the policy disables it everywhere.

---

### Spec R11 — `getOrderDetailsView(orderId)` orchestrator (last)

**Goal:** Now that the underlying models exist, collapse the order-details loader stitching.

**Deliverables:**
- One service: `getOrderDetailsView(orderId)` returns `{ header, overview, selection, editing, production, delivery, financials, sales, sessionConfigurations, editMode }` — each field is the relevant projector output.
- `app/orders/[orderId]/page.tsx` calls only this service and threads section DTOs into tabs.
- The old loaders (`getOrderHubById`, etc.) remain internal helpers behind the orchestrator.

**Acceptance:**
- The page has zero financial / composition / status derivation code.
- Tabs receive their DTO and render — no business logic.

---

### Spec R12 — Cleanup pass

**Goal:** Remove compatibility paths only after invariants prove safety.

**Deliverables:**
- Remove `getOrderSettlementInvoices()` order-invoice fallback if all reads go through FinancialCase.
- Remove `summarizeInvoices()` if zero call sites remain.
- Remove dead `confirm gating` logic in `booking-status-actions.tsx`.
- Delete `mapBookingDetail()` deposit-invoice dedup once mixed-attachment historical data is verified clean.

**Acceptance:**
- Invariant suite passes with fallback paths removed.

---

## 3. Risk Controls

| Risk | Control |
|---|---|
| Projection diverges from legacy derivation | R1 ships discrepancy logger; R2–R5 keep it on; R6 removes only after silence on production data |
| Swap breaks a surface mid-rollout | Each spec is one PR with parity snapshot tests on representative orders (draft / locked / adjusted / refunded / overpaid) |
| Adjustment composition label parsing regressions | R7 introduces structured metadata **alongside** label parsing; flip cutover only once metadata covers all line kinds |
| Edit-mode policy disagrees with service guards | R9 policy reads the same rule predicates the service guards already use; one shared predicate module |
| Workflow policy hides a transition that service still allows | R10 has a contract test: every action service-side maps to exactly one policy entry |
| Money formatter migration drops a locale/edge case | R4 lands the formatter first as additive; migration is a separate commit per surface area |
| Pages still touch DB after R5 | Add a lint rule banning `@/lib/db` imports from `app/**` (except a whitelisted internal `_loaders/` path if needed) |
| Composition projector breaks POS writes | R7 is read-only; R8 swaps consumers; writes never call the projector |
| Order-details orchestrator becomes a god-service | R11 is last on purpose — it only composes existing projectors, owns no math |

**Always-on controls:**
- No spec changes Prisma schema.
- No spec changes invoice/payment/refund/adjustment **write** behavior.
- Every spec ships with a regression test suite addition; no spec deletes tests.
- A `npm run test:backend-invariants` pass is required before any R6+ removal.

---

## 4. Tests Needed Per Spec

| Spec | Tests |
|---|---|
| R1 | Unit: `getFinancialCaseSummary` for deposit, deposit+credit, refund, overpaid, missing FinancialCase fallback. Snapshot: each projector against 8–10 fixture orders. |
| R2 | Visual-parity snapshot for Financials tab + locked sidebar. Discrepancy log silenced on fixture orders. |
| R3 | Snapshot tests for header, orders table row, booking page. Badge enum mapping test. |
| R4 | Unit tests for `formatMoney` (KD, zero, negative, decimals). Grep test asserting no other money formatters exist. |
| R5 | Lint rule test: `app/**` does not import `@/lib/db` outside whitelist. Service-loader contract tests for migrated helpers. |
| R6 | Invariant test: projectors take only `FinancialCaseSummary` as input. |
| R7 | Snapshot of POS workspace before/after for fixture orders. Composition metadata coverage test (no label parsing path executed). |
| R8 | Render tests for draft sidebar / POS modules using fixture projector output. Removal-of-helper tests verifying old fns are unused. |
| R9 | Policy unit tests for all `{ orderState × invoiceLock × adjustmentState × editType }` permutations. Contract test: policy.blockedReason aligns with service-guard rejection message. |
| R10 | Per-workflow policy state-table tests. Contract test: every workflow service action has exactly one policy entry. |
| R11 | Integration test rendering each tab from `getOrderDetailsView` fixture. Page-level "no business logic" assertion (no math, no formatting). |
| R12 | Full backend-invariants suite + reconciliation pass with fallbacks removed. |

---

## 5. What Must Not Be Touched Yet

These are the do-not-touch boundaries for the entire roadmap (R1–R12):

**Write services:**
- `invoice.service.ts` create/recalc/adjust/credit
- `payment.service.ts` allocation/recording
- `refund.service.ts`
- `adjustment-workspace.service.ts` finalize/stage write paths
- `session-configuration-selection.service.ts` writes
- `booking.service.ts` deposit recording / check-in

**Schema & migrations:**
- No Prisma schema change for this roadmap. If a projector wants metadata that doesn't exist, capture the gap and propose a separate schema spec — do not stuff it into a read-model PR.

**Financial formulas:**
- Credit-note capacity (`computeCreditNoteCapacityForFinal`), overpayment capacity (`computeOverpaymentCapacity`), refund capacity rules — all stay byte-for-byte identical. Projectors expose them; nobody redefines them.

**FinancialCase fallback paths:**
- The order-invoice fallback in `getOrderSettlementInvoices()` and the booking/case dedup in `mapBookingDetail()` stay until **R12**, and only after backfill verification proves no live flow needs them.

**Adjustment workspace and direct POS write separation:**
- Do not merge them. R7/R8 unify the **read** view model; writes remain split.

**Workflow status enums:**
- `OrderStatus`, `BookingStatus`, `PaymentType`, `InvoiceType`, `InvoiceStatus`, the transition maps — frozen for the duration of this roadmap.

---

## 6. Discussion — Open Questions Before Spec Drafting

These are items that should be decided with the owner before R1 is drafted. Drift here is the most likely source of rework later.

### 6.1 Projection ownership: `src/modules/financial-cases/` or `src/modules/financial/`?

The inventory uses both. The `modules/financial/` folder already exists for `edit-classifier.ts` and `invariant-catalog.ts`. Proposal: put the **summary service** in `modules/financial-cases/` (entity-scoped) and **projectors** in `modules/financial-cases/projections/`. Keep `modules/financial/` for cross-entity rules.

### 6.2 What does `FinancialCaseSummary` return for a booking with no Job yet (pre-check-in)?

A confirmed-but-not-checked-in booking has FinancialCase + Deposit Invoice + Payment, but no Order and no Final Invoice. Today, `booking.page.package_balance` answers this with bespoke arithmetic. The new summary must define the "no final invoice" state explicitly — likely `remaining = null`, `status = 'awaiting_final_invoice'`, with `depositSettled = true`.

### 6.3 Discrepancy logger lifetime

R1 ships it. R2–R5 rely on it. R6 removes it. Should it also be wired into nightly reconciliation as an invariant for the swap period? Recommended yes, since real production data has more variety than fixtures.

### 6.4 Order details orchestrator vs surface projectors — is R11 even needed?

Once R2/R3/R8/R9/R10 have shipped, the order-details page may already be thin enough. R11 may collapse into a janitorial commit rather than a real spec. Reassess after R10.

### 6.5 Composition metadata migration

R7 wants stable `displayKind`/`fromLabel`/`toLabel` on adjustment lines so the view model stops parsing labels. Two options:
- **(a)** Persist metadata at finalize time (schema change → outside this roadmap).
- **(b)** Compute metadata at read time from existing FK columns and line type (no schema change).
Recommendation: **(b)** for the roadmap; revisit (a) if (b) leaves edge cases that still need label heuristics.

### 6.6 Booking page financial readout — keep it or remove it?

The booking page shows a "package remaining balance" today that is conceptually pre-FinancialCase. After R3, do we keep it as a "deposit settled / awaiting final invoice" projection, or hide the financial summary entirely until check-in produces a Final Invoice? Owner decision.

### 6.7 Lint rule for DB imports in `app/**`

R5 proposes banning `@/lib/db` imports from `app/`. Some legitimate cases (auth guard, dev-reset scripts) might need exceptions. Need an allowlist convention (e.g., `app/**/_loaders/`) agreed before R5.

---

## 7. Context-File Cleanup Before R1

To prevent AI agents from following stale rules during implementation, the following context files need updating **before R1 starts**. This is a separate prep PR (call it **R0**).

### R0 deliverables (no code, docs only)

1. **`context/architecture-summary.md`** — add a new section "Canonical Read Layer" stating:
   - `FinancialCaseSummary` is the single financial truth for read.
   - Surface projectors live in `modules/financial-cases/projections/`.
   - Pages and components must not recompute totals.
   - Same pattern is forthcoming for composition and policies.

2. **`context/architecture-context.md`** — add the projector pattern to the module-ownership and folder-structure tables. Mark old patterns (`summarizeInvoices`, `deriveOrderDetailsFinancialSummary`, page-level math) as **deprecated, do not use in new code**.

3. **`context/code-standards-summary.md`** — add rules:
   - "Do not compute money in components or pages."
   - "Do not parse formatted money strings."
   - "Do not import `@/lib/db` from `app/**`."
   - "New financial display surfaces require a projector in `modules/financial-cases/projections/`."

4. **`context/ai-workflow-summary.md`** — add to "Default Reads" the new `context/reviews/centralization-roadmap.md` (this file) until the roadmap is complete.

5. **`context/progress-tracker.md`** — add a "Now" entry referencing this roadmap and the active spec.

6. **`context/feature-specs/SPEC_TEMPLATE.md`** — add a checklist item: "Does this spec consume `FinancialCaseSummary` / `OrderCompositionViewModel` / policies instead of recomputing?"

7. **Archive obsolete reviews** — move `context/reviews/centralization-inventory.md` and `context/reviews/centralization-visual-plan.md` into `context/reviews/archive/15-centralization/` once R0 lands, leaving this roadmap as the live document. (Inventory and visual plan are background, not implementation guides — separating them prevents agents from following the visual plan's misleading "one DTO" diagram.)

8. **Delete or rewrite duplicated guidance** — scan `context/reviews/` for any older "use this loader" notes that contradict the projector pattern; either remove or annotate as superseded.

### R0 acceptance

- An agent reading only the "Default Reads" set in `ai-workflow-summary.md` can correctly answer: "Where should I add a new financial badge?" with "Add a projector in `modules/financial-cases/projections/`, do not compute in the component."
- Archived analysis docs no longer appear in default reads.

---

## 8. Recommended Execution Order

```text
R0  Context cleanup (docs only)
R1  FinancialCaseSummary + projectors (read-only, no UI swap)
R2  Swap Financials tab + Sales locked sidebar
R3  Swap header / orders table / booking page
R4  Money formatter
R5  Move DB reads out of app/
R6  Remove discrepancy logger, lock in financial layer
R7  OrderCompositionViewModel + projectors (read-only)
R8  Swap composition consumers
R9  OrderEditModePolicy
R10 Workflow policy builders
R11 getOrderDetailsView orchestrator (only if still needed)
R12 Cleanup compatibility paths
```

R0 is the gate. R1–R6 form the financial-layer block. R7–R8 form the composition block. R9–R10 form the policy block. R11–R12 are wrap-up.

---

## 8.5 Spec Drafting Notes (read this before drafting any Rn spec)

These notes capture decisions and architectural nuance that future spec authors (including fresh Claude sessions) must carry. If the spec doesn't reflect them, it's wrong.

### Approved architectural decisions (binding)

1. **Folder:** `src/modules/financial-cases/` is the home for FinancialCase-scoped read models and projectors. `src/modules/financial/` stays for cross-entity rules (classifier, invariants, reconciliation).
2. **Booking-stage projection:** for confirmed bookings with no Final Invoice yet, the summary returns booking-stage fields (`depositPaid`, `awaitingFinalInvoiceAfterCheckIn`, `finalInvoicePending`). Do not synthesize a final-invoice state.
3. **Discrepancy logger:** R1a ships it; it is also wired into nightly reconciliation during R1–R6. R6 removes both.
4. **R11 orchestrator:** not forced. Reassess after R10; may become janitorial.
5. **Composition metadata (R7):** computed at read time. No schema changes during this phase.
6. **Booking page financials:** keep a booking-stage projection; do not hide.
7. **DB import ban:** `@/lib/db` disallowed in `app/**` and `src/components/**`. Allowed in `modules/**`, `lib/**`, `tests/**`, `scripts/**`.

### Read-layer standards (binding)

See `context/architecture-context.md` §6 (Canonical Architecture Standards) and §7 (Canonical Read Layer). Every Rn spec must satisfy:

- One canonical read model per business concept; surface projectors reshape but never recompute.
- Dumb UI — no business semantics in components or pages.
- Service-only DB access.
- One money formatter; one status-label source per enum.

### What every Rn spec must reuse, not re-implement

- Effective-paid math: `computeEffectivePaidFromAllocations` (`src/modules/invoices/invoice.calculation.ts`).
- Settlement summary: `computeOrderSettlementSummary`, `derivePaymentSummary`, `deriveLockedFinancialSidebarSummary`, `deriveSettlementPaidAmount` (`src/modules/orders/order-settlement.ts`).
- Capacities: `computeOverpaymentCapacity`, `computeCreditNoteCapacityForFinal` (`src/modules/invoices/invoice.service.ts`).
- Linked documents: `getLinkedFinancialDocumentsForOrder` (`src/modules/orders/order.service.ts`).

Projectors must call these — they must never re-derive the math.

### Parity testing convention

Each swap spec (R2, R3a/b, R8a/b/c) produces a snapshot fixture covering at minimum: draft, locked, locked+adjusted, refunded, overpaid, credit-noted, missing-FinancialCase fallback. Match existing test layout under `tests/financial/`, `tests/orders/`, `tests/adjustment-workspace/`. Reuse fixtures from `tests/fixtures/`.

### Spec sequencing reminder

R1a is the **first-in-pattern** spec. The shapes it establishes (folder layout, summary fields, projector signatures, discrepancy log format, reconciliation invariant wiring, test fixture conventions) are copied by every later spec. Drafting R1a correctly is high-leverage.

---

## 9. Definition of Done for the Whole Roadmap

- One canonical financial read service; every UI surface gets its data through a projector.
- No page or component computes money, payment status, or composition totals.
- No page or component parses formatted money.
- Pages do not import `@/lib/db`.
- One money formatter; one composition view model; one edit-mode policy; one policy builder per workflow area.
- Write services unchanged in behavior.
- All legacy compatibility/fallback paths either removed or documented as intentional.
- Context files reflect the new pattern; archived analysis docs out of default reads.
