# Post-Centralization Architecture & Code-Quality Audit

Date: 2026-05-20
Author: Codex (Claude)
Scope: Studio OS, post-R0–R13 centralization roadmap closure
Status: Read-only audit. No code changes; no commits.

Source set consulted:
- `context/AGENTS.md` (project root)
- `context/architecture-context.md`, `context/code-standards.md`, `context/ai-workflow-rules.md`, `context/progress-tracker.md`
- `context/reviews/centralization-roadmap.md`, `context/reviews/r13-freeze-checklist.md`, `context/reviews/r13-verification-inventory.md`
- Direct inspection of `src/modules/**`, `src/components/**`, `app/**`, `tests/**`, root-level git log.
- The original `centralization-inventory.md` is now under `context/reviews/archive/15-centralization/` per R0 and was not re-read; the roadmap supersedes it.

---

## 0. Executive Summary

R0–R13 delivered what it set out to do. The financial read layer, composition view model, edit-mode policy, and four workflow policy builders all exist as separate, narrowly-scoped modules; pages and components no longer compute money, derive payment status, hardcode workflow actions, or import the DB. The architecture-guard test suite (`tests/architecture/**`, `tests/formatting/money-regression.test.ts`, `tests/orders/centralization-cleanup.test.ts`) now mechanically prevents the most common regressions.

What remains is not another giant refactor. It is **stabilization debt**: a handful of large service files that grew during the roadmap, one stale `console.info` parity metric on the order detail page, a known performance follow-up in `orders-table-projections.service.ts`, residual sales-page commit-through duplication with adjustment-workspace, and a documentation gap (no "business rule → test" map). The system is ready for normal feature development; the work below is targeted cleanup and verification, not redesign.

