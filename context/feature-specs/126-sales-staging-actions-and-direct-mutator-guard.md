## Goal

Introduce the two staging-side server actions for the unified Sales workflow — `stageSalesChangeAction` and `discardSalesDraftAction` — and land the **legacy direct-mutator guard** as the safety rail before any UI wiring in Spec 128. After this spec, every staged change has a single legitimate path (`OrderCommitDraft`), and the five legacy direct-mutator service functions (`updateOrderPackage`, `upgradeOrderPackageItem`, `addOrderProductAddOn`, `removeOrderAddOn`, `updateOrderSelectedPhotoCount`) refuse to execute whenever an `OrderCommitDraft` exists for the order. The only exemption is `finalizeAdjustmentWorkspace`, which remains exempted until AW is deleted in Phase 6.

This spec does not change the Sales page or any component. The new actions exist and are tested, but no UI calls them yet. The legacy mutators and the legacy Sales-page actions (`updateOrderPackageAction`, etc.) remain callable. Spec 128 rewires the UI; Spec 127 adds the commit action.

## Read First

- `context/reviews/unified-order-commit-live-pos-roadmap.md` — Phase 5 Design Notes (lazy creation rule, `stageSalesChangeAction` shape, legacy direct-mutator guard contract, AW-finalize exemption).
- `context/feature-specs/121-order-commit-draft-foundation.md` — `OrderCommitDraft` lifecycle, ownership, version semantics.
- `context/feature-specs/122-order-commit-draft-staging-reducers.md` — `orderCommitDraftStagingChangeSchema` shape consumed by `stageOrderCommitDraftChange`.
- `context/feature-specs/125-sales-page-view-model-and-projectors.md` — `SalesPageDraftState.version` is the source of `expectedVersion` callers will pass.
- `src/modules/order-commits/order-commit.service.ts:400` — `getOrCreateOrderCommitDraft` signature.
- `src/modules/order-commits/order-commit.service.ts:426` — `discardOrderCommitDraft` signature.
- `src/modules/order-commits/order-commit.service.ts:525` — `stageOrderCommitDraftChange` signature; requires an existing draft and an exact `expectedVersion`.
- `src/modules/orders/order.service.ts:208` — `assertDirectPOSMutationAllowed`, the existing locked-invoice guard inside the five legacy mutators (called at `:1217`, `:1368`, `:1565`, `:1682`, `:1838`).
- `src/modules/adjustment-workspace/adjustment-workspace.service.ts` — `finalizeAdjustmentWorkspace`, the sole exempted caller after this spec.
- `app/orders/[orderId]/sales/actions.ts` — existing Sales-page action style and `POSMutationActionState` return shape.

## Rules

- This spec is implementation-only after approval; it must not change UI, page routing, financial logic, draft creation rules beyond what is listed below, AW finalize logic, or any composition / preview / commit behavior.
- New actions are additive. Legacy Sales-page actions (`updateOrderPackageAction`, `upgradeOrderPackageItemAction`, `addOrderProductAddOnAction`, `removeOrderAddOnAction`, `updateOrderSelectedPhotoCountAction`) remain in place and reachable; Spec 128 removes them.
- `stageSalesChangeAction` must perform **lazy draft creation**. It calls `getOrCreateOrderCommitDraft` and then `stageOrderCommitDraftChange` in the same action body. No other surface in this spec creates drafts. Page load (Spec 125 loader) still does not create drafts.
- `stageSalesChangeAction` must not introduce a new `change` schema. It forwards the caller-supplied change to `stageOrderCommitDraftChange`, which validates against `orderCommitDraftStagingChangeSchema`.
- `expectedVersion` must be supplied explicitly by callers. The first stage after draft creation passes `0` (the version returned by `getOrCreateOrderCommitDraft` for a freshly created draft). Subsequent stages pass the version from `SalesPageDraftState.version`.
- The legacy direct-mutator guard must refuse — with a typed error — when an `OrderCommitDraft` exists for the order, **except** when the call originates from `finalizeAdjustmentWorkspace`.
- The exemption is carried explicitly on `actorContext` via a new optional field `bypassOrderCommitDraftGuard?: boolean`. Set only by `finalizeAdjustmentWorkspace`. Not exposed in any UI / API / DTO. Removed when AW is deleted in Phase 6.
- The guard runs before the existing `assertDirectPOSMutationAllowed` lock check. Both are kept; both remain enforced.
- No business logic, financial logic, approval logic, or preview logic moves into action bodies. Actions are thin orchestrators of existing services.
- No `@/lib/db` imports in `app/**`.
- No new public surface exposes Adjustment Workspace naming.

