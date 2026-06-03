## Goal

Fix the OrderCommit financial-emission routing so that repeated commits against an **unlocked** FINAL invoice rebuild that FINAL in place instead of failing with `OrderCommit emission expected exactly one locked FINAL invoice`. Make the create-vs-rebuild-vs-adjust decision **lock-state-aware** rather than keyed purely on whether a prior `OrderCommit` exists. Locking remains a payment/finalization milestone; an unpaid/unlocked FINAL stays editable, and only a locked FINAL routes to ADJ/CREDIT_NOTE emission. This is a Spec 124 emission-routing correction surfaced during Spec 129 manual testing. It must land before Specs 130/131.

## Read First

- `context/feature-specs/124-order-commit-execution.md` — Task 4 invoice-emission orchestrator (the contract being corrected); note lines stating "exactly one locked FINAL invoice for additive/reductive commits."
- `src/modules/order-commits/order-commit-execution.service.ts` — `commitOrderChanges`, `emitOrderCommitFinancialDocuments`, `lockParentInvoiceForEmissionIfPresent`, `resolveLockedParentFinalInvoiceId`, `commitKindForDocumentPlan`.
- `src/modules/invoices/invoice.service.ts` — `createInvoiceForOrderWithClient` (lines ~181-293), `updateUnlockedInvoiceTotal` (~105-166), `syncOrderInvoiceForFinancialEdit` unlocked branch (~612-661), `findPrimaryWorkflowInvoiceForOrder` (~1229), `applyDepositToFinalIfPresent` (~1253), `recalculateInvoiceStatus` (~1052).
- `src/modules/order-commits/order-commit-document.service.ts` — `createOrderCommitDocumentLinks`.
- `src/modules/order-commits/order-commit.constants.ts` — `ORDER_COMMIT_DOCUMENT_ROLE`, `ORDER_COMMIT_KIND`.
- `prisma/schema.prisma` — `OrderCommitDocument` (`@@unique([orderCommitId, invoiceId, role])`), `Invoice.isLocked`.
- `context/reviews/centralization-roadmap.md` — read-layer / financial centralization rules (do not re-derive money in pages/components; not expected to change here).

## Rules

- Backend-only fix. No Sales UI, sidebar, dialog, projector, or page changes.
- No schema or migration changes. The existing models are sufficient.
- No Adjustment Workspace changes. Do not touch `finalizeAdjustmentWorkspace` or AW services.
- No payment behavior changes. Do not auto-lock, auto-issue, or auto-settle invoices. Locking remains driven only by payment settlement (`closeInvoiceIfSettled`) or explicit close (`closeInvoice`).
- Locked invoices remain immutable. No code path in this spec may mutate an invoice with `isLocked = true`.
- Reuse existing invoice helpers. Do not duplicate total computation or status recalculation logic; if a shared helper is needed, factor it transaction-safely rather than copy-pasting.
- The orchestrator already runs inside the `commitOrderChanges` serializable transaction. All new work must use the passed transaction `client` so failures roll back atomically (operational rows, invoice update, document links, audit, activity, draft delete).
- Keep the change minimal and routed through the single emission orchestrator. Do not introduce a new client-facing service or change `commitOrderChanges`'s public signature.

## Scope

### In Scope

- Replace the binary "first commit vs later commit" emission decision in `emitOrderCommitFinancialDocuments` with a three-way, lock-state-aware mode resolution:
  - **No FINAL invoice exists for the FinancialCase** → create the FINAL (current first-commit behavior, unchanged).
  - **A FINAL exists and is unlocked** → rebuild/update that same FINAL in place from the freshly materialized `Order*` rows. Emit no ADJUSTMENT and no CREDIT_NOTE.
  - **A FINAL exists and is locked** → emit ADJUSTMENT / CREDIT_NOTE (and refund-needed) exactly as today, including reversal routing.