**Top concrete risks** are concentrated in three places:
1. The size and breadth of [order.service.ts](src/modules/orders/order.service.ts) (5028 lines, 27+ exports — read, write, mapping, guards) and [adjustment-workspace.service.ts](src/modules/adjustment-workspace/adjustment-workspace.service.ts) (3014 lines).
2. The `orders-table-projections.service.ts` performance follow-up explicitly carried forward in [progress-tracker.md:140](context/progress-tracker.md#L140).
3. The absence of a business-rule inventory — invariants are coded and tested, but not enumerated in one place owners can sign against.

Detailed findings follow. Each finding is classified STRONG / ACCEPTABLE / WATCH / WEAK / HIGH RISK, with file references and a recommended next action.

---

## 1. Findings by Area

### 1.1 Financial Architecture

#### 1.1.1 Canonical financial read model — **STRONG**

- Source of truth: [src/modules/financial-cases/financial-case-summary.service.ts](src/modules/financial-cases/financial-case-summary.service.ts) (319 lines); single `getFinancialCaseSummary({ financialCaseId | orderId | bookingId })` entry point.
- Projectors live in [src/modules/financial-cases/projections/](src/modules/financial-cases/projections/) — 8 small files, 15–54 lines each. Each surface gets exactly one projector. No duplication across them.
- The summary reuses canonical math from [src/modules/invoices/invoice.calculation.ts](src/modules/invoices/invoice.calculation.ts), [src/modules/invoices/invoice.service.ts](src/modules/invoices/invoice.service.ts) (capacity functions), and [src/modules/orders/order-settlement.ts](src/modules/orders/order-settlement.ts). No re-derivation.
- Booking-stage handling is explicit (`stage: "booking" | "active"`), not synthesized.
- Risk: low. Architecture guard [tests/architecture/financial-case-read-layer-cleanup.test.ts](tests/architecture/financial-case-read-layer-cleanup.test.ts) prevents regression.
- Action: **leave alone**.

#### 1.1.2 Legacy financial helpers — **STRONG** (verified removed)

- `summarizeInvoices`, `mapPaymentStatus`, `deriveOrderDetailsFinancialSummary`, `getOrderFinancialSummary`, `getOrderSettlementInvoices` — grep across `src/` and `app/` returns zero matches. R12 cleanup confirmed.
- Tests pin removal: [tests/orders/centralization-cleanup.test.ts](tests/orders/centralization-cleanup.test.ts).
- Action: **leave alone**.

#### 1.1.3 Stale parity metric on order detail page — **WATCH**

- [app/orders/[orderId]/page.tsx:139-148](app/orders/[orderId]/page.tsx#L139-L148) still emits `console.info({ metric: "order_details.financials_tab.rendered", ... })` on every active-stage render. R6 removed the discrepancy logger; this looks like a leftover surface marker that no longer corresponds to a logged metric of interest.
- Risk: low — pollutes server logs, makes log-grep harder during incident response.
- Action: **fix now (small)**. Either remove or convert to a structured telemetry call with a documented purpose.

#### 1.1.4 `orders-table-projections.service.ts` — **WATCH**

- 326 lines, batched loader that mostly duplicates the per-row settlement construction of [financial-case-summary.service.ts](src/modules/financial-cases/financial-case-summary.service.ts) for performance (batching). It is the only "second financial path" that exists in the codebase and is explicitly carried forward as a known follow-up in [progress-tracker.md:140](context/progress-tracker.md#L140).
- Risk: drift — any change to `FinancialCaseSummary` semantics must be mirrored here. Currently guarded by parity tests ([tests/orders/orders-table-customer-history-parity.test.ts](tests/orders/orders-table-customer-history-parity.test.ts)) which makes drift detectable but not impossible.
- Action: **R14 candidate**. Refactor so the batched table loader internally builds a per-row `FinancialCaseSummary` (or a slim subset) and feeds the same `toOrdersTableRow` projector — preserving batching, removing the parallel derivation path.

#### 1.1.5 Reconciliation & invariants — **STRONG**

- [src/modules/financial/invariants.ts](src/modules/financial/invariants.ts) (1053 lines) and [src/modules/financial/reconciliation-invariants.ts](src/modules/financial/reconciliation-invariants.ts) (466 lines) are sizable but reflect the genuine breadth of financial invariants — not duplication. Catalog generation lives in [invariant-catalog.ts](src/modules/financial/invariant-catalog.ts).
- Reconciliation runner ([scripts/financial-reconciliation.ts](scripts/financial-reconciliation.ts)) runs in a `READ ONLY` transaction; nightly schedule + Healthchecks ping documented.
- Risk: production wiring is **deferred** — `FINANCIAL_RECON_DATABASE_URL`, `FINANCIAL_RECON_SLACK_WEBHOOK`, `FINANCIAL_RECON_SLACK_CHANNEL`, `RECONCILIATION_PING_URL` are still unconfirmed in the production GitHub Actions environment (see r13-freeze-checklist §5). Until those exist, nightly reconciliation cannot alert in production.
- Action: **fix now (operational)** — already on the open-follow-ups list; should not be allowed to bit-rot.

#### 1.1.6 `order.service.ts` still contains low-level financial helpers — **ACCEPTABLE**

- `getLinkedFinancialDocumentsForOrder`, `recordPOSPaymentForOrder` live in [src/modules/orders/order.service.ts](src/modules/orders/order.service.ts) alongside read loaders and write operations.
- Ownership is correct (orders module proxies to invoice/payment services), but their presence inflates the file. Not a correctness risk.
- Action: **backlog**. If `order.service.ts` is ever split (see 1.7.1), separate read loaders from write actions then.

---

### 1.2 POS / Order Composition Architecture

#### 1.2.1 `OrderCompositionViewModel` core + projectors — **STRONG**

- Service: [src/modules/orders/composition/order-composition.service.ts](src/modules/orders/composition/order-composition.service.ts) (1131 lines) exposes `getDraftOrderCompositionViewModel`, `getLockedOrderCompositionViewModel`, `getPendingAdjustmentOrderCompositionViewModel`, `getOrderCompositionViewModel`.
- Projectors live in [src/modules/orders/composition/projections/](src/modules/orders/composition/projections/) — 8 files, 20–272 lines, one per surface (`to-draft-pos-composition`, `to-locked-pos-composition`, `to-current-composition-card`, `to-overview-tab`, `to-production-deliverables`, `to-pos-add-on-marketplace`, `to-operational-configurations-display`, plus `photo-line-draft` helpers).
- Structured `displayKind` / `fromLabel` / `toLabel` metadata is in place — no label parsing in `composition-view.model.ts`.
- Action: **leave alone**.

#### 1.2.2 `order-composition.service.ts` size — **WATCH**

- 1131 lines for one service file. Inside, mapping helpers (`mapPOSPackageLine`, `mapPOSPackageItem`, `mapPOSExtraPhotoLines`, `mapPOSSessionConfigurationLines`, `mapAdjustmentCompositionLine`, `metadataFor*`, `categoryLabelForLine`, etc.) make up most of the bulk. Public API is small and clean.
- Risk: low for correctness, moderate for navigability and AI-agent context cost.
- Action: **backlog**. Consider splitting into `order-composition.service.ts` (entry points + orchestration), `composition-from-pos.ts`, `composition-from-adjustment.ts`, `composition-metadata.ts`. Cosmetic, not urgent.

#### 1.2.3 `pos-package-composition.tsx` still 1116 lines — **WATCH**

- [src/components/orders/pos-package-composition.tsx](src/components/orders/pos-package-composition.tsx) — large React component with 3 `useState`s, multiple sub-components, photo draft state. Confirmed it no longer computes financial totals (uses `formatMoney`, no `parseFloat`, no internal totaling). Photo helpers were extracted to [src/modules/orders/composition/projections/photo-line-draft.ts](src/modules/orders/composition/projections/photo-line-draft.ts) in R8a.
- Risk: low business-logic risk; primarily a UI maintainability concern. Reductions, sub-cards, and add-on quick actions could be separate files.
- Action: **backlog**. Split into `pos-package-composition.tsx`, `pos-photo-card.tsx`, `pos-session-configuration-row.tsx`. Not blocking.

#### 1.2.4 Sales page commit-through vs Adjustment Workspace staged handlers — **ACCEPTABLE**

- Two parallel handler tracks: sales passes server-action commit-through adapters with inline reductive approval enabled ([app/orders/[orderId]/sales/page.tsx](app/orders/[orderId]/sales/page.tsx)); adjustment workspace passes staged-edit adapters with inline approval disabled, finalize-time approval preserved ([app/orders/[orderId]/adjustment-workspace/pos-handler-adapters.ts](app/orders/[orderId]/adjustment-workspace/pos-handler-adapters.ts)).
- Adapter contract is defined and shared in [src/modules/orders/pos-handlers.types.ts](src/modules/orders/pos-handlers.types.ts).
- Risk: low; this duality is intentional (R8 design) and well-typed. Watch for handler shape divergence over time.
- Action: **leave alone**, plus add a single contract test asserting both adapter sets implement the full `POSCompositionHandlers / POSAddOnHandlers` surface (likely already present in `tests/orders/pos-handler-components.test.tsx` — verify).

#### 1.2.5 `derivePOSWorkspaceFromAdjustmentWorkspace` bridge — **ACCEPTABLE**

- Bridge between adjustment-workspace state and shared POS UI lives in [src/modules/adjustment-workspace/adjustment-workspace.service.ts](src/modules/adjustment-workspace/adjustment-workspace.service.ts) (function exported around line 228). Documented invariants 15–17 cover it.
- Risk: moderate — this is the most complex remaining read-write seam. Already covered by adjustment-workspace tests; future regressions usually manifest as photo-baseline drift (recently fixed in `f074dfd`).
- Action: **backlog** — consider documenting the bridge contract in a short README under `src/modules/adjustment-workspace/`.

---

### 1.3 Order Detail / Page Composition

#### 1.3.1 [app/orders/[orderId]/page.tsx](app/orders/[orderId]/page.tsx) — **ACCEPTABLE**

- 943 lines, but the top-level `OrderDetailPage` function (lines 87–270) is purely orchestration: parallel data fetch via `Promise.all`, projector calls, hand-off to tab components. No math, no business decisions.
- Lines below 270 are the per-tab presentational components (`ProductionTab`, `DeliveryTab`, `EditingTab`, `OverviewTab`, `FinancialsTab`, list renderers, `WorkflowStrip`, `HeaderMetric`, etc.). They use `formatMoney` for display only.
- Risk: low business-logic risk; the file is large and could be split into `app/orders/[orderId]/_components/*.tsx`. Not urgent.
- Action: **backlog**. The "no business logic on page" goal of R11 has been achieved.

#### 1.3.2 [app/orders/[orderId]/sales/page.tsx](app/orders/[orderId]/sales/page.tsx) — **STRONG**

- 409 lines, branches once on `workspace.invoice?.isLocked` and delegates to projectors + handler adapters. No math.
- Action: **leave alone**.

#### 1.3.3 [app/orders/[orderId]/adjustment-workspace/page.tsx](app/orders/[orderId]/adjustment-workspace/page.tsx) — **STRONG**

- 400 lines; renderer + projector consumption.
- Action: **leave alone**.

#### 1.3.4 [app/orders/[orderId]/actions.ts](app/orders/[orderId]/actions.ts) — **ACCEPTABLE**

- 481 lines, 7 server actions. Each one validates → permission-checks → calls a service → revalidates. No direct DB imports (verified).
- Action: **leave alone**.

#### 1.3.5 Stale `console.info` parity metric (duplicate of 1.1.3) — **WATCH**

- Already listed under financial findings; recording here so the page-thinning view of the audit doesn't miss it.

---

### 1.4 Workflow and Edit-Mode Policies

#### 1.4.1 `OrderEditModePolicy` — **STRONG**

- [src/modules/orders/policies/edit-mode-policy.ts](src/modules/orders/policies/edit-mode-policy.ts) (289 lines) returns `{ canEditDirectly, isInteractive, shouldOpenAdjustmentWorkspace, requiresManagerApproval, openWorkspaceIsActive, blockedReason, routeTarget, userFacingMessage }`.
- Used by POS package composition, POS add-on marketplace, draft sidebar, configure-session routing, and `app/orders/[orderId]/actions.ts`.
- Service-layer guards (`assertDirectPOSMutationAllowed` in [order.service.ts:208](src/modules/orders/order.service.ts#L208)) remain authoritative. Tests pin alignment ([tests/orders/order-edit-mode-policy.test.ts](tests/orders/order-edit-mode-policy.test.ts), [tests/adjustment-workspace/edit-mode-policy-action.test.ts](tests/adjustment-workspace/edit-mode-policy-action.test.ts), interactivity-parity test).
- **Watch:** the policy and the guards both encode the same predicate (`finalInvoiceIsLocked && !openAdjustmentWorkspaceId → routeTarget`). They are consistent today via test pinning; there is no single shared predicate function. If a future edit kind is added, both must be updated together.
- Action: **backlog / business-rule documentation candidate** — extract the predicate set into one named helper that both the policy and the service guard call.

#### 1.4.2 Workflow policy builders — **STRONG**

- One file per area:
  - [src/modules/orders/policies/delivery-workflow-policy.ts](src/modules/orders/policies/delivery-workflow-policy.ts) (422 lines)
  - [src/modules/orders/policies/editing-workflow-policy.ts](src/modules/orders/policies/editing-workflow-policy.ts) (291 lines)
  - [src/modules/orders/policies/production-workflow-policy.ts](src/modules/orders/policies/production-workflow-policy.ts) (567 lines)
  - [src/modules/bookings/](src/modules/bookings/) — booking workflow policy (R10a)
- Each has its own state-matrix test plus `tests/orders/workflow-action-availability-parity.test.ts` cross-checking.
- Delivery policy reads payment settlement from `FinancialCaseSummary` — no `summarizeInvoices` fallback.
- Action: **leave alone**.

#### 1.4.3 `production-workflow-policy.ts` size — **WATCH**

- 567 lines; mostly state-matrix data, blocker enumeration, and label maps. Not duplication.
- Action: **leave alone**; consider extracting label constants if it grows further.

#### 1.4.4 Service guards vs policy alignment — **ACCEPTABLE**

- No single source for the predicates yet; alignment is via test fixtures. Acceptable in practice because all four workflow-policy tests + interactivity-parity test would catch drift.
- Action: **R14 candidate** if introducing a 5th workflow surface; until then, **leave alone**.

---

### 1.5 Shared UI / Data Boundaries

#### 1.5.1 Service-only DB access — **STRONG**

- `grep "@/lib/db" app/ src/components/` returns 0 results.
- Pinned by [tests/architecture/service-only-db-access.test.ts](tests/architecture/service-only-db-access.test.ts).
- Action: **leave alone**.

#### 1.5.2 Money formatting centralization — **STRONG**

- All call sites import from [src/lib/formatting/money.ts](src/lib/formatting/money.ts) (`formatMoney`, `formatSignedMoney`, `parseMoneyInput`, `formatMoneyInputValue`).
- No formatted-string parsing in components; pinned by [tests/formatting/money-regression.test.ts](tests/formatting/money-regression.test.ts).
- Action: **leave alone**.

#### 1.5.3 Reusable financial components — **STRONG**

- [src/components/financial/](src/components/financial/) — `financial-payment-summary.tsx`, `financial-total-source.tsx`, `financial-linked-documents.tsx`, `invoice-line-items.tsx`, `order-details-financials-tab.tsx`, `financial-format.ts`. All render-only, consume projection DTOs.
- Action: **leave alone**.

#### 1.5.4 React components doing math — **STRONG** (verified absent)

- Spot-checked `pos-package-composition.tsx` (1116 lines), `pos-add-on-marketplace.tsx` (478 lines), `pos-record-payment-dialog.tsx` (463 lines), `current-composition-card.tsx`, all `financial-sidebar-*.tsx`. No client-side totaling, no `parseFloat`, no `reduce(...amount)`.
- Action: **leave alone**.

#### 1.5.5 DTO/view-model layering — **STRONG**

- `OrderDetail` / `POSWorkspace` types are produced by `order.service.ts`. The new projector DTOs (`FinancialTabBlockProjection`, `OrderHeaderFinancialProjection`, `OrdersTableRowProjection`, `OverviewCompositionProjection`, `ProductionDeliverablesProjection`, etc.) overlay them where pages need them.
- One mild redundancy: pages still receive `OrderDetail` *and* projector DTOs (overview tab takes both `order` and `composition`). This is a transitional shape; the `order` object is used for header/related-records, projections for composition/financials.
- Action: **business-rule documentation candidate** — note in `architecture-context.md` §7 that the order-detail page is the only surface that mixes "order shell" + "projection DTOs" and why.

---

### 1.6 Tests and Verification Maturity

#### 1.6.1 Test suite shape — **STRONG**

- 110 test files across 24 directories. Three independent gates:
  - `npm run test:backend-invariants` — backend invariants + Phase A–G + workflow smoke (`run.ts` runner).
  - `npm run test:financial-invariants` — financial invariant catalog vs seeded fixtures.
  - `npm run test:centralization` — literal R0–R12 regression runner (architecture guards, projector parity, policy state-matrices, interactivity parity, deposit terminology).
- R13c added 7 smoke files chaining the full studio workflow ([tests/backend-invariants/end-to-end-studio-walkthrough.smoke.ts](tests/backend-invariants/end-to-end-studio-walkthrough.smoke.ts) is the canonical one).
- Action: **leave alone**.

#### 1.6.2 Architecture-guard tests — **STRONG**

- `tests/architecture/financial-case-read-layer-cleanup.test.ts`, `service-only-db-access.test.ts`, `deposit-terminology.test.ts` + `tests/orders/centralization-cleanup.test.ts` + `tests/formatting/money-regression.test.ts`. These mechanically prevent the most common regressions.
- Action: **leave alone**.

#### 1.6.3 Coverage gaps — **WATCH**

- Verification-inventory marks several files `out-of-scope-for-R13` (audit-log, payment-role-guard, session-types/-configurations admin tests, etc.). They run in isolation but are not wired into any gate command. A new contributor invoking only the three gates will not run them.
- Risk: regressions in admin CRUD or auth could slip through PR review.
- Action: **fix now (small)** — add a `npm run test:all` umbrella script that invokes all `*.test.ts(x)` files via `node --test`, separate from the existing gates.

#### 1.6.4 Business-rule traceability — **WEAK**

- Tests cover behavior, but there is no single document mapping owner-approved business rules ("editing cannot start until Final Invoice is paid", "deposit minimum 20 KD", "ADJUSTMENT cannot parent another ADJUSTMENT", "commission only from upgrade revenue", etc.) to the test files that pin them.
- Architecture-context invariants (1–20) are close but mix engineering invariants and business rules, and don't point to tests.
- Action: **business-rule documentation candidate** — see §3 below.

#### 1.6.5 Parity tests carry implicit assumptions — **WATCH**

- Several parity tests (`tests/orders/orders-table-customer-history-parity.test.ts`, `tests/adjustment-workspace/selected-photo-baseline-parity.test.ts`, `tests/orders/workflow-action-availability-parity.test.ts`) compare two derivation paths. As the second path (e.g., `orders-table-projections.service.ts`) is the only remaining duplication, these tests are simultaneously valuable and a sign that the duplication is not yet gone.
- Action: tied to 1.1.4; once that batched-loader unification lands, parity tests can be retired or downgraded to a single-projector snapshot.

---

### 1.7 Code Quality & Maintainability

#### 1.7.1 Large service files — **WATCH**

| File | Lines | Notes |
|---|---|---|
| [src/modules/orders/order.service.ts](src/modules/orders/order.service.ts) | 5028 | 27+ exports: reads, writes, guards, mappers. Single largest file in the repo. |
| [src/modules/adjustment-workspace/adjustment-workspace.service.ts](src/modules/adjustment-workspace/adjustment-workspace.service.ts) | 3014 | Lifecycle + finalize + staged proposal + bridge derivation. |
| [src/modules/invoices/invoice.service.ts](src/modules/invoices/invoice.service.ts) | 2774 | Create/recalc/adjust/credit/refund. |
| [src/modules/bookings/booking.service.ts](src/modules/bookings/booking.service.ts) | 1692 | Confirmation atomic transaction, check-in, deposit recording. |

- Risk: AI-agent context cost (reading these files burns budget); navigability for human contributors; merge conflicts on shared write paths.
- Action: **backlog**. Splitting strategy (one possible cut): `order.service.ts` → `order.reads.ts` (loaders + hub views), `order.writes.ts` (POS mutations), `order.guards.ts` (financial/edit guards), `order.mappers.ts` (row → DTO). Each public symbol re-exported from `index.ts` to avoid touching call sites. **Do not undertake speculatively**; do it the next time a substantial new feature lands in one of these files.

#### 1.7.2 Circular dependencies — **STRONG** (none detected)

- `composition` imports from `adjustment-workspace` (one direction). `financial-cases` imports from `orders` (settlement helpers, one direction). No cycles observed in spot-check.
- Action: **leave alone**, but consider adding a `madge --circular src/` check to the CI pipeline as cheap insurance.

#### 1.7.3 Dead compatibility code — **STRONG** (verified clean)

- R12 removed `summarizeInvoices`, `mapPaymentStatus`, `getOrderSettlementInvoices`, deposit-invoice dedup, `OrderDetail` aggregate photo-count fields.
- One residual TODO in [src/modules/financial/edit-classifier.ts:200](src/modules/financial/edit-classifier.ts#L200) ("TODO(review 79a): replace the display-name key with a stable …"). Pre-existing.
- Action: **backlog** — knock out the lone TODO.

#### 1.7.4 Fallback paths — **STRONG**

- Order-detail page falls back to `emptyOverviewCompositionProjection` / `emptyProductionDeliverablesProjection` when composition model is unavailable. Intentional; pinned by R8c follow-up test.
- Live POS fallback for missing snapshot selected counts in adjustment workspace is documented (progress-tracker.md).
- Action: **leave alone**.

#### 1.7.5 Hidden coupling — **ACCEPTABLE**

- The 1116-line POS package composition component imports POS workspace types and policy DTOs from multiple modules; the typing is explicit and traceable. Not "hidden" — just wide.
- Action: **backlog** (tied to 1.2.3).

#### 1.7.6 Naming — **STRONG**

- Projector names (`toFinancialTabBlock`, `toOrdersTableRow`) and policy names (`buildEditingWorkflowPolicy`) are consistent across modules. Surface and shape are recoverable from the name.
- Action: **leave alone**.

#### 1.7.7 Missing types — **STRONG**

- TypeScript strict; no `any` in spot-check; projector return types are exported and consumed by pages directly.
- Action: **leave alone**.

#### 1.7.8 Unclear ownership — **STRONG**

- `architecture-context.md` §3 module-ownership table reflects current code. `financial-cases` row added.
- Action: **leave alone**.

#### 1.7.9 AI-agent maintainability — **WATCH**

- `AGENTS.md` correctly directs agents to "minimal context" and "default reads". Largest issue is that resolving any non-trivial order/financial question forces reading multiple 1000+-line service files.
- Action: **backlog** — see §4 (AI-agent workflow improvements).

---

## 2. What Improved Significantly After R0–R13

1. **Financial truth is genuinely single-sourced.** `getFinancialCaseSummary` is called by every financial surface; the orders-table batched loader is the lone duplicate path and is parity-tested.
2. **Pages are dumb.** Order detail (943 lines), Sales (409), Adjustment Workspace (400), Booking (226) all delegate to services/projectors. No math on any of them. No `parseFloat` on any of them.
3. **Edit-mode is centralized.** One policy file, consumed by every POS edit surface and the configure-session router. Service guards stay authoritative.
4. **Workflow availability is policy-owned.** Four builders, one per area, with cross-policy parity test pinning the matrix.
5. **Service-only DB access is real.** Zero `@/lib/db` imports in `app/` or `src/components/`. Pinned by a fast architecture guard.
6. **Money formatting collapsed to one module.** `formatMoney`, `formatSignedMoney`, `parseMoneyInput`. Pinned by regression test.
7. **Adjustment Workspace is the only post-lock write surface for financial edits.** Locked operational edits stay direct/audited; locked financial edits stage through workspace. This separation is now enforced by code and by policy.
8. **Verification surface tripled.** Three independent gates (`backend-invariants`, `financial-invariants`, `centralization`), 110 test files, end-to-end studio walkthrough smoke.
9. **Deposit terminology is normalized.** "Base payment" wording gone from production surfaces; source + render guards in place.
10. **Composition view model has structured metadata.** No label parsing; `displayKind` / `fromLabel` / `toLabel` carry adjustment semantics.

---

## 3. Areas That Are Now Genuinely Canonical

- **Financial read**: `getFinancialCaseSummary` + `modules/financial-cases/projections/*`.
- **Composition read**: `getOrderCompositionViewModel` + `modules/orders/composition/projections/*`.
- **Edit-mode rules**: `modules/orders/policies/edit-mode-policy.ts`.
- **Workflow rules**: `modules/orders/policies/{editing,production,delivery}-workflow-policy.ts` + booking workflow policy.
- **Money formatting**: `src/lib/formatting/money.ts`.
- **Status labels**: enum `*.constants.ts` files (one per enum).
- **DB access boundary**: `src/modules/**` (+ `src/lib/**`, `tests/**`, `scripts/**`).
- **Audit logging**: `recordAuditLog` co-transactional pattern in service files.
- **Adjustment workspace bridge**: `derivePOSWorkspaceFromAdjustmentWorkspace`.
- **Settlement math**: `computeOrderSettlementSummary`, `deriveSettlementPaidAmount`, `deriveLockedFinancialSidebarSummary`, `computeEffectivePaidFromAllocations`.

---

## 4. Categorized Risk Summary

### 4.1 Architecture risks (highest first)

1. `orders-table-projections.service.ts` is the last meaningful parallel financial derivation path. **WATCH** → R14 candidate.
2. Edit-mode policy predicates and service guards encode the same rules in two places, pinned only by tests. **WATCH** → backlog.
3. `order.service.ts` size (5028 lines) raises the cost of every future change in the orders module. **WATCH** → backlog.

### 4.2 Code-quality risks

1. Large service files (`order.service.ts`, `adjustment-workspace.service.ts`, `invoice.service.ts`). **WATCH** → backlog.
2. Large UI component (`pos-package-composition.tsx`, 1116 lines). **WATCH** → backlog.
3. Stale `console.info` parity metric on order detail page. **WATCH** → fix now.
4. Lone pre-existing TODO in `edit-classifier.ts`. **ACCEPTABLE** → backlog.

### 4.3 Product/workflow risks

1. No business-rule inventory document. Owners cannot sign off "these are the rules". **WEAK** → documentation candidate (see §6).
2. Cross-package session-type override is blocked but not documented as a permanent product decision vs deferred work. **WATCH** → documentation candidate.

### 4.4 Test / verification gaps

1. `out-of-scope-for-R13` tests (audit, auth, session-config admin, pricing CRUD, session-types admin) are not invoked by any gate command. **WATCH** → fix now (umbrella script).
2. No `madge --circular` or similar topology check. **ACCEPTABLE** → backlog.
3. No coverage report or threshold gate. **ACCEPTABLE** → leave alone unless escalated.

### 4.5 Documentation / business-rule gaps

1. No Business Rule Inventory. **WEAK** → documentation candidate (§6).
2. `derivePOSWorkspaceFromAdjustmentWorkspace` bridge has no README; only inline docstrings and progress-tracker mentions. **ACCEPTABLE** → backlog.
3. `architecture-context.md` §7 still says `modules/financial-cases/` is "planned in R1"; the module has existed since R1a. **WATCH** → fix now (single-line edit).

---

## 5. Remaining Highest-Priority Risks

In ranked order:

1. **Production reconciliation operational secrets are not confirmed live** (`FINANCIAL_RECON_*`, `RECONCILIATION_PING_URL`). Until configured, nightly invariant alerting is silent in prod. — *operational, fix now.*
2. **`orders-table-projections.service.ts` parallel derivation path.** Drift risk; partially mitigated by parity tests. — *R14 candidate.*
3. **No Business Rule Inventory document.** Owners cannot trace approved rules → test files. — *documentation candidate, do soon.*
4. **`order.service.ts` and `adjustment-workspace.service.ts` size.** Slows every future feature touching these modules. — *backlog; split during next substantial change.*
5. **Architecture-context.md §7 stale wording.** Says `financial-cases` is "planned"; it shipped. Misleads agents. — *fix now.*
6. **Stale `console.info` parity metric on order-detail page.** Log noise. — *fix now.*
7. **Edit-mode predicates duplicated** between policy and service guard. — *backlog.*
8. **Out-of-scope test files not invoked by any gate command.** Coverage hole at PR time. — *fix now.*
9. **`pos-package-composition.tsx` size (1116 lines).** Maintainability. — *backlog.*
10. **No `madge --circular` (or equivalent) in CI.** Cheap insurance not in place. — *backlog.*

---

## 6. Business Rule Inventory — Recommended Structure

The current state distributes business rules across `architecture-context.md` §8 (Core Invariants), `code-standards.md` §8 (Financial Logic Rules), feature spec acceptance criteria, and the test suites. There is no single owner-facing map.

**Recommendation:** create `context/business-rules.md` with this shape:

```
# Business Rules

## Booking lifecycle
- BR-BK-1  Pending bookings consume no references.
  Pinned by: tests/backend-invariants/booking-confirmation-checkin.smoke.ts
  Owner sign-off: 2026-05-20
- BR-BK-2  Deposit recording is atomic: BK reference + FinancialCase + locked Deposit Invoice in one transaction.
  Pinned by: tests/bookings/deposit-invoice-canonicalization.test.ts, ...
- BR-BK-3  Deposit minimum 20 KD.
  Pinned by: tests/...
...

## Financial
- BR-FN-1  Editing cannot start until Final Invoice remaining is fully paid (PaymentType.FINAL).
  Pinned by: tests/backend-invariants/editing-start-gate.smoke.ts
- BR-FN-2  Upgrade charge = finalPackagePrice − originalPaidPackagePrice.
  Pinned by: tests/...
...
```

Properties of this document:
- Owner-readable (not engineer-only).
- One ID per rule (`BR-AREA-N`).
- Each rule names the tests that pin it. (Architecture-guard tests, behavior tests, smoke tests.)
- Stable over time; rule wording does not change without owner approval.
- Engineering invariants (e.g., "PaymentAllocation cannot exceed invoice.totalAmount") stay in `architecture-context.md` §8; only owner-facing business rules go in this new doc.

The act of writing this document is the audit. Expect to surface 5–10 rules that are coded but not formally signed-off (e.g., overpayment refund cap precedence rules).

---

## 7. Test Inventory / Test-Suite Improvements

1. Add `npm run test:all` umbrella script that runs every test file (including `out-of-scope-for-R13`).
2. Annotate each test file with a one-line `@purpose` comment so the inventory can be regenerated mechanically without re-reading the file.
3. Add a `tests/README.md` that explains the three-gate model and what each gate is responsible for (currently spread across the freeze checklist and the verification inventory).
4. Consider tagging tests as `@gate(centralization)` / `@gate(financial-invariant)` / `@gate(backend-invariant)` / `@gate(none)` so the verification inventory becomes regeneratable.
5. Add `madge --circular src/` (or equivalent) as a build-time check.
6. **Do not** add a coverage threshold gate yet; coverage is a poor proxy for business-rule pinning in this codebase.

---

## 8. AI-Agent Workflow Improvements (Post-Roadmap)

1. **Add a per-area "where to look first" doc.** When an agent is asked "where do financial totals come from?", the answer should be a single short doc, not a tour of three modules. Suggested: `context/where-to-look.md` listing the canonical source for each business concept.
2. **Mark large files with module-level docstrings.** A 50-line header at the top of `order.service.ts` describing the public surface saves an agent from reading all 5028 lines.
3. **Consolidate the "default reads" set.** Currently five files (`architecture-context.md`, `code-standards.md`, `ai-workflow-rules.md`, `project-overview.md`, `progress-tracker.md`). All are needed; consider whether `project-overview.md` can be trimmed.
4. **Add `context/reviews/centralization-roadmap.md` to the always-load set** until follow-ups are closed, then archive it (per R0 spec). Today it is "always load" by historical convention; nothing in `AGENTS.md` enforces it.
5. **Encourage the `Explore` agent for cross-module searches.** R0–R13 made the codebase navigable enough that a single targeted `grep` usually wins over a full repo scan.

---

## 9. Recommended Next 5–10 Small Follow-Up Tasks

1. Delete stale `console.info({ metric: "order_details.financials_tab.rendered" })` block in [app/orders/[orderId]/page.tsx:139-148](app/orders/[orderId]/page.tsx#L139-L148) **or** convert it to a structured log entry with a documented metric definition. (~5 min)
2. Update [context/architecture-context.md](context/architecture-context.md) §7 wording: replace "PLANNED in R1" / "planned in R1" / "Module is planned in R1; folder does not exist yet." with present-tense descriptions of the shipped layer. (~10 min)
3. Knock out the lone TODO in [src/modules/financial/edit-classifier.ts:200](src/modules/financial/edit-classifier.ts#L200) — replace the display-name key with a stable identifier. (~30 min)
4. Add `npm run test:all` umbrella script in `package.json` running every `*.test.ts(x)` file via `node --test`. (~15 min)
5. Add a `tests/README.md` documenting the three gates and what they're each responsible for. (~30 min)
6. Configure/confirm production GitHub Actions secrets: `FINANCIAL_RECON_DATABASE_URL`, `FINANCIAL_RECON_SLACK_WEBHOOK`, `FINANCIAL_RECON_SLACK_CHANNEL`, `RECONCILIATION_PING_URL`; manually trigger the `Financial Reconciliation` workflow once. Replace placeholder Healthchecks URL in [context/ops/reconciliation-monitor.md](context/ops/reconciliation-monitor.md). (~1–2 hr ops)
7. Draft `context/business-rules.md` with the structure in §6 — owner sign-off pass. (~3–4 hr)
8. Walk R13d Manual QA sections 1–4 once on dev/staging before production freeze (per progress-tracker open follow-up). (~2 hr)
9. Add `madge --circular src/` to CI; gate fails on cycles. (~30 min)
10. Add a 50-line public-surface docstring to the top of [src/modules/orders/order.service.ts](src/modules/orders/order.service.ts) and [src/modules/adjustment-workspace/adjustment-workspace.service.ts](src/modules/adjustment-workspace/adjustment-workspace.service.ts) summarizing exports + intended call paths. (~45 min each)

These are sequenced for quick wins first; #6, #7, #8 are the higher-value items.

---

## 10. Do Not Touch Yet

1. **Write services** — `invoice.service.ts`, `payment.service.ts`, `refund.service.ts`, `adjustment-workspace.service.ts` finalize/stage paths, `session-configuration-selection.service.ts` writes, `booking.service.ts` deposit/check-in. Any change here touches financial correctness.
2. **DB triggers** — invoice frozen-field, PaymentAllocation over-collection, ADJUSTMENT-chain. They are the last line of defense; do not refactor around them.
3. **Prisma schema** — frozen for the duration of any "stabilization" work. Schema changes require their own feature spec.
4. **Financial formulas** — `computeCreditNoteCapacityForFinal`, `computeOverpaymentCapacity`, refund capacity rules. Do not redefine, even "for clarity".
5. **Edit-mode policy outputs** — `OrderEditModePolicy` field set is consumed by many surfaces; adding/removing fields cascades.
6. **`derivePOSWorkspaceFromAdjustmentWorkspace`** — bridge is correct and tested; do not "simplify" without a dedicated spec.
7. **Order status / payment-type / invoice-type enums** — pinned by terminology guards and many tests.
8. **`pos-handlers.types.ts`** — shared adapter contract; both sales and adjustment workspace depend on it byte-for-byte.
9. **Composition view model metadata** (`displayKind`, `fromLabel`, `toLabel`) — adjustment workspace label-parsing has been removed in favor of this; do not reintroduce label heuristics.
10. **Reconciliation invariant catalog** — generated owner-facing index; regenerate via `npm run docs:generate`, never edit by hand.

---

## 11. Is the System Ready for Normal Feature Development?

**Yes**, with two caveats:

1. The production reconciliation operational deferrals (secrets + Healthchecks dashboard) should be closed before any feature that materially expands financial flows lands.
2. New financial / composition / workflow display surfaces must follow the projector + policy pattern. The architecture guards will block obvious regressions, but spec authors should explicitly state which canonical read model the new surface consumes (the spec template already prompts this; reinforce in review).

There is no architectural blocker, no "we need to redo X first" debt, no known broken core flow. The verified test gates plus the architecture guards mean a new feature touching the centralized layer fails loudly rather than silently introducing drift.

---

## 12. Suggested Next Phase

**Phase name:** *Stabilization & Sign-Off* (not a centralization Phase 14).

**Scope (small, time-boxed, ~1–2 weeks of focused work):**
- Close operational deferrals (production reconciliation secrets, Healthchecks).
- Write `context/business-rules.md` and obtain owner sign-off pass on each rule.
- Land the small follow-ups in §9.
- Decide R14 (orders-table-projections unification) **only after** the business-rule inventory exists — that decision is easier with rules pinned.

After Stabilization & Sign-Off, the next genuine phase should be a **product feature phase**, not infrastructure. Resist the urge to launch a "Roadmap II" — the current architecture has room for several more feature waves without further centralization work.

---

## 13. Top 10 Remaining Risks (final, ranked)

1. Production reconciliation operational secrets unverified.
2. `orders-table-projections.service.ts` parallel financial derivation.
3. No Business Rule Inventory (owner-readable).
4. `order.service.ts` / `adjustment-workspace.service.ts` size — maintainability tax.
5. `architecture-context.md` §7 stale "planned" wording.
6. Stale `console.info` parity metric on order-detail page.
7. Edit-mode predicates duplicated between policy and service guard.
8. Out-of-scope tests not invoked by any gate command.
9. `pos-package-composition.tsx` size (1116 lines).
10. No structural CI checks (`madge --circular`, module-graph guard).

## 14. Top 10 Recommended Next Actions (final, ranked)

1. Close production reconciliation operational deferrals (§9 #6).
2. Author `context/business-rules.md` (§6).
3. Update `architecture-context.md` §7 stale wording (§9 #2).
4. Delete or document the stale parity-metric log (§9 #1).
5. Add `npm run test:all` + `tests/README.md` (§9 #4, #5).
6. Walk R13d manual QA on dev/staging (§9 #8).
7. Add `madge --circular src/` to CI (§9 #9).
8. Add public-surface docstrings to the largest service files (§9 #10).
9. Resolve the lone TODO in `edit-classifier.ts` (§9 #3).
10. Plan R14 (orders-table-projections unification) *after* business rules are written — the decision is sharper with rules pinned.

---

*End of audit.*
