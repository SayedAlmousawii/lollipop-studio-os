## Goal

Phase 6 step 5 (P6-5): the destructive code deletion. With every live dependency cut by P6-2…P6-4, delete the Adjustment Workspace module, its employee-facing route, its components, its tests, the now-dead financial sidebars, and the `bypassOrderCommitDraftGuard` exemption. After this spec the codebase contains no AW code; only the AW database tables remain (dropped in P6-6).

Source of truth: `context/reviews/phase-6-readiness-report.md` (Section C → P6-5). Depends on P6-2, P6-3, P6-4 shipped. This spec must **not** start until a pre-flight grep proves no live importer of the AW module remains outside the files this spec deletes.

## Read First

- `context/reviews/phase-6-readiness-report.md` — Section C → P6-5, Appendix.
- AW module: `src/modules/adjustment-workspace/adjustment-workspace.service.ts`, `adjustment-workspace.schema.ts`, `adjustment-workspace.types.ts`, `pending-changes-view.ts`.
- AW route: `app/orders/[orderId]/adjustment-workspace/page.tsx`, `actions.ts`, `pos-handler-adapters.ts` (route neutralized in P6-1).
- AW-typed / dead components: `src/components/orders/financial-sidebar-adjustment.tsx` (mounted only in the AW route page), `src/components/orders/financial-sidebar-locked.tsx` (already dead — never mounted), `src/components/orders/financial-sidebar-draft.tsx` (superseded by `OrderCommitFinancialSidebar`; confirm no remaining mount).
- AW tests: `tests/adjustment-workspace/**`, `tests/financial/adjustment-reversal.test.ts`, `tests/orders/financial-sidebar-adjustment.test.tsx`, `tests/backend-invariants/locked-adjustment.smoke.ts` (re-home or delete the parts that assert AW-only behavior).
- Direct-mutator legacy functions in `src/modules/orders/order.service.ts` (the five mutators) — delete **only** if callerless after P6-4; otherwise leave with the unconditional draft guard.
- `src/lib/auth/actor-context.ts:6` — `bypassOrderCommitDraftGuard` (delete here; AW finalize was its only beneficiary).
- `src/modules/session-configurations/session-configuration-selection.service.ts` — the Spec 135 `bypassOrderCommitDraftGuard` **option** on `writeOrderPackageSelections` (its only purpose was AW-finalize parity; delete the option, keep the guard call unconditional).
- Shared financial primitives to PRESERVE: `createAdjustmentInvoiceWithClient`, `createCreditNoteWithClient` in `src/modules/invoices/invoice.service.ts` (consumed by `order-commit-execution.service.ts`; not AW-owned).
- **Schema FK awareness (for P6-6, do not change here):** `prisma/schema.prisma` `OrderCommit.legacyAdjustmentWorkspaceId` (`:873,884,892`) and `OrderCommitDraft.legacyAdjustmentWorkspaceId` (`:908,918,924`) hold optional `onDelete: SetNull` FKs to `AdjustmentWorkspace`. These columns + relations are removed in P6-6, not here.

## Rules

- **Pre-flight gate:** before deleting anything, a grep/source-guard run must show zero `@/modules/adjustment-workspace` imports outside the AW module + AW route dir (the P6-1 allowlist must be empty except those dirs). If any remain, stop — a prior spec is incomplete.
- Delete the AW module dir, the AW route dir, the AW-typed/dead sidebars, and AW tests in one spec/PR.
- Remove `bypassOrderCommitDraftGuard` from `ActorContext` and from `writeOrderPackageSelections`'s options; the draft guard call becomes unconditional everywhere.
- Delete the five legacy direct-mutator functions **only** if P6-4 left them callerless; if any caller remains, keep them with the unconditional draft guard and note it. (Do not block this spec on mutator deletion — it is conditional.)
- Preserve `createAdjustmentInvoiceWithClient` / `createCreditNoteWithClient` and all existing FINAL/ADJUSTMENT/CREDIT_NOTE/REFUND financial documents — they are not AW-owned and historical documents stay valid.
- **No Prisma schema change in this spec.** AW tables and the `legacy*` FK columns are dropped in P6-6 (schema-last rule). Leaving the tables temporarily orphaned is intentional and safe.
- Convert the P6-1 source guard from "no new AW imports in app/components" to "no AW imports anywhere" (the AW dir no longer exists to import).
- No `@/lib/db` in `app/**` or `src/components/**`.

## Scope

### In Scope