## Scope

### In Scope

- New server actions in `app/orders/[orderId]/sales/actions.ts`:
  - `stageSalesChangeAction(orderId, expectedVersion, change): Promise<POSMutationActionState>` — orchestrates `getOrCreateOrderCommitDraft` + `stageOrderCommitDraftChange` + `revalidatePath`.
  - `discardSalesDraftAction(orderId, expectedVersion): Promise<POSMutationActionState>` — orchestrates `discardOrderCommitDraft` + `revalidatePath`.
- New error mapping in the action layer: typed translation of OrderCommit error classes to `POSMutationActionState`. At minimum: stale-version, missing-draft, owner-permission, validation. Approval-required errors are commit-time only and ship in Spec 127.
- Legacy direct-mutator guard:
  - New helper `assertNoActiveOrderCommitDraft({ orderId, actorContext, tx })` under `src/modules/orders/order.service.ts` (or a small new file `src/modules/orders/policies/order-commit-draft-guard.ts` if cleaner). Reads `OrderCommitDraft` by `orderId`; returns void if none; throws `OrderCommitDraftActiveError` if one exists and `actorContext.bypassOrderCommitDraftGuard !== true`.
  - Invocation added at the entry of each of the five legacy mutators in `src/modules/orders/order.service.ts`, immediately before the existing `assertDirectPOSMutationAllowed` call. Both guards remain.
  - New error class `OrderCommitDraftActiveError` in `src/modules/orders/order.errors.ts` (or wherever existing order errors live). Message indicates a draft is in progress and references the staged workflow.
- Actor-context extension:
  - Add optional `bypassOrderCommitDraftGuard?: boolean` to `ActorContext`.
  - `finalizeAdjustmentWorkspace` sets it on the internal actor context it forwards to mutators. No other caller sets it.
  - Field is internal; no API / form / DTO surface exposes it.
- Tests under `tests/order-commits/sales-staging-actions/`:
  - Happy-path stage: action creates draft on first call, stages on second, version increments.
  - Lazy creation: action does not create a draft until first stage.
  - Stale-version stage rejected with a clear `POSMutationActionState` error.
  - Non-owner-non-manager stage rejected.
  - Discard: action removes the draft and leaves `Order*` rows untouched.
  - Discard with stale version rejected.
- Tests under `tests/orders/order-commit-draft-guard/`:
  - Each of the five legacy mutators refuses when a draft exists.
  - All five mutators pass when no draft exists (regression).
  - AW finalize bypasses the guard (covers an end-to-end finalize that internally calls the mutators).
  - The guard runs before `assertDirectPOSMutationAllowed`: with both a draft *and* a locked invoice, the user sees the draft error (workflow message), not the legacy locked-invoice message.
- Wire new tests into `scripts/run-centralization-tests.ts`.
- Update `context/progress-tracker.md`.

### Out of Scope

- No changes to `app/orders/[orderId]/sales/page.tsx`.
- No changes to `POSPackageComposition`, `POSAddOnMarketplace`, financial sidebar components, or any UI.
- No removal of legacy Sales-page actions (`updateOrderPackageAction`, etc.). Removed in Spec 128.
- No removal of the five legacy mutator service functions (`updateOrderPackage`, etc.). Removed in Phase 6.
- No commit action. `commitSalesChangesAction` and the Review & commit dialog ship in Spec 127.
- No co-editor banner; no non-owner UI disabling. Spec 129.
- No locked-invoice branch unification. Spec 130.
- No new schema, table, or column. The actor-context flag is a runtime field, not persisted.
- No changes to `commitOrderChanges`, `getOrderCommitPreview`, or any other OrderCommit service.
- No new AW behavior. AW finalize is modified only to set the bypass flag on its internal actor context.

## Implementation Direction

### Task 1 — `OrderCommitDraftActiveError` and the guard helper

Add `OrderCommitDraftActiveError` in the appropriate orders-module errors file. Message must reference the staged workflow:

> "An order commit draft is in progress for this order. Use the staged sales workflow to apply changes."

Add `assertNoActiveOrderCommitDraft({ orderId, actorContext, tx })`:

- Skips the check when `actorContext.bypassOrderCommitDraftGuard === true`.
- Otherwise reads `OrderCommitDraft` by `orderId` using the provided `tx` (Prisma client or transaction). If a row exists, throws `OrderCommitDraftActiveError`.
- Pure read; no writes.

Place the helper close to `assertDirectPOSMutationAllowed`. Reuse the existing transactional client convention.

### Task 2 — Wire the guard into the five legacy mutators

In `src/modules/orders/order.service.ts`, at each of the five mutator entry points (`updateOrderPackage`, `upgradeOrderPackageItem`, `addOrderProductAddOn`, `removeOrderAddOn`, `updateOrderSelectedPhotoCount`):

- Inside the same transaction the mutator already opens, immediately before `assertDirectPOSMutationAllowed(order.invoices[0])`, add `await assertNoActiveOrderCommitDraft({ orderId, actorContext, tx })`.
- Order of checks: draft guard first, then locked-invoice guard. Rationale per Phase 5 Design Notes: the user-facing message for the new workflow should win over the legacy lock message.

### Task 3 — Actor-context extension and AW-finalize exemption

- Extend `ActorContext` with `bypassOrderCommitDraftGuard?: boolean`. Default unset.
- In `finalizeAdjustmentWorkspace`, when it constructs the actor context it forwards to mutator calls, set `bypassOrderCommitDraftGuard: true`. Do not propagate the flag outward to any return value, log, or response.
- Confirm by grep that no other call site sets this flag. Add a static guard test that asserts the only assignment of `bypassOrderCommitDraftGuard: true` in the repo is inside `src/modules/adjustment-workspace/`.

### Task 4 — `stageSalesChangeAction`

Signature:

```ts
export async function stageSalesChangeAction(
  orderId: string,
  expectedVersion: number,
  change: OrderCommitDraftStagingChangeInput
): Promise<POSMutationActionState>
```

Body:

1. Permission check via `requireCurrentAppUserPermission(PERMISSIONS.ORDER_FINANCIAL_UPDATE)` (mirrors existing Sales actions).
2. `const ensured = await getOrCreateOrderCommitDraft({ orderId, actorContext })`.
3. `await stageOrderCommitDraftChange({ orderId, change, expectedVersion, actorContext })`.
4. `revalidatePath(\`/orders/${orderId}/sales\`)`.
5. Return `{ kind: "success" }` per existing `POSMutationActionState` shape.

Error mapping (return `POSMutationActionState` with `kind: "error"` and a field-scoped or top-level message):

- Stale `expectedVersion` from `stageOrderCommitDraftChange` → `"draft.stale"` message.
- Non-owner-non-manager from the actor assertion → `"draft.permission"` message.
- Validation failure from `orderCommitDraftStagingChangeSchema` → field-level errors.
- Unknown errors rethrow.

No new schema. The `change` argument is typed by the existing `OrderCommitDraftStagingChangeInput` from spec 122.

### Task 5 — `discardSalesDraftAction`

Signature:

```ts
export async function discardSalesDraftAction(
  orderId: string,
  expectedVersion: number
): Promise<POSMutationActionState>
```

Body:

1. Permission check (same as stage).
2. `await discardOrderCommitDraft({ orderId, expectedVersion, actorContext })`.
3. `revalidatePath(\`/orders/${orderId}/sales\`)`.
4. Return `{ kind: "success" }`.

Error mapping: stale-version → `"draft.stale"`; permission → `"draft.permission"`; otherwise rethrow.

### Task 6 — Tests

Under `tests/order-commits/sales-staging-actions/`:

- `stage-happy-path.test.ts` — first call creates draft (version 0 → 1 after stage), second call stages again (version 1 → 2).
- `stage-lazy-creation.test.ts` — calling `getSalesPageView` does not create a draft; calling `stageSalesChangeAction` does.
- `stage-stale-version.test.ts` — stale `expectedVersion` returns error state, leaves draft unchanged.
- `stage-non-owner.test.ts` — non-owner non-manager actor receives permission error; draft unchanged.
- `discard-happy-path.test.ts` — discards draft; `Order*` rows unchanged; subsequent `getSalesPageView` shows `draft === null` and composition `source: "current"`.
- `discard-stale-version.test.ts` — stale-version discard returns error; draft remains.

Under `tests/orders/order-commit-draft-guard/`:

