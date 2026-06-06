# Phase 6 Readiness Report — Adjustment Workspace Retirement

**Date:** 2026-06-05
**Scope:** Repo-wide investigation of Adjustment Workspace (AW) vs OrderCommit, and AW retirement readiness.
**Method:** Findings verified against the actual codebase on `development`, not solely the roadmap docs.
**Status of this doc:** Investigation report. Companion to `context/reviews/unified-order-commit-live-pos-roadmap.md` (Phase 6).

---

## Executive answers

1. **AW functionality still in the repo:** the full module (`src/modules/adjustment-workspace/`), the full employee-facing route (`app/orders/[orderId]/adjustment-workspace/` — page + ~15 actions: open/takeover/stage/finalize/cancel), AW-typed UI components, AW tests, and the `AdjustmentWorkspace` + `AdjustmentWorkspaceEvent` tables. It is **fully functional if reached by direct URL.**
2. **Sales workflows still depending on AW:** **None.** The Sales page (`app/orders/[orderId]/sales/page.tsx`) is 100% OrderCommit.
3. **Order/Invoice workflows still bypassing OrderCommit:** the **order-detail** session-config write path and the **AW route's own** actions (the legacy/non-Sales paths). The session-config live-write is now draft-guarded (see R2, resolved).
4. **Unique capability AW still provides:** only the typed event stream (`AdjustmentWorkspaceEvent`) and explicit takeover lifecycle — both deferred to Phase 7, neither workflow-critical. AW has **no remaining Sales capability advantage.**
5. **Hidden dependencies:** yes — see Section A.
6. **Cleanup before retire/delete:** see Section C.

---

## Section A — Current State

### Still using / referencing AW (verified live code)

| # | Location | What it does | Reachable today? |
|---|---|---|---|
| A1 | `app/orders/[orderId]/adjustment-workspace/` (page + actions) | Full AW workspace UI + open/stage/finalize/takeover/cancel | **Yes, by direct URL** — but no inbound link from the active workflow |
| A2 | `src/modules/orders/composition/order-composition.service.ts:143` | `getOrderCompositionViewModel` queries `adjustmentWorkspace.findFirst({status: OPEN})` and routes to AW composition | **Live read path** — called by the order-detail page (`app/orders/[orderId]/page.tsx:112`). Dead-in-practice (Sales never creates AW rows) but still executes |
| A3 | `app/orders/[orderId]/actions.ts:11-13` | `configureSessionAction` → `applyEdit` (AW edit) + `adjustmentWorkspaceEditSchema` | Bound into `ConfigureSessionPanel`; only fires in `locked`/AW mode, not Sales |
| A4 | `src/components/session-configurations/configure-session-panel.tsx:140,393` | AW deep-link `Edit in Adjustment Workspace` | Renders **only** when `mode.kind === "locked"` — **not** on the Sales `commit-staging` surface |
| A5 | `src/modules/orders/policies/edit-mode-policy.ts:147,257` | Central policy still emits `shouldOpenAdjustmentWorkspace: true` + AW route href | Consumed by `pos-package-composition.tsx:195`; on Sales the OrderCommit overlay neutralizes it |
| A6 | `src/modules/composition-view/composition-view.model.ts:4` | Imports AW types; `CompositionViewMode = "locked" \| "adjustment"` | Type-only coupling |
| A7 | `src/components/orders/financial-sidebar-adjustment.tsx` | AW-typed sidebar | Mounted **only** inside the AW route page |
| A8 | `tests/adjustment-workspace/**`, `tests/financial/adjustment-reversal.test.ts`, `tests/orders/financial-sidebar-adjustment.test.tsx`, `locked-adjustment.smoke.ts` | AW test coverage | Active in suites |

### No longer using AW (migrated to OrderCommit)

- **The entire Sales page** (`/orders/[orderId]/sales`) — OrderCommit draft → preview → commit, all five staging domains (`PACKAGE`, `PHOTO`, `PACKAGE_ITEM_UPGRADE`, `SESSION_CONFIGURATION`, `ADD_ON`) per Specs 125–143.
- **Order-detail page is read-only:** the "Selection Workspace" card just links to **Open POS** (`/sales`) — no AW link, no configure action (`app/orders/[orderId]/page.tsx:589-603`).
- **The only AW nav link left in the whole app** is in `financial-sidebar-locked.tsx:152` — and that component is **never imported/mounted** (dead file).
- **`FinancialSidebarLocked` and `FinancialSidebarDraft`** are superseded by `OrderCommitFinancialSidebar`.
- **Financial primitives are already shared, not AW-owned:** `createAdjustmentInvoiceWithClient` / `createCreditNoteWithClient` live in `invoices/invoice.service.ts` and are consumed by `order-commit-execution.service.ts` — they survive AW deletion.

---

## Section B — Remaining Gaps

### Blockers to *deletion* (not to retirement)
Live code dependencies that must be cut before deletion is safe — all are cleanup, none are missing capability:

1. **B1 — Composition read branch (A2).** `getOrderCompositionViewModel` imports `getAdjustmentWorkspaceView` / `getPendingAdjustmentOrderCompositionViewModel` and queries open AW rows. Deleting the AW module breaks this import. Remove the open-AW branch from the canonical composition service first.
2. **B2 — Order-detail AW action (A3).** `configureSessionAction`→`applyEdit` and `adjustmentWorkspaceEditSchema` import the AW module. Bound into `ConfigureSessionPanel`. Cut it.
3. **B3 — Configure-panel AW mode + deep-link (A4).** The `adjustment` panel mode and the `Edit in Adjustment Workspace` link.
4. **B4 — Policy AW fields (A5).** `shouldOpenAdjustmentWorkspace`, `openAdjustmentWorkspaceId`, `routeTarget` AW href, and the `LOCKED_INVOICE_WORKSPACE_REQUIRED` branch in `order.service.ts`.
5. **B5 — Composition-view type coupling (A6).** `CompositionViewMode = "locked" | "adjustment"`.

### Hidden risks

- **R1 — The AW route is still URL-reachable** (`/orders/[orderId]/adjustment-workspace`). No UI link points to it, but nothing blocks a bookmarked/typed URL from opening a *new* workspace via `openAdjustmentWorkspaceAction`. If a workspace is opened there, the direct-mutator guard and the AW finalize bypass (`bypassOrderCommitDraftGuard: true`, `adjustment-workspace.service.ts:739`) mean AW and OrderCommit could both act on the same order. **This is the single most important open risk** and the reason "make read-only / hide" should land before deletion.

