Review the current state of the centralization roadmap after R10 completion and evaluate whether R11 should exist as a real orchestrator spec or a smaller page-thinning cleanup.

I am past R10 now. Before drafting any R11 spec, I want an architecture reassessment, not implementation.

## Read:
- AGENTS.md
- context/reviews/centralization-roadmap.md (especially R11/R12)
- context/progress-tracker.md
- Codex’s R11 assessment pasted below
- current implementation files directly related to order-details orchestration

## Inspect current code:
- app/orders/[orderId]/page.tsx
- app/orders/[orderId]/sales/page.tsx
- app/orders/[orderId]/adjustment-workspace/page.tsx
- src/modules/orders/order.service.ts
- src/modules/financial-cases/
- src/modules/orders/composition/
- src/modules/orders/policies/
- R10 workflow policy builders
- any remaining helper functions/page-level derivations still living in the order detail page

-----------------------

## Codex assessment:

[**Recommendation: B. Draft smaller R11 page-thinning spec.**

R11 should not become a full `getOrderDetailsView(orderId)` orchestrator now. After R1-R10, the major decisions are already centralized: financial readouts use `FinancialCaseSummary` projectors, composition readouts use `OrderCompositionViewModel` projectors, edit-mode decisions use `OrderEditModePolicy`, and workflow forms use policy DTOs.

1. **Is the order detail page still too large?**  
Yes as a file, but not mainly because of business orchestration. [page.tsx](/Users/bo3li/Desktop/lollipop-studio-os/app/orders/[orderId]/page.tsx:84) is 1009 lines, but most of that is tab/UI rendering. The true orchestration is the top `Promise.all` loader plus projector calls at [lines 88-128](/Users/bo3li/Desktop/lollipop-studio-os/app/orders/[orderId]/page.tsx:88). That is noisy, but not dangerous enough to justify a new page-wide service.

2. **Are decisions centralized enough?**  
Mostly yes. Financials are centralized through `getFinancialCaseSummary`, `toFinancialTabBlock`, and `toOrderHeaderFinancial` at [page.tsx:47](/Users/bo3li/Desktop/lollipop-studio-os/app/orders/[orderId]/page.tsx:47), backed by [financial-case-summary.service.ts](/Users/bo3li/Desktop/lollipop-studio-os/src/modules/financial-cases/financial-case-summary.service.ts:35). Composition is centralized through `getOrderCompositionViewModel`, `toOverviewTab`, and `toProductionDeliverables` at [page.tsx:53](/Users/bo3li/Desktop/lollipop-studio-os/app/orders/[orderId]/page.tsx:53). Workflow policy builders are already wired in service mappers, for example editing at [order.service.ts:4113](/Users/bo3li/Desktop/lollipop-studio-os/src/modules/orders/order.service.ts:4113), production at [order.service.ts:4308](/Users/bo3li/Desktop/lollipop-studio-os/src/modules/orders/order.service.ts:4308), and delivery at [order.service.ts:4620](/Users/bo3li/Desktop/lollipop-studio-os/src/modules/orders/order.service.ts:4620).

3. **Would `getOrderDetailsView(orderId)` meaningfully reduce complexity?**  
Only superficially. It would shrink [page.tsx:88-128](/Users/bo3li/Desktop/lollipop-studio-os/app/orders/[orderId]/page.tsx:88), but most page length would remain because the tab renderers live in the same file. The underlying business decisions are already in projectors/policies.

4. **God-service risk?**  
High enough to avoid. A service returning `{ header, overview, selection, editing, production, delivery, financials, sales, sessionConfigurations, editMode }` would know every tab and every projection. That risks becoming a page-shaped aggregator that couples financial, composition, workflow, activity, POS, and session-config display concerns.

5. **Logic still worth moving/thinning**  
The residual cleanup is narrow:
- Move `deriveOperationalPackageLines` / `valueDisplayForOperationalSelection` out of the page or into a session-configuration/composition projection: [page.tsx:487](/Users/bo3li/Desktop/lollipop-studio-os/app/orders/[orderId]/page.tsx:487).
- Avoid page-owned empty projection fallback objects if the service/projector can return stable empty DTOs: [page.tsx:301](/Users/bo3li/Desktop/lollipop-studio-os/app/orders/[orderId]/page.tsx:301) and [page.tsx:329](/Users/bo3li/Desktop/lollipop-studio-os/app/orders/[orderId]/page.tsx:329).
- Move the header payment status label into the header financial projector instead of mapping it in the page: [page.tsx:178](/Users/bo3li/Desktop/lollipop-studio-os/app/orders/[orderId]/page.tsx:178).
- Replace the selection tab’s label comparison and stale “Base payment” copy with service/policy-owned state: [page.tsx:607](/Users/bo3li/Desktop/lollipop-studio-os/app/orders/[orderId]/page.tsx:607).
- Stop mixing production deliverable projection with legacy `order.includedPhotoCount` / `order.extraPhotoCount`: [page.tsx:289](/Users/bo3li/Desktop/lollipop-studio-os/app/orders/[orderId]/page.tsx:289).

6. **R11 path**  
Choose **B. Draft smaller R11 page-thinning spec**. Do not implement a real `getOrderDetailsView` orchestrator. Do not skip straight to R12, because there are still page-local derivations that R12 cleanup would otherwise have to trip over.

7. **Safest next step before R12**  
Draft a small R11 spec that extends existing projectors/services only where needed, keeps the page calling existing service loaders, and adds source tests preventing page-local financial/composition/workflow derivation from returning.

**Risks for B**
- Accidentally turning “page thinning” into the full orchestrator anyway.
- Moving display-only fallback too deep into domain services.
- Breaking existing R8/R10 regression assumptions by changing DTO shape broadly.

**Acceptance Criteria for B**
- No `getOrderDetailsView(orderId)` is introduced.
- `app/orders/[orderId]/page.tsx` no longer filters/session-configures operational selections itself.
- Header financial label comes from projector output.
- Selection empty/blocked state does not branch on display label strings.
- Production photo counts come from composition/deliverable projection or a service-owned DTO.
- No new DB imports in `app/**` or components.
- Existing R8/R10 source tests continue to pass, plus one new page-thinning source test.]


----------------------------
## Your task:
Do NOT draft a feature spec yet.

Instead:
1. Independently review whether Codex’s recommendation is correct.
2. Decide whether R11 should be:
   - A. real orchestrator (getOrderDetailsView(orderId))
   - B. smaller page-thinning cleanup
   - C. skipped and folded into R12
   - D. deferred until after R13
3. Explain the architectural tradeoffs.
4. Identify any remaining dangerous page-owned derivation/orchestration still present.
5. Identify any “god service” risk if a full orchestrator is introduced.
6. Explain what the safest path is before R12.
7. If you recommend B (smaller R11 cleanup), outline:
   - exact cleanup targets
   - exact things NOT to centralize
   - acceptance criteria
   - risks

## Important:
- Do not automatically agree with Codex.
- Prefer the safest long-term architecture path, not the cleanest-looking page file.
- Avoid creating a page-shaped god orchestrator unless it provides real architectural value.
- Consider whether existing projectors/policies already made R11 mostly unnecessary.

## Output:
- concise architecture assessment
- concrete file/function references
- final recommendation with reasoning
- only after that: whether an R11 spec should even be drafted