- Delete `src/modules/adjustment-workspace/**`.
- Delete `app/orders/[orderId]/adjustment-workspace/**`.
- Delete `src/components/orders/financial-sidebar-adjustment.tsx`, `financial-sidebar-locked.tsx`, and `financial-sidebar-draft.tsx` (after confirming no mount remains).
- Delete `tests/adjustment-workspace/**`; delete or re-home AW-only assertions in `tests/financial/adjustment-reversal.test.ts`, `tests/orders/financial-sidebar-adjustment.test.tsx`, `tests/backend-invariants/locked-adjustment.smoke.ts` (keep any non-AW financial coverage by moving it to an OrderCommit-equivalent test).
- Remove `bypassOrderCommitDraftGuard` from `ActorContext` and from `writeOrderPackageSelections` options; make the draft guard unconditional.
- Conditionally delete the five legacy direct mutators if callerless (else retain with unconditional guard).
- Remove deleted test files from `scripts/run-centralization-tests.ts`; tighten the source guard to "no `adjustment-workspace` import anywhere in `src/**`/`app/**`".
- Update `context/progress-tracker.md`.

### Out of Scope

- Dropping `AdjustmentWorkspace` / `AdjustmentWorkspaceEvent` tables, enums, and the `OrderCommit*.legacyAdjustmentWorkspaceId` FK columns (P6-6).
- Any new financial behavior; any change to emitted historical documents.
- Phase 7 items (typed ops history, takeover).

## Implementation Direction

This is a delete-only spec gated by a clean dependency graph. Run the pre-flight grep first; it should come back empty (AW dir + route dir only). Then remove the AW module, route, AW-typed and dead sidebar components, and AW tests together. Strip `bypassOrderCommitDraftGuard` from `ActorContext` and the `writeOrderPackageSelections` options — AW finalize was its sole beneficiary, so the guard becomes unconditional and the Spec 135 behavior is preserved (now without an escape hatch). Check whether P6-4 left the five direct mutators callerless: if yes, delete them; if no, keep them with the unconditional guard and record the remaining caller. Re-home any genuinely non-AW financial assertions out of the AW test files before deleting them so coverage isn't lost. Leave the database tables and the `OrderCommit*.legacyAdjustmentWorkspaceId` columns in place — P6-6 handles schema, preserving the code-before-schema ordering. Convert the source guard to forbid AW imports entirely.

## Observability Checklist

### Dashboards / Metrics

- Remove AW-specific metrics/log lines emitted by deleted code. No new metrics.

### Rollback Plan

- **Destructive.** Rollback = `git revert` of the deletion PR (restores module/route/components/tests and `bypassOrderCommitDraftGuard`). Because P6-6 has not run, the tables still exist, so a revert restores a working AW. Already-emitted financial documents are unaffected (not AW-owned).
- Land only after P6-1…P6-4 have been stable through the agreed bake window (or, given dev-only data, after parity tests prove equivalence per Spec 131).

### Customer-Visible Surface

- None beyond P6-1 (route already redirected). Internally AW no longer exists.

## Acceptance Criteria

- Pre-flight: zero `@/modules/adjustment-workspace` imports outside the deleted dirs before deletion.
- `src/modules/adjustment-workspace/**`, `app/orders/[orderId]/adjustment-workspace/**`, the three sidebar components, and `tests/adjustment-workspace/**` are deleted.
- `bypassOrderCommitDraftGuard` is removed from `ActorContext` and `writeOrderPackageSelections`; the draft guard is unconditional.
- The five legacy direct mutators are deleted (if callerless) or retained with an unconditional guard and a documented remaining caller.
- `createAdjustmentInvoiceWithClient` / `createCreditNoteWithClient` and all historical financial documents are intact.
- No Prisma schema change in this spec; AW tables and `legacy*` FK columns still exist (P6-6 target).
- Source guard forbids any `adjustment-workspace` import in `src/**`/`app/**`.
- Locked-invoice Sales flow has no regression (locked-parity / execution tests pass).
- Deleted tests removed from `test:centralization`; remaining suites pass.
- `npm run test:centralization` passes.
- `npm run test:backend-invariants` passes.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.

## Resolved Decisions

1. **Schema-last.** Tables and `legacy*` FK columns are intentionally left orphaned after P6-5 and dropped in P6-6, preserving code-before-schema ordering and a clean single-PR revert at each step.
2. **Shared primitives stay.** `createAdjustmentInvoiceWithClient` / `createCreditNoteWithClient` are financial primitives, not AW code.

## Open Questions

- Whether the five legacy direct mutators are callerless after P6-4. Resolve by grep at implementation time; the spec handles both outcomes.