- Update `lockParentInvoiceForEmissionIfPresent` so the parent FINAL row is `SELECT … FOR UPDATE`-locked whenever a FINAL exists (for both the rebuild and adjustment modes), preserving concurrency safety.
- Add/extend a transaction-safe invoice helper to rebuild an unlocked FINAL's total from current `Order*` rows (recompute total, clear any unsnapshotted line items, re-apply deposit if applicable, recalculate status). Reuse `updateUnlockedInvoiceTotal` + the existing total computation; factor a shared total-computation helper if that avoids duplication.
- Record audit/activity for the unlocked-rebuild case, and record the document link **only** for modes that emit a financial document (`CREATE_BASE`, `EMIT_ADJUSTMENT`). `REBUILD_UNLOCKED` records no `OrderCommitDocument` row (see Implementation Direction §4).
- Tests + invariants per the lists below.

### Out of Scope

- Locking, finalizing, issuing, or settling invoices.
- Adjustment Workspace, co-editor concurrency (Spec 130), locked-invoice surface unification (Spec 131).
- Any UI, projector, or read-model change.
- Multi-FINAL data-integrity handling beyond what already exists (still treat >1 FINAL as a loud error).

## Implementation Direction

### 1. Emission-mode resolution (the core fix)

In `src/modules/order-commits/order-commit-execution.service.ts`, the decision currently is:

```
isFirstCommit = baselineSource !== LATEST_ORDER_COMMIT
  → true  : createInvoiceForOrderWithClient (BASE)
  → false : resolveLockedParentFinalInvoiceId (requires isLocked FINAL) → ADJ/CREDIT
```

Replace this with a mode resolved **solely from the FINAL invoice's existence and lock state**, independent of `baselineSource`. `baselineSource` must not participate in the mode decision:

- **no FINAL exists → `CREATE_BASE`**
- **unlocked FINAL exists (`isLocked === false`) → `REBUILD_UNLOCKED`**
- **locked FINAL exists (`isLocked === true`) → `EMIT_ADJUSTMENT`**

This rule holds even in weird/legacy/dev states — e.g. a FINAL exists with no prior `OrderCommit` (resolves to `REBUILD_UNLOCKED` or `EMIT_ADJUSTMENT` by lock state, never `CREATE_BASE`), or a prior `OrderCommit` exists but no FINAL yet (deposit-only/booking stage → `CREATE_BASE`). Do not gate any branch on whether a prior `OrderCommit` row exists.

- Resolve the order's FINAL invoice for the FinancialCase once (reuse `findPrimaryWorkflowInvoiceForOrder`, selecting `id` and `isLocked`). There is at most one FINAL; keep the existing ">1 FINAL → loud error" guard (`resolveLockedParentFinalInvoiceId`'s `length !== 1` check stays valid for the locked path).
- Behavior per mode:
  - `CREATE_BASE` — `createInvoiceForOrderWithClient(client, orderId, actorContext)`; record emission `{ invoice, role: BASE_INVOICE }` → produces one `OrderCommitDocument` BASE_INVOICE link. Keep `assertFirstCommitHasNoCreditSide` for this mode (a create-base commit must have no credit side).
  - `REBUILD_UNLOCKED` — rebuild that FINAL in place from materialized `Order*` rows (see §2). Do **not** call the diff→financial-line mapper for adjustment/credit output, do **not** build `openAdjustmentLinesByCause`, and do **not** emit ADJ/CREDIT. Return **no emission** so **no `OrderCommitDocument` row is created** — no new financial document was emitted, only an existing unlocked draft FINAL was updated. The rebuilt FINAL id is recorded in `OrderCommit.metadataJson` instead (see §4).
  - `EMIT_ADJUSTMENT` — current adjustment path unchanged: `buildOpenAdjustmentLineMap`, `mapOrderCommitDiffToFinancialLines`, credit-capacity pre-check, ADJ/CREDIT/refund-needed emission, line-targeted reversals → produces ADJUSTMENT_INVOICE / CREDIT_NOTE links as today.

Notes:
- Materialization already wrote `Order*` rows from the pending snapshot before emission runs, so rebuilding the FINAL from `Order*` rows yields the correct new total, and a reduction simply lowers the total (no CREDIT_NOTE while unlocked).

### 2. Rebuilding the unlocked FINAL

Reuse existing primitives; do not re-implement totals math:

