## Goal

Migrate the financial/audit **test scaffolding** off the five legacy direct service mutators (`updateOrderPackage`, `upgradeOrderPackageItem`, `addOrderProductAddOn`, `removeOrderAddOn`, `updateOrderSelectedPhotoCount`) onto the OrderCommit staging+commit path, then delete those mutators and `assertDirectPOSMutationAllowed`. After Spec 150 these mutators have **no production caller** — they survive only because the financial suite uses them to apply a locked-order edit and trigger adjustment/credit-note/refund emission. This spec removes that last dependency so the mutators can go.

This is **not** a financial-behavior change spec. The committed financial outcomes the tests assert must stay identical; the only thing that changes is which engine the *tests* drive to produce them (`commitOrderChanges` instead of the mutators' direct `syncOrderInvoiceForFinancialEdit` path).

It does **not** delete `syncOrderInvoiceForFinancialEdit`. That legacy emission engine has **direct** (non-mutator) test callers that remain after this spec; retiring it is a separate follow-up ([Spec 152](152-retire-sync-order-invoice-for-financial-edit-placeholder.md)).

## Read First

- **The mutators are a financial engine, not just `Order*` writers.** Each of the five (`src/modules/orders/order.service.ts:1174`, `:1340`, `:1520`, `:1651`, `:1807`) does, in one transaction: guard (`assertNoActiveOrderCommitDraft` + `assertDirectPOSMutationAllowed`) → write `Order*` rows → call **`syncOrderInvoiceForFinancialEdit`** (`src/modules/invoices/invoice.service.ts:361`), the legacy ADJUSTMENT/CREDIT_NOTE/refund emission path that parallels `commitOrderChanges`.
- **The modern equivalent:** `getOrCreateOrderCommitDraft` (`src/modules/order-commits/order-commit.service.ts:405`) → `stageOrderCommitDraftChange` (`:530`) → `commitOrderChanges` (`src/modules/order-commits/order-commit-execution.service.ts:245`, input `CommitOrderChangesInput` at `:151`: `{ orderId, expectedDraftVersion, approvalActorUserId?, actorContext }`). For a **locked FINAL** order this routes to `EMIT_ADJUSTMENT` — the same family of documents the mutator path emits.
- **Staging change shapes** (`src/modules/order-commits/order-commit-draft.schema.ts`): discriminated union by `domain` — `PACKAGE` / `ADD_ON` (`parentPackageTarget` optional → order-level) / `PACKAGE_ITEM_UPGRADE` / `PHOTO` / `SESSION_CONFIGURATION`. The Sales handler adapter (`src/modules/order-commits/sales-staging-handler-adapter.ts`) is the reference for mapping a UI/operational edit to a staging change; the test helper should produce the same payloads at the service layer.
- **Identity difference (the real work).** Mutators take *materialized* identity (`{ productId }`, `approvedRemoveInput(addOn.id)`, `{ orderPackageId, packageItemId, newProductId }`). Staging changes target *snapshot line identity / draft ids*. Add is easy; **remove/reduce** must resolve the committed line's snapshot identity from the active baseline, not the `OrderAddOn.id`.
- **Approval path.** Tests that pass `managerApprovedReductionByUserId` / `managerApprovedReason` to `syncOrderInvoiceForFinancialEdit` map to `commitOrderChanges({ approvalActorUserId })` driven by `preview.requiresApproval`.
- **Mutator-using test files (migration targets):**
  - `tests/financial/adjustment-reversal.test.ts` (~14 calls — the dense, highest-risk file: ADJ-line reversal, paid-vs-unpaid refund branches, partial reversal)
  - `tests/financial-phase-c/edge-cases.ts`, `tests/financial-phase-d/regression.ts`, `tests/financial-phase-b/workflow-integration.ts`
  - `tests/financial/inv-18-regression.test.ts`
  - `tests/audit/audit-log.test.ts`
  - `tests/financial-invariants.test.ts`
  - `tests/session-configurations/session-configuration-selection-service.test.ts`
- **Guard tests that test the mutators themselves (delete, don't migrate):**
  - `tests/orders/order-commit-draft-guard/legacy-mutators-refuse-when-draft-exists.test.ts`
  - `tests/orders/order-commit-draft-guard/legacy-mutators-pass-without-draft.test.ts`
  - `tests/orders/order-commit-draft-guard/guard-runs-before-lock-check.test.ts`
  - (Keep `aw-hide-and-freeze-source-guard.test.ts` — unrelated to the mutators.)
- **Do NOT delete in this spec:** `syncOrderInvoiceForFinancialEdit` (has direct callers in `financial-phase-c/d`, `tests/backend-invariants/invoice-math.invariant.ts`, `tests/fixtures/financial.ts`, `session-configuration-pricing-integration.test.ts`); `PendingCreditNoteApprovalError`; the commit-dialog approval flow; any OrderCommit code.

## Rules

- **Behavior-preserving for committed outcomes.** The emitted `Invoice` rows, `Order.refundPending`, `OrderCommitDocument`/document linkage, audit records, and net totals that each migrated test asserts must be unchanged. If a migrated test cannot reproduce the same financial outcome through `commitOrderChanges`, **stop** — that is a real engine divergence to surface, not something to paper over by weakening the assertion.
- **Parity before migration.** Do not rewrite assertions until equivalence between the legacy mutator path and `commitOrderChanges` is demonstrated for the mutator-backed scenarios (see In Scope → parity harness). The parity harness is a temporary scaffold deleted at the end of this spec.
- **One shared helper, no logic.** The test helper orchestrates `getOrCreateOrderCommitDraft` → `stageOrderCommitDraftChange` → `commitOrderChanges` and resolves snapshot line identity for remove/reduce. It performs no financial arithmetic and makes no assertions.
- **Delete mutators last.** Remove the five mutators and `assertDirectPOSMutationAllowed` only after every non-guard test no longer imports them and the suites are green. Deletion and migration may be one PR, but ordered: migrate → prove green → delete.
- **Leave the legacy engine alone.** No change to `syncOrderInvoiceForFinancialEdit` or its direct callers. If removing the mutators leaves unused exports in `invoice.service.ts` that are *only* reachable through the mutators, note them for Spec 152 rather than deleting here.
- No Prisma schema change. No `@/lib/db` import added to `app/**` or `src/components/**`.

## Scope

### In Scope

- **Shared OrderCommit test helper** (e.g. `tests/order-commits/helpers/commit-order-edit.ts`): `commitOrderEditForTest(db, { orderId, change | changes, actorContext, approvalActorUserId? })` that lazily creates the draft, stages the change(s) with correct `expectedVersion` threading, resolves snapshot line identity for remove/reduce against the active baseline, and calls `commitOrderChanges`. Returns the execution result (commit + emitted documents) for assertion.
- **Temporary parity harness** proving, for each mutator-backed scenario family the suite covers (add-on add, add-on remove with paid ADJ → refund, add-on remove unpaid → no refund, partial/quantity reversal, package-item upgrade, package change, selected-photo change, manager-approved reduction, INV-18 goodwill, audit emission): the legacy mutator path and `commitOrderChanges` emit equivalent `Invoice` rows, `Order.refundPending`, document linkage, and audit shape. Delete the harness once the migration lands green.
- **Migrate every mutator-using test** in the files listed under Read First to the helper, preserving each assertion's intent.
- **Delete the five direct mutators** (`updateOrderPackage`, `upgradeOrderPackageItem`, `addOrderProductAddOn`, `removeOrderAddOn`, `updateOrderSelectedPhotoCount`) and `assertDirectPOSMutationAllowed` from `order.service.ts`, plus the now-orphaned `assertNoActiveOrderCommitDraft` wiring at those call sites (the guard helper itself stays only if other callers remain — verify).
- **Delete the three guard tests** that exist solely to test the mutators (listed in Read First).
- Update `scripts/run-centralization-tests.ts` if any deleted/renamed test file was wired in; ensure the helper-based tests stay wired.
- Update `context/progress-tracker.md`.

### Out of Scope

- **Deleting `syncOrderInvoiceForFinancialEdit`** and migrating its *direct* (non-mutator) test callers — deferred to [Spec 152](152-retire-sync-order-invoice-for-financial-edit-placeholder.md).
- Any change to commit-time approval semantics, financial emission, or the OrderCommit pipeline.
- Any new financial behavior, new staging domain, or schema change.
- Touching `tests/orders/order-commit-draft-guard/aw-hide-and-freeze-source-guard.test.ts`.

## Implementation Direction

Start by proving the migration is safe, not by editing tests. Build the parity harness first: take a representative locked-FINAL order, apply the same proposal through both the mutator path and `commitOrderChanges`, and assert the emitted documents/refund/audit match. Once parity holds across the scenario families (especially the `adjustment-reversal` refund branches and partial reversals), build the shared helper so its remove/reduce identity resolution matches what the parity harness needed. Then migrate the test files one at a time — `adjustment-reversal.test.ts` last, since it is the densest and most likely to expose an identity-resolution gap — keeping each file green before moving on. Only when no non-guard test imports the mutators do you delete the five functions, `assertDirectPOSMutationAllowed`, and the three guard tests, then delete the parity harness. The build is the proof the mutators are gone with no dangling references.

## Observability Checklist

### Dashboards / Metrics

- None. Test-scaffolding migration + dead-code removal.

### Rollback Plan

- No schema/migration. Rollback = revert the PR; restores the mutators and the prior test wiring. Since the mutators had no production caller, the revert restores only test scaffolding and dead code.

### Customer-Visible Surface

- None. The mutators are not reachable from any production caller after Spec 150.

## Post-Implementation

- `context/progress-tracker.md` — note the five legacy direct mutators and `assertDirectPOSMutationAllowed` are deleted; the financial/audit suite drives locked-order edits through `commitOrderChanges` via a shared OrderCommit test helper; the mutator-only draft-guard tests are removed. Remove the "After Spec 150: delete the five legacy direct mutators…" Open Follow-Up.
- Add/confirm the Open Follow-Up for retiring `syncOrderInvoiceForFinancialEdit` (Spec 152).
- Update `phase-6-aw-retirement-review-loop` / `reductive-edit-flow-migration-followup` memory notes to mark the mutator deletion done.

## Acceptance Criteria

- A shared OrderCommit test helper exists and is the path by which financial/audit tests apply locked-order edits; no test outside the (deleted) guard tests imports any of the five mutators.
- The parity harness demonstrated equivalent committed outcomes (invoices, `Order.refundPending`, document linkage, audit) for the mutator-backed scenario families, then was removed.
- The five direct mutators and `assertDirectPOSMutationAllowed` are deleted from `order.service.ts` with no dangling references.
- The three mutator-only draft-guard tests are deleted; `aw-hide-and-freeze-source-guard.test.ts` is untouched.
- `syncOrderInvoiceForFinancialEdit` and its direct callers are unchanged.
- Every migrated test preserves its original assertion intent (no weakened/removed financial assertions).
- `npm run test:centralization` passes.
- `npm run test:backend-invariants` passes.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.

## Resolved Decisions

1. **Parity is proven before assertions are rewritten.** The legacy mutator/`syncOrderInvoiceForFinancialEdit` path was never parity-tested against `commitOrderChanges` (Spec 131 only covered AW-finalize vs `commitOrderChanges`). A temporary harness closes that gap before migration, then is deleted.
2. **`syncOrderInvoiceForFinancialEdit` is not retired here.** It retains direct test callers; retiring it is a separable, larger effort (Spec 152). Keeping the two specs apart bounds each PR's financial-test blast radius.
3. **Guard tests are deleted, not migrated.** They assert the mutators' draft-guard behavior; once the mutators are gone, the behavior they cover no longer exists.

## Open Questions

- Whether the shared helper should reuse the Sales staging handler adapter's mapping (`sales-staging-handler-adapter.ts`) or construct staging-change payloads directly. Default: construct directly at the service layer to keep the helper independent of the UI adapter, mirroring the adapter's payload shapes.
- Whether `assertNoActiveOrderCommitDraft` / `order-commit-draft-guard` has any caller left after the mutators go. Default: verify by grep; delete the guard helper only if fully orphaned, otherwise leave it.
