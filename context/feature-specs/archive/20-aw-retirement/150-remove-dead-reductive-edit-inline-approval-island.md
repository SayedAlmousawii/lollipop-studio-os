## Goal

Remove the **dead inline reductive-edit approval island** from the Sales surface. A runtime trace (June 2026, post-Phase-6) proved this path is unreachable: the `ReductiveEditApprovalModal` renders only when `handlers.shouldPromptInlineApproval` is truthy, and **no handler anywhere sets it true** — the only live Sales handlers (the OrderCommit staging adapter) hardcode `shouldPromptInlineApproval: false`. Reduction approval already runs entirely through the commit path (`OrderCommitReviewDialog` → `commitSalesChangesAction` → `commitOrderChanges`, driven by `preview.requiresApproval`). This spec deletes the orphaned island as a **behavior-preserving dead-code removal** — no workflow changes, no financial behavior changes.

It does **not** delete the five legacy direct mutators. Those have no production caller after this spec, but they are heavily used as **test scaffolding** across the financial suite; deleting them requires a separate test-migration effort (see Out of Scope → deferred follow-up).

## Read First

- Runtime trace establishing the path is dead:
  - `src/modules/order-commits/sales-staging-handler-adapter.ts:92,146` — the only live Sales handlers return `shouldPromptInlineApproval: false`.
  - `src/components/orders/pos-add-on-marketplace.tsx:285,385` and `pos-package-composition.tsx:596,815,959` — every `ReductiveEditApprovalModal` mount is gated `{handlers.shouldPromptInlineApproval ? … : null}`.
  - No occurrence of `shouldPromptInlineApproval: true` exists in `src/**` or `app/**` (verify by grep before deleting).
- Dead island members:
  - `src/components/orders/reductive-edit-approval-modal.tsx` (rendered only by the dead gate; calls `confirmReductiveEditWithApproval` at `:73`).
  - `src/components/orders/credit-note-approval-fields.tsx` (imported **only** by the modal, `:22`).
  - `app/orders/[orderId]/sales/actions.ts`: `confirmReductiveEditWithApproval` (`:389`), `executeReductiveEdit` (`:548`), `parseReductionApproval` (`:529`), `isReductiveEditAction` (`:634`), `ReductiveEditAction` type (`:63`), `serializePendingCreditNote` / `serializePendingCreditNoteAction` (`:610-619`), the `PendingCreditNoteApprovalPayload` alias (`:61`), and the five orphaned legacy `*Action` wrappers `updateOrderPackageAction` / `upgradeOrderPackageItemAction` / `addOrderProductAddOnAction` / `removeOrderAddOnAction` / `updateOrderSelectedPhotoCountAction` (`:211-369`, not imported anywhere).
  - `src/modules/orders/pos-handlers.types.ts:41,57` — `shouldPromptInlineApproval` field on `POSCompositionHandlers` / `POSAddOnHandlers`; and the `HandlerResult.approval` field (`:15`) that fed the modal.
- **Shared / live — MUST KEEP:**
  - `PendingCreditNoteApprovalError` (`src/modules/financial/edit-classifier.ts:77`) — thrown by `invoice.service.ts:522`, classified by `order.service.ts:5093`. Live financial layer.
  - `POSApprovalPayload` + the `POSMutationActionState` `"approval-required"` kind — consumed by the **live** commit dialog (`order-commit-review-dialog.tsx:93,112`).
  - `findPOSPayableInvoice` (`sales/actions.ts:509`) — used by the live `recordPOSPaymentAction` (`:451`).
  - The five direct mutators in `order.service.ts` and `assertDirectPOSMutationAllowed` / the draft guard — retained (test scaffolding; see deferred follow-up).
  - The entire commit-time approval flow (`OrderCommitReviewDialog`, `commitSalesChangesAction`, `preview.requiresApproval`/`approvalReasons`).

## Rules

- **Behavior-preserving deletion only.** No change to how reductions are approved or emitted — that already runs through `commitOrderChanges`. If any reduction/approval behavior would change, stop: the path was not as dead as assumed.
- **Pre-flight gate:** before deleting, grep-confirm `shouldPromptInlineApproval: true` appears nowhere in `src/**`/`app/**`. If it does, a live caller exists — stop and reassess.
- Delete the island top-down: remove the modal mounts + gating in the two POS components first, then the modal/fields components, then the dead `sales/actions.ts` functions/types, then the now-unused handler-contract fields.
- Do **not** delete the five direct mutators, `assertDirectPOSMutationAllowed`, `PendingCreditNoteApprovalError`, `POSApprovalPayload`, the `"approval-required"` action-state kind, `findPOSPayableInvoice`, or any commit-dialog approval code.
- When removing `HandlerResult.approval` and `shouldPromptInlineApproval`, update `handlerResultFromActionState` and the two staging-handler factories accordingly; the staging handlers return only `{ ok }` / `{ ok, errors }`.
- No Prisma schema change. No `@/lib/db` in `app/**` or `src/components/**`.

## Scope

### In Scope

