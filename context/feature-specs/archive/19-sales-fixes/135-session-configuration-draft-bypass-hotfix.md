## Goal

Close a live correctness gap: session-configuration writes from the Sales surface currently bypass an active `OrderCommitDraft`. The five legacy POS mutators (`updateOrderPackage`, `upgradeOrderPackageItem`, `addOrderProductAddOn`, `removeOrderAddOn`, `updateOrderSelectedPhotoCount`) all refuse when a draft exists (Spec 126), but `writeOrderPackageSelections` — the sole production writer of session-configuration selections and selection-owned linked add-ons — was never added to that guard. As a result, with a draft open, a staff member can stage package/photo changes into the draft while a session-configuration edit lands **live** on `Order*` rows and is silently excluded from the eventual commit.

This is a **hotfix**, intentionally minimal: it makes `writeOrderPackageSelections` refuse when an active `OrderCommitDraft` exists for the order, exactly mirroring the existing five-mutator guard. It does **not** add OrderCommit staging for session configuration — that is Spec 137, which supersedes the refusal with real draft routing. After this spec, no Sales-surface write can quietly bypass an active draft.

## Read First

- `context/reviews/unified-order-commit-live-pos-roadmap.md` — Phase 5 Design Notes → "Legacy direct-mutator guard (Spec 126, safety rail)" and the AW-finalize exemption contract.
- `/tmp/pos-domain-blocked-workflows-investigation.md` — §1 (workflow #5/#6/#7), §4 (the unguarded-bypass soft dependency). The investigation is the source of truth for this spec.
- `src/modules/orders/policies/order-commit-draft-guard.ts` — existing `assertNoActiveOrderCommitDraft({ orderId, actorContext, tx })`. Reuse this helper; do not write a second one.
- `src/lib/auth/actor-context.ts:6` — `ActorContext.bypassOrderCommitDraftGuard?: boolean`, the existing exemption field. AW finalize sets it (`adjustment-workspace.service.ts:739`).
- `src/modules/session-configurations/session-configuration-selection.service.ts:251` — `writeOrderPackageSelections(orderPackageId, desiredSelections, actor, options)`. Its `actor` param is `SessionConfigurationActor` (`{ id, role }`), not an `ActorContext`. It loads `orderPackage` (with `orderId`) at the top of its transaction.
- `app/orders/[orderId]/actions.ts:125` — `configureSessionAction`, the only action calling `writeOrderPackageSelections` (locked-operational path at `:189`, draft path at `:199`).
- `src/modules/orders/order.service.ts:1228` — reference invocation of `assertNoActiveOrderCommitDraft` inside a legacy mutator, for the exact placement/ordering pattern to copy.

## Rules

- Implementation-only after approval. No UI changes, no new schema, no new error class, no change to OrderCommit staging, preview, or commit behavior.
- Reuse the existing `assertNoActiveOrderCommitDraft` helper and the existing `OrderCommitDraftActiveError`. Do not introduce new guard helpers or error types.
- The guard runs **inside** `writeOrderPackageSelections`'s existing transaction, after the `orderPackage` row (which carries `orderId`) is loaded, and **before** any selection write. It must use the same `tx` so the read is transaction-consistent.
- The guard must be exemptable via `bypassOrderCommitDraftGuard`, identical to the five-mutator pattern, so no legitimate internal caller is broken. Verify whether any internal caller needs the exemption (see Implementation Direction Task 0); only wire the exemption where a real internal caller exists.
- Behavior parity with the five mutators: when a draft exists and the caller is not exempt, throw `OrderCommitDraftActiveError`; when no draft exists, behavior is unchanged.
- This guard is a **temporary safety rail**. Spec 137 replaces the refusal with draft routing for the Sales surface. Write the guard so Spec 137 can supersede it cleanly (single call site, no scattered logic).
- No `@/lib/db` imports added to `app/**`. No new public surface; no Adjustment Workspace naming.

## Scope

### In Scope

- Add an active-draft guard to `writeOrderPackageSelections`:
  - Inside the existing transaction, immediately after the `orderPackage` lookup that yields `orderId`, call `assertNoActiveOrderCommitDraft({ orderId, actorContext, tx })`.
  - Because `writeOrderPackageSelections` receives `SessionConfigurationActor` (`{ id, role }`) rather than an `ActorContext`, thread the bypass intent through the existing `options` argument (e.g. a new `options.bypassOrderCommitDraftGuard?: boolean`) and construct the minimal `ActorContext` the helper needs (`{ actorUserId: actor.id, actorRole: actor.role, bypassOrderCommitDraftGuard: options.bypassOrderCommitDraftGuard }`). Do not change the public positional signature of `writeOrderPackageSelections` beyond the additive `options` field.
- Confirm the two `configureSessionAction` call sites (`:189` locked-operational, `:199` draft) pass no bypass (they are the Sales-surface callers that must be guarded).
- Tests under `tests/session-configurations/` (or `tests/order-commits/` if that is where guard tests already live):
  - `writeOrderPackageSelections` refuses with `OrderCommitDraftActiveError` when an active `OrderCommitDraft` exists for the order.
  - `writeOrderPackageSelections` succeeds (regression) when no draft exists, for both the draft and the locked-operational (`allowPostLock`) paths.
  - If an internal exempt caller is identified in Task 0, a test proving the exemption lets that caller through with a draft present.
  - Guard ordering: with both an active draft and a locked invoice, the caller sees the draft error, not the locked-invoice message (mirrors the five-mutator ordering test).
- Wire new tests into `scripts/run-centralization-tests.ts` (the `test:centralization` runner).
- Update `context/progress-tracker.md`.

### Out of Scope

- No OrderCommit session-configuration staging, handler contract, or UI routing. That is Spec 137.
- No change to `ConfigureSessionPanel`, the Sales page, or any component.
- No change to the AW adjustment-mode session-configuration path (`applySessionConfigurationWorkspaceEditAction`).
- No change to the OrderCommit session-configuration reducer, materializer, or `resolveStagedSessionConfiguration`.
- No new schema, table, column, or migration.
- No change to the financial-vs-operational behavior split inside `configureSessionAction`.

## Implementation Direction

### Task 0 — Caller audit (do this first)

Enumerate every caller of `writeOrderPackageSelections`. Current callers are `configureSessionAction:189` and `:199` only. Confirm:

- The OrderCommit materializer does **not** call it (it wires selections through its own helpers in `order-commit-materialization.service.ts`). If this is still true, the materializer needs no exemption.
- AW finalize does **not** call it directly. If still true, no AW exemption is needed here.

If, and only if, an internal caller is found that must write selections while a draft legitimately exists, wire `options.bypassOrderCommitDraftGuard: true` for that caller. Otherwise omit the exemption wiring entirely (the `options` field may still be added for forward use, defaulting to `false`).

### Task 1 — Guard inside `writeOrderPackageSelections`

Inside the existing `db.$transaction` body, after the `orderPackage` lookup resolves `orderId`, insert:

```
await assertNoActiveOrderCommitDraft({
  orderId: orderPackage.orderId,
  actorContext: {
    actorUserId: actor.id,
    actorRole: actor.role,
    bypassOrderCommitDraftGuard: options.bypassOrderCommitDraftGuard ?? false,
  },
  tx,
});
```

Placement: after the `orderPackage` read, before the first selection mutation. The pre-existing locked-invoice / `allowPostLock` logic stays exactly as-is and runs after the draft guard (parity with how the five mutators run the draft guard before `assertDirectPOSMutationAllowed`).

### Task 2 — Tests + tracker

Add the focused tests listed in Scope, wire them into the centralization runner, and update the progress tracker with a one-line entry describing the closed bypass.

## Observability Checklist

### Dashboards / Metrics

- None added. The guard reuses the existing `OrderCommitDraftActiveError` path; no new counters.

### Rollback Plan

- Pure code change, no schema. Rollback = revert the guard call. No data migration, no non-recoverable state.

### Customer-Visible Surface

- Staff who attempt a session-configuration edit while a draft is open now see the same "an order commit draft is in progress" message the other five edits already produce, instead of the edit silently landing live. No customer-facing change.

## Post-Implementation

- `context/progress-tracker.md` — add a "Now" line: session-configuration writes now respect the active-draft guard; Sales-surface writes can no longer bypass an open `OrderCommitDraft`.
- Note in the tracker that Spec 137 supersedes this refusal with draft routing.

## Acceptance Criteria

- `writeOrderPackageSelections` throws `OrderCommitDraftActiveError` when an active `OrderCommitDraft` exists for the order and the caller is not exempt.
- `writeOrderPackageSelections` behavior is unchanged when no draft exists (both draft and `allowPostLock` paths).
- With both a draft and a locked invoice, the draft error wins (ordering parity with the five mutators).
- No internal caller (materializer, AW finalize) is broken; any required exemption is wired explicitly and tested.
- No UI, schema, or OrderCommit staging behavior changed.
- New tests are wired into `test:centralization`.
- `npm run test:centralization` passes.
- `npm run build` passes.
- `npm run lint` passes.