- Compute the target FINAL total from current `Order*` rows using the **same** computation `createInvoiceForOrderWithClient` performs (package amount + add-ons + item upgrades + extra-photo + session-configuration deltas, lines ~220-239). Factor this into a shared transaction-safe helper (e.g. `computeOrderFinalTotalWithClient(client, orderId)`) and call it from both `createInvoiceForOrderWithClient` and the new rebuild path so the two never drift.
- Update the existing unlocked FINAL via the `updateUnlockedInvoiceTotal` path. It already: asserts `isLocked = false` and `lineItems: { none: {} }`, updates `totalAmount`, and writes an `INVOICE_TOTAL_MUTATED` audit row. If unsnapshotted line items can exist on the unlocked FINAL, clear them first exactly as `syncOrderInvoiceForFinancialEdit` does (delete `invoiceLineItem` where `invoiceId` matches) before the total update — never delete snapshotted lines on a locked invoice (the `isLocked = false` guard prevents this).
- After the total update, call `recalculateInvoiceStatus(invoiceId, client)` so `remainingAmount`/status reflect the new total against existing payments/allocations. Do not re-run `applyDepositToFinalIfPresent` unless the deposit was not previously applied; deposit application is idempotent on create, so the rebuild should rely on `recalculateInvoiceStatus`. Confirm with a test that an unlocked FINAL with a prior deposit recalculates `remaining` correctly after rebuild.
- The rebuild helper belongs in `src/modules/invoices/invoice.service.ts` (alongside `createInvoiceForOrderWithClient` / `updateUnlockedInvoiceTotal`) and must accept the transaction `client`. The orchestrator imports it through the existing `loadOrderCommitInvoiceEmissionDependencies` dependency-injection seam so it stays unit-testable with stubs.

### 3. Parent-row locking

`lockParentInvoiceForEmissionIfPresent` currently only `SELECT … FOR UPDATE`-locks the parent when `baselineSource === LATEST_ORDER_COMMIT`. Change it to lock the FINAL row whenever a FINAL exists (both `REBUILD_UNLOCKED` and `EMIT_ADJUSTMENT`), using the resolved FINAL id rather than `resolveLockedParentFinalInvoiceId` (which asserts locked). For `CREATE_BASE` there is no FINAL to lock; the existing order/draft/commit row locks plus the unique constraints guard against duplicate FINAL creation.

### 4. OrderCommit kind, document link, audit, activity

- **Kind:** A `REBUILD_UNLOCKED` commit is re-establishing the base FINAL, not emitting an immutable adjustment. Set `OrderCommit.kind = BASELINE` for this mode (not `ADJUSTMENT`). Update `commitKindForDocumentPlan` to take the resolved mode instead of inferring ADJUSTMENT from `baselineSource`.
- **Metadata:** Record the resolved mode and the affected FINAL id in `OrderCommit.metadataJson` for all modes: `finalInvoiceMode` ∈ `"CREATE_BASE" | "REBUILD_UNLOCKED" | "EMIT_ADJUSTMENT"`, plus `finalInvoiceId` (the resolved/created FINAL id). For `REBUILD_UNLOCKED` also set `rebuiltInvoiceId` (same value as `finalInvoiceId`) so the rebuild is queryable without an `OrderCommitDocument` row. This is the audit trail for the rebuild case, since no document link is written.
- **Document link policy:** `OrderCommitDocument` means *an emitted financial document*, not a touched existing draft. Therefore:
  - `CREATE_BASE` → one `BASE_INVOICE` link.
  - `REBUILD_UNLOCKED` → **no `OrderCommitDocument` row** by default. The orchestrator returns an empty `emissions` array for this mode, so `createOrderCommitDocumentLinks` is a no-op (`emissions.length === 0` → `created: 0`). The rebuild is recorded only via `metadataJson` (above) and the `INVOICE_TOTAL_MUTATED` audit.
  - `EMIT_ADJUSTMENT` → `ADJUSTMENT_INVOICE` / `CREDIT_NOTE` links exactly as today.
- **Audit:** `updateUnlockedInvoiceTotal` already emits `INVOICE_TOTAL_MUTATED`. Keep the existing `recordOrderCommitAudit` (`ORDER_COMMIT_CREATED`) and include the resolved `finalInvoiceMode` in its `after` payload. Do not invent a new audit action.
- **Activity:** Keep `recordOrderCommitActivity` (`ORDER_COMMITTED`). Its description/metadata should reflect that the commit rebuilt the unlocked FINAL (e.g. `documentPlanKind` + `finalInvoiceMode` in metadata). For `REBUILD_UNLOCKED`, `emittedDocumentCount` is `0` (no document link). Do not duplicate the `INVOICE_TOTAL_MUTATED` activity copy from `syncOrderInvoiceForFinancialEdit`.