- **R2 — Non-Sales session-config live-write bypass. ✅ RESOLVED (2026-06-05, Spec 135 recovered, PR #222 merged).**
  `writeOrderPackageSelections` (`session-configuration-selection.service.ts:293`) now calls `assertNoActiveOrderCommitDraft` inside its transaction — after the missing-package throw, before the locked-invoice check and any selection writes. The non-Sales session-configuration write path can no longer bypass an open `OrderCommitDraft`.
  - **Root cause:** Spec 135 *had* been implemented (commit `ad99aff`) but was lost with the corrupted desktop clone and never reached `origin` — not a design omission. Recovered from backup, re-validated (centralization 581/0, financial-invariants, build, lint), merged as `1d58163`.
  - The roadmap's claim that "the Spec 135 hotfix guard remains the rail for non-Sales callers until Phase 6" was false at the time of the original report; it is now **true**.
  - An optional `bypassOrderCommitDraftGuard` option was added but **no caller passes it** (only callers are `app/orders/[orderId]/actions.ts:189,199`).

- **R3 — Documented financial divergence.** Spec 131 parity tests (`tests/order-commits/order-commit-locked-parity.test.ts`) record **intentional** differences: AW emits a negative `ADJUSTMENT` for reductions where OrderCommit emits a `CREDIT_NOTE`, and the two use a different `refundPending` threshold. OrderCommit is the canonical target, so this is acceptable — but it means AW and OrderCommit are *not* byte-identical, so "fall back to AW" after deletion is not behavior-neutral.

### Missing parity (AW has, OrderCommit lacks)
- **Typed event history** — AW's `AdjustmentWorkspaceEvent` stream vs OrderCommit's generic `pendingOpsJson` (`SNAPSHOT_REPLACED`). Deferred to Phase 7, audit-only, non-blocking.
- **Explicit takeover action** — AW's `takeOverWorkspace` vs OrderCommit's owner/version concurrency (no `takeOverOrderCommitDraft` yet). Deferred to Phase 7, non-blocking.

**Conclusion:** there is **no missing business capability** blocking retirement. Every blocker is dependency-cleanup, not feature parity.

---

## Section C — Recommended Phase 6 Breakdown

Split the roadmap's single Phase 6 into a **hide → cut → delete** sequence so each PR is independently revertible and the destructive step lands last.

### Spec P6-1 — Hide & freeze AW (retirement-prep, non-destructive)
- Make the AW route read-only or redirect `/orders/[orderId]/adjustment-workspace` → `/sales` (closes **R1**).
- Add a repo grep/lint guard: no new `adjustment-workspace` imports in `app/` or `src/components/`.
- **No deletions.** Fully revertible. Makes AW safe to leave dormant.
- *Note:* the R2 guard is already in place as of Spec 135, so it is no longer part of this spec.

### Spec P6-2 — Cut the composition read dependency (B1)
- Remove the open-AW branch from `getOrderCompositionViewModel`; delete `getPendingAdjustmentOrderCompositionViewModel` and the AW imports in `order-composition.service.ts`.
- Verify order-detail composition reads `Order*` rows only.
- Highest-care spec — gate on full centralization + composition tests.

### Spec P6-3 — Cut order-detail & configure-panel AW wiring (B2, B3, B5)
- Delete `configureSessionAction`→`applyEdit` branch + `adjustmentWorkspaceEditSchema` import from order-detail `actions.ts`.
- Remove the `adjustment` mode + `Edit in Adjustment Workspace` link from `ConfigureSessionPanel`.
- Collapse `CompositionViewMode` to `"locked"` only.

### Spec P6-4 — Cut policy AW affordances (B4)
- Remove `shouldOpenAdjustmentWorkspace`, `openAdjustmentWorkspaceId`, AW `routeTarget`, and `LOCKED_INVOICE_WORKSPACE_REQUIRED` from `edit-mode-policy.ts` / `order.service.ts`.
- The direct-mutator guard becomes an unconditional draft guard (the AW-finalize `bypassOrderCommitDraftGuard` exemption is now removable).

### Spec P6-5 — Delete AW module, route, tests, dead files (destructive)
- Delete `src/modules/adjustment-workspace/**`, `app/orders/[orderId]/adjustment-workspace/**`, `tests/adjustment-workspace/**`.
- Delete dead files: `financial-sidebar-locked.tsx`, `financial-sidebar-adjustment.tsx`, `financial-sidebar-draft.tsx`.
- Delete the legacy direct-mutator functions if callerless after P6-4.
- Remove `bypassOrderCommitDraftGuard` from `ActorContext` and from `writeOrderPackageSelections` (dead once AW finalize is gone — see R2 carry-forward).

### Spec P6-6 — Drop AW tables (migration cleanup, last)
- After P6-5 confirms zero code references and zero open rows: `prisma` migration to drop `AdjustmentWorkspace` + `AdjustmentWorkspaceEvent`. Verify no FK points at them first.

**Deletion sequence:** P6-1 (hide) → P6-2 (composition) → P6-3 (order-detail/panel) → P6-4 (policy) → P6-5 (module/route/files) → P6-6 (schema). Code before schema; destructive steps last.

---

## Section D — Go / No-Go

### Can Adjustment Workspace be retired now?

**GO — qualified.** Both roadmap gating conditions are met:
- ✅ **Domain coverage complete** — all five staging domains route through OrderCommit on the Sales surface (Specs 136–138 + display fixes 139–143).
- ✅ **Parity tests exist and pass** (`order-commit-locked-parity.test.ts`, `order-commit-execution.test.ts`, `aw-finalize-bypasses-guard.test.ts`), with divergences documented and intentional (R3).
- ✅ **No Sales workflow depends on AW**; AW has no remaining capability advantage.

**Therefore:**
- **Make read-only / hide from normal workflows: YES, now** (Spec P6-1). The AW route already has no inbound links; redirecting it is safe and non-destructive.
- **Retire (stop all new usage): YES, after P6-2 → P6-4** cut the remaining live dependencies.
- **Delete module/route: YES, after P6-5**, once P6-2…P6-4 leave AW callerless.
- **Drop tables: YES, last (P6-6)**, after confirming zero references and zero open rows.

### Exact work remaining before *deletion*
1. Remove the open-AW branch from `getOrderCompositionViewModel` (B1) — **the one true code blocker.**
2. Cut `configureSessionAction`→`applyEdit` + schema import in order-detail actions (B2).
3. Remove the `adjustment` panel mode + AW deep-link (B3) and the `CompositionViewMode` `"adjustment"` member (B5).
4. Strip AW fields from `edit-mode-policy` / `order.service` (B4) and remove the `bypassOrderCommitDraftGuard` exemption.
5. Close R1 (AW route reachable by URL) — ideally first, in P6-1.

### Discrepancies between roadmap and code (as of this report)
- **Spec 135 ("hotfix guard on `writeOrderPackageSelections`")** was described as shipped in the roadmap but was actually lost to git corruption and missing from the repo at the time of the original investigation. **Now recovered and merged (PR #222).** The roadmap framing is finally accurate; the roadmap still lists Spec 135 as "Planned … lands now/first" and could be updated to "shipped" when convenient.
- Phase 4's "Remove normal UI links to AW" is done — but the **route itself was never made unreachable**, only unlinked. Direct-URL access (R1) is still open.

---

## Appendix — Evidence summary

- Sales page (`app/orders/[orderId]/sales/page.tsx`): no AW import; uses `getSalesPageView`, staging adapters, `commitOrderChanges`.
- AW residual references outside the module: `order-composition.service.ts` (A2), order-detail `actions.ts` (A3), `configure-session-panel.tsx` (A4), `edit-mode-policy.ts` (A5), `composition-view.model.ts` (A6), `financial-sidebar-adjustment.tsx` (A7).
- Only AW nav link in app: `financial-sidebar-locked.tsx:152` (dead — component never mounted).
- Direct-mutator guard: all five mutators in `order.service.ts` call `assertNoActiveOrderCommitDraft` + `assertDirectPOSMutationAllowed`; AW finalize bypasses via `bypassOrderCommitDraftGuard: true`.
- Shared financial primitives confirmed in `invoices/invoice.service.ts`, consumed by `order-commit-execution.service.ts`.
- R2 guard confirmed live at `session-configuration-selection.service.ts:293` post-merge.