- `legacy-mutators-refuse-when-draft-exists.test.ts` — five subtests, one per mutator. Create a draft via `getOrCreateOrderCommitDraft`, then call each legacy mutator directly. Expect `OrderCommitDraftActiveError`.
- `legacy-mutators-pass-without-draft.test.ts` — regression: each legacy mutator still works when no draft exists.
- `aw-finalize-bypasses-guard.test.ts` — end-to-end: open an AW on a locked invoice, finalize it, assert the call succeeds. (Use the existing AW test scaffolding.)
- `guard-runs-before-lock-check.test.ts` — set up a locked invoice AND an active draft. Expect `OrderCommitDraftActiveError`, not `LOCKED_INVOICE_WORKSPACE_REQUIRED`.
- Static-source guard test: the literal `bypassOrderCommitDraftGuard: true` appears only under `src/modules/adjustment-workspace/`.

Wire suites into `scripts/run-centralization-tests.ts`.

### Task 7 — Module exports and documentation

- Export `stageSalesChangeAction`, `discardSalesDraftAction` from `app/orders/[orderId]/sales/actions.ts`.
- Export `assertNoActiveOrderCommitDraft` and `OrderCommitDraftActiveError` only if existing tests need to import them. Otherwise keep them module-private.
- No changes to `src/modules/order-commits/index.ts` (no new OrderCommit surface).
- Update `context/progress-tracker.md` to mark Spec 126 complete.

## Observability Checklist

### Dashboards / Metrics

- None new for happy paths. The guard's `OrderCommitDraftActiveError` should be visible in existing error logging the same way `LOCKED_INVOICE_WORKSPACE_REQUIRED` is today. If repo conventions include a counter for blocked POS mutations, increment the same counter with a distinct reason label.

### Rollback Plan

- Schema: no changes.
- Code rollback: revert this spec's diff. The guard removal restores the pre-spec behavior (legacy mutators executable regardless of draft state). No data damage; drafts persist independently and are still removable via existing `discardOrderCommitDraft`.
- The bypass flag is a runtime-only field on `ActorContext`. Removing it is safe because no persistence or external API references it.
- Non-recoverable data: none.

### Customer-Visible Surface

- None for users. The new actions are exported but not wired to the UI in this spec. The guard becomes visible only if a developer or admin tool tries to call a legacy mutator directly while a draft exists — and there is no path in production that does this between Specs 126 and 128.

## Post-Implementation

- `context/progress-tracker.md` updated.
- No roadmap edit required; Phase 5 Design Notes already document the guard contract.
- Spec 127 (commit action + dialog) can be drafted against the actions added here.

## Acceptance Criteria

- `stageSalesChangeAction` and `discardSalesDraftAction` exist in `app/orders/[orderId]/sales/actions.ts` and conform to the `POSMutationActionState` return shape.
- `stageSalesChangeAction` creates a draft lazily (on first stage call) by calling `getOrCreateOrderCommitDraft` before `stageOrderCommitDraftChange`.
- Page load via `getSalesPageView` continues to not create drafts.
- `OrderCommitDraftActiveError` is thrown by each of the five legacy mutators (`updateOrderPackage`, `upgradeOrderPackageItem`, `addOrderProductAddOn`, `removeOrderAddOn`, `updateOrderSelectedPhotoCount`) when an `OrderCommitDraft` exists for the order.
- `finalizeAdjustmentWorkspace` bypasses the guard via `actorContext.bypassOrderCommitDraftGuard = true`; no other call site in the repo sets this flag (asserted by static-source test).
- When both an active draft and a locked invoice exist for the same order, legacy mutators throw `OrderCommitDraftActiveError`, not the legacy locked-invoice error.
- No UI component, page, or other Sales-page action is modified by this spec.
- No new schema, migration, or persisted field is introduced.
- No projector, service, or action in this spec recomputes financial deltas, approval rules, refund-needed state, document plans, invoice routing, ownership truth, or workflow state.
- This spec adds server actions; they consume the canonical OrderCommit services and do not re-derive in pages or components. No `@/lib/db` imports in `app/**` or `src/components/**`.
- New tests under `tests/order-commits/sales-staging-actions/` and `tests/orders/order-commit-draft-guard/` are wired into `scripts/run-centralization-tests.ts` and pass.
- `npm run test:centralization` passes.
- `npm run test:backend-invariants` passes.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.
