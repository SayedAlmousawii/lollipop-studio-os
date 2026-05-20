# R11 Architecture Assessment — Post-R10 Review

Generated: 2026-05-20
Based on: direct inspection of `app/orders/[orderId]/page.tsx`, `order.service.ts`, `order.types.ts`, composition module, policies module, financial-cases module, and `centralization-roadmap.md`.

---

## What the page actually looks like after R10

The 1010-line file breaks down roughly as:
- **~40 lines** of real orchestration: the `Promise.all` loader (lines 88–110) + projector calls (lines 117–128)
- **~970 lines** of tab renderers, presentational helpers, and small UI components

The orchestration block is not dangerous. Every call goes to a named service function. No DB import. No math. The `Promise.all` is correct — it runs 10 independent loads in parallel, and an orchestrator service would have to preserve that parallelism internally anyway, becoming a page-shaped wrapper.

---

## Remaining violations (real)

### 1. `deriveOperationalPackageLines` / `valueDisplayForOperationalSelection` — page.tsx:487–519

The page filters `sessionConfigurationSummary` on `financialBehavior === "OPERATIONAL"` and maps it into a display shape. That is a domain predicate, not display logic. The composition module already owns `sessionConfigurationSummary` through `toOverviewTab`. This filter should live in a composition projector.

### 2. `emptyOverviewComposition` / `emptyProductionDeliverables` — page.tsx:301–337

The page constructs fallback empty DTOs that exactly mirror the projector DTO shape. The composition module owns those shapes. These fallbacks should be exported from `src/modules/orders/composition/index.ts` or handled inside the projector when `compositionModel` is null.

### 3. Production tab photo counts — page.tsx:290–291

`order.includedPhotoCount` and `order.extraPhotoCount` are read directly from `OrderDetail` while the rest of the production tab reads from `toProductionDeliverables`. Both are service-owned values (not page-derived math), but the production tab ends up with two sources of truth. `ProductionDeliverablesProjection` should include the photo counts so the tab has one source.

### 4. Stale "Base payment" copy — page.tsx:621–622

After R10b the term is "deposit," not "base payment." The copy is wrong today and it is hardcoded in the page. Minimum fix: correct the string. Cleaner fix: add `selectionBlockedMessage: string | null` to `OrderSelectionWorkflow` so the message comes from the service.

---

## Where Codex overstated the problem

**Header payment status label — page.tsx:182–187**
`FINANCIAL_CASE_PAYMENT_STATUS_LABELS[headerFinancial.paymentStatusEnum]` is a single lookup from a module-owned constant. The projector already outputs `paymentStatusEnum`. Adding `paymentStatusLabel` to the projector output is cleaner, but this is not dangerous page-local derivation — it computes nothing.

**Selection tab `orderStatus === "Active"` branch — page.tsx:608**
Codex calls this a "label comparison." It is comparing against `OrderStatusLabel`, a typed union (`"Active" | "Waiting Selection" | ...`). The same string is used inside the service itself at `order.service.ts:3281`. This is not parsing user-generated text. The correct fix is the stale copy, not the branch predicate.

---

## God-service risk if full R11 orchestrator is built

`getOrderDetailsView(orderId)` would need to import across: `order.service`, `order-activity.service`, `financial-cases`, `composition`, `policies/edit-mode`, `bookings/booking-workflow-policy`. It would return a shaped aggregate for every tab on the page. The page would contain only JSX tab rendering — but the orchestrator would be a page-shaped god that imports across every domain module.

**This risk is real.** The roadmap note at §6.4 anticipated exactly this: "Reassess after R10. May become janitorial." After R10, R11 as originally spec'd (full orchestrator) is the wrong call.

---

## Final recommendation: B — small page-thinning R11 spec

### Exact cleanup targets

| Target | Location | Action |
|---|---|---|
| `deriveOperationalPackageLines` / `valueDisplayForOperationalSelection` | page.tsx:487–519 | Move into composition projector as `toOperationalConfigurationsDisplay` |
| `emptyOverviewComposition` / `emptyProductionDeliverables` | page.tsx:301–337 | Export stable empty DTOs from the composition module |
| Production photo counts | page.tsx:290–291 | Add `includedPhotoCount` / `extraPhotoCount` to `ProductionDeliverablesProjection` |
| Stale "Base payment" copy | page.tsx:621 | Fix copy; optionally add `selectionBlockedMessage` to `OrderSelectionWorkflow` |

### Exact things NOT to centralize

- The `Promise.all` loader — parallel loading is architecturally correct where it is
- The `FINANCIAL_CASE_PAYMENT_STATUS_LABELS` lookup — module-owned constant, not a computation
- The `orderStatus === "Active"` predicate — typed and safe
- Any full `getOrderDetailsView` orchestrator

### Acceptance criteria

1. `deriveOperationalPackageLines` and `valueDisplayForOperationalSelection` are deleted from the page; operational configuration display comes from a composition projector
2. `emptyOverviewComposition` and `emptyProductionDeliverables` are not defined in `app/**`
3. Production tab reads `includedPhotoCount` / `extraPhotoCount` from `ProductionDeliverablesProjection`, not `OrderDetail`
4. "Base payment" copy is corrected
5. No `getOrderDetailsView` service introduced
6. No new `@/lib/db` imports in `app/**`
7. All R8/R10 source regression tests continue passing

### Risks

- Extending `ProductionDeliverablesProjection` is a DTO shape change — audit all consumers before merging
- Moving operational config filtering into the composition projector requires it to know about `financialBehavior`; verify the projector already has access (it does — `sessionConfigurationSummary` is available inside `toOverviewTab`)

---

## Should an R11 spec be drafted?

Yes — as a **single narrow spec**, not a multi-part sub-spec. The 4 items above can ship in one PR. R12 cleanup (removing compatibility paths) does not depend on R11, but R11 closes the last real page-local domain logic before the roadmap is declared done.