### 5. Avoiding duplicate FINAL invoices

- `CREATE_BASE` is reached only when no FINAL exists; `createInvoiceForOrderWithClient` additionally re-checks via `findPrimaryWorkflowInvoiceForOrder` and races on the unique constraint, returning the existing invoice. Keep that guard.
- `REBUILD_UNLOCKED` updates the resolved existing FINAL by id; it never creates an invoice.
- The serializable transaction + order/draft/commit `FOR UPDATE` locks + the FINAL `FOR UPDATE` lock prevent concurrent commits from each creating a FINAL.

## Observability Checklist

### Dashboards / Metrics

- No new dashboards. The existing `ORDER_COMMIT_CREATED` audit and `ORDER_COMMITTED` activity now carry `finalInvoiceMode`, which is sufficient to distinguish create/rebuild/adjust commits in audit queries.

### Rollback Plan

- No schema migration; rollback is a code revert. Reverting restores the prior "second commit on unlocked FINAL fails loudly" behavior — no data cleanup needed because rebuild only updates an unlocked FINAL total (recomputable from `Order*` rows) and adds OrderCommit/document rows that remain valid.
- Non-recoverable data: none. No invoices are locked or issued by this change.

### Customer-Visible Surface

- None directly. Staff can now stage and commit multiple times on an unlocked order without the spurious "expected exactly one locked FINAL invoice" failure; the FINAL total updates in place as before lock. No copy or layout changes.

## Post-Implementation

- Update `context/progress-tracker.md` Now/Key State to note the unlocked-FINAL replay fix landed (Spec 132) ahead of Specs 130/131.
- Cross-reference this spec from `context/reviews/unified-order-commit-live-pos-roadmap.md` (Spec 124 follow-up resolved; precondition for 131 locked/unlocked unification).

## Acceptance Criteria

- First commit on an order with no FINAL creates exactly one FINAL invoice (`status: DRAFT`, `isLocked: false`), links it as `BASE_INVOICE`, and respects deposit application — unchanged from Spec 124.
- Second commit while the FINAL is unlocked updates/rebuilds the **same** FINAL invoice id (new total reflects the materialized `Order*` rows), emits **no** ADJUSTMENT and **no** CREDIT_NOTE, creates **no** new `OrderCommitDocument` row, does not create a second FINAL, and records `finalInvoiceMode = "REBUILD_UNLOCKED"` + `rebuiltInvoiceId`/`finalInvoiceId` in `OrderCommit.metadataJson`.
- Emission mode is resolved solely from FINAL invoice state (no FINAL → CREATE_BASE; unlocked FINAL → REBUILD_UNLOCKED; locked FINAL → EMIT_ADJUSTMENT) and never from `baselineSource` — including legacy/dev states where a FINAL exists without a prior OrderCommit, or a prior OrderCommit exists without a FINAL.
- A reduction committed while the FINAL is unlocked lowers the **same** FINAL's total in place and emits **no** CREDIT_NOTE and sets no `refundPending`.
- Once the FINAL is locked, a later additive commit emits an ADJUSTMENT invoice exactly as today (parent = the locked FINAL, line-targeted where applicable).
- Once the FINAL is locked, a later reduction emits CREDIT_NOTE / sets `refundPending` exactly as today, including adjustment-reversal routing and credit-capacity pre-check.
- At no point do two FINAL invoices exist for one FinancialCase; the >1-FINAL guard still throws loudly.
- No invoice with `isLocked = true` is mutated by any path in this spec; locked frozen-field invariants in `tests/backend-invariants/` still pass.
- OrderCommit sequence/snapshot chain advances correctly across create → rebuild → (lock) → adjust commits; `committedFromDraftVersion` idempotency guard intact.
- A commit that fails after the invoice update (e.g. invariant violation) rolls back the invoice total change, the OrderCommit row, document links, audit/activity rows, and leaves the draft undeleted.
- This spec consumes/produces only backend financial state; no `@/lib/db` imports added to `app/**` or `src/components/**`.
- `npm run build` passes.
- `npm run lint` passes.
- `npm test` (or the order-commit + invoice suites) passes.