- Remove the `ReductiveEditApprovalModal` mounts + `shouldPromptInlineApproval` gating and the `result.approval → kind: "approval-required"` mapping from `pos-add-on-marketplace.tsx` and `pos-package-composition.tsx`.
- Delete `reductive-edit-approval-modal.tsx` and `credit-note-approval-fields.tsx`.
- Delete from `sales/actions.ts`: `confirmReductiveEditWithApproval`, `executeReductiveEdit`, `parseReductionApproval`, `isReductiveEditAction`, `ReductiveEditAction`, `serializePendingCreditNote(+Action)`, the `PendingCreditNoteApprovalPayload` alias, and the five orphaned `*Action` wrappers.
- Remove `shouldPromptInlineApproval` from `pos-handlers.types.ts` (both handler types) and the `HandlerResult.approval` field; update the staging adapter + any consumers.
- Delete tests that only cover the dead path (e.g. `tests/integration/pos-reductive-approval.test.ts`); update any test that referenced a deleted `*Action` wrapper to use the live staging/commit path or drop it if it only tested dead behavior.
- Verify the build proves no remaining reference to any deleted symbol (the five mutators still compile — they're retained).
- Wire any changed tests into `scripts/run-centralization-tests.ts`; update `context/progress-tracker.md`.

### Out of Scope

- **Deleting the five direct mutators (`updateOrderPackage`, `upgradeOrderPackageItem`, `addOrderProductAddOn`, `removeOrderAddOn`, `updateOrderSelectedPhotoCount`) and `assertDirectPOSMutationAllowed`.** They have no production caller after this spec but are used as scenario scaffolding across the financial/audit test suite (`tests/financial/adjustment-reversal.test.ts` ~14×, `financial-phase-b/c/d`, `inv-18-regression`, `audit-log`, etc.). Deleting them requires migrating that scaffolding onto the OrderCommit staging+commit path (or a shared test helper) — a separate, larger spec. **Deferred follow-up.**
- Any change to commit-time approval, financial emission, or the OrderCommit pipeline.
- Removing `PendingCreditNoteApprovalError` or `POSApprovalPayload` (both live).

## Implementation Direction

Treat this as excising a self-contained dead island. Start at the leaves the user can see — the gated `ReductiveEditApprovalModal` mounts in the two POS components — confirm via grep that `shouldPromptInlineApproval` is never `true`, then remove the gates and the `result.approval` plumbing. Delete the modal and its only dependency (`credit-note-approval-fields.tsx`). Then remove the dead server functions/types in `sales/actions.ts` (`confirmReductiveEditWithApproval` → `executeReductiveEdit` and their helpers, plus the orphaned `*Action` wrappers). Finally simplify the handler contract (`shouldPromptInlineApproval`, `HandlerResult.approval`). Keep everything on the live commit-approval path and the retained mutators. The build is the proof: it must compile with the five mutators still present and no dangling references to deleted symbols.

## Observability Checklist

### Dashboards / Metrics

- None. Pure dead-code removal.

### Rollback Plan

- No schema/migration. Rollback = revert the deletion PR. Since the path was unreachable, revert restores only dead code.

### Customer-Visible Surface

- None. The inline approval modal never rendered; reduction approval continues to happen in the Review & Commit dialog exactly as today.

## Post-Implementation

- `context/progress-tracker.md` — note the dead inline reductive-edit approval island is removed; reduction approval is solely the commit-dialog path; the five direct mutators remain as test-only scaffolding pending a future migration spec.
- Update the deferred follow-up note (mutator deletion + financial-test migration) to reference this spec as its prerequisite (done).

## Acceptance Criteria

- `reductive-edit-approval-modal.tsx` and `credit-note-approval-fields.tsx` are deleted; no component renders `ReductiveEditApprovalModal`.
- `confirmReductiveEditWithApproval`, `executeReductiveEdit`, `parseReductionApproval`, `isReductiveEditAction`, `ReductiveEditAction`, `serializePendingCreditNote(+Action)`, the `PendingCreditNoteApprovalPayload` alias, and the five `*Action` wrappers are deleted.
- `shouldPromptInlineApproval` and `HandlerResult.approval` are removed from the handler contract and all consumers.
- `PendingCreditNoteApprovalError`, `POSApprovalPayload`, the `"approval-required"` action-state kind, `findPOSPayableInvoice`, the commit-dialog approval flow, and the five direct mutators remain intact.
- Reduction approval behavior is unchanged (commit-dialog path); no financial emission change.
- Build compiles with the five mutators retained; no dangling references.
- Dead-path tests removed; remaining suites pass.
- `npm run test:centralization` passes.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.

## Resolved Decisions

1. **Dead-island removal is decoupled from mutator deletion.** Removing the unreachable UI/action island is clean and behavior-preserving; deleting the five mutators is gated on migrating the financial-test scaffolding and is a separate spec.
2. **The path is provably dead, not "maybe dead."** `shouldPromptInlineApproval` is `false` in the only live handlers and `true` nowhere — verified by grep. The pre-flight gate re-confirms this before deletion.

## Open Questions

- Whether `legacy-mutators-refuse-when-draft-exists` coverage (`tests/orders/order-commit-draft-guard/`) should stay (the mutators are retained and still guarded) or move with the future mutator-deletion spec. Default: keep it while the mutators exist.