## Tests / Invariants

Add to `tests/order-commits/` (reuse the existing execution/emission harness, e.g. `order-commit-invoice-emission.test.ts`, `order-commit-execution.test.ts`):

1. **First commit creates FINAL** — fresh order, one staged package → one FINAL, `BASE_INVOICE` link, no ADJ/CREDIT.
2. **Second commit, unlocked FINAL, additive** — stage another add-on after first commit → same FINAL id, total increased, no new FINAL, no ADJ/CREDIT, **no new `OrderCommitDocument` row**, `metadataJson.finalInvoiceMode = "REBUILD_UNLOCKED"` with `rebuiltInvoiceId`/`finalInvoiceId` set, kind = `BASELINE`.
2b. **Mode ignores baselineSource** — assert resolution by FINAL state in the edge cases: (a) a FINAL exists with no prior OrderCommit → REBUILD_UNLOCKED/EMIT_ADJUSTMENT by lock state, never CREATE_BASE; (b) a prior OrderCommit exists with no FINAL → CREATE_BASE.
3. **Second commit, unlocked FINAL, reduction** — remove a line after first commit → same FINAL id, total decreased, no CREDIT_NOTE, `refundPending` unchanged (false).
4. **Locked FINAL, additive** — lock the FINAL (via test helper: settle payment or `closeInvoice`), then commit an add-on → one ADJUSTMENT invoice parented to the locked FINAL.
5. **Locked FINAL, reduction** — lock the FINAL, then reduce → CREDIT_NOTE / refund-needed as before, reversal routing intact.
6. **No duplicate FINAL** — across create + multiple unlocked rebuilds, exactly one FINAL row exists for the FinancialCase.
7. **Locked immutability** — a rebuild attempt against a locked FINAL never occurs (mode resolves to `EMIT_ADJUSTMENT`); assert no `INVOICE_TOTAL_MUTATED` audit is written for a locked invoice.
8. **Snapshot/sequence advance** — OrderCommit `sequence` increments and `snapshotJson` chain is consistent across create → rebuild → lock → adjust.
9. **Rollback on failure** — force a post-update failure (e.g. stub `assertFinancialCaseInvariants` to throw) and assert the FINAL total is unchanged, no OrderCommit/document rows persist, and the draft still exists.
10. **Deposit recalc on rebuild** — unlocked FINAL with a prior applied deposit: after rebuild the `remainingAmount` equals new total minus effective paid.

Invariants to keep green: existing `tests/backend-invariants/` locked-invoice frozen-field checks and `assertFinancialCaseInvariants` for create/rebuild/adjust outcomes.

## Implementation Notes for Codex

- The whole change is concentrated in `emitOrderCommitFinancialDocuments` + `lockParentInvoiceForEmissionIfPresent` + `commitKindForDocumentPlan` in `order-commit-execution.service.ts`, plus one new rebuild helper in `invoice.service.ts`. Do not widen the blast radius.
- Resolve the FINAL once and thread the resolved `{ id, isLocked }` through the orchestrator; avoid double queries. Reuse `findPrimaryWorkflowInvoiceForOrder` for resolution and keep `resolveLockedParentFinalInvoiceId` only for the locked-adjustment branch (or refactor it to assert-locked on the already-resolved row).
- Wire the new rebuild helper through `loadOrderCommitInvoiceEmissionDependencies` so emission tests can stub it.
- Extract the FINAL total computation shared by `createInvoiceForOrderWithClient` and the rebuild helper to prevent drift; this is the one acceptable refactor and should be a pure, transaction-safe function.
- Keep `assertFirstCommitHasNoCreditSide` for `CREATE_BASE` only. For `REBUILD_UNLOCKED`, do not invoke the diff→financial-line mapper at all.
- Do not change the `documentPlan` classification, preview, or approval logic; this spec only changes how the resolved plan is turned into invoice writes for the unlocked-FINAL case. Manager-approval behavior on the locked-adjustment path is unchanged.
- Recommended branch: `spec/132-order-commit-unlocked-final-replay` (130/131 are reserved by the roadmap for co-editor concurrency and locked-invoice unification; this fix is numbered 132 but must merge before them).
