# Feature 104 - R9: OrderEditModePolicy

## Goal

Centralize draft, locked, and adjustment edit-mode rules for POS composition, add-ons, selected photos, and session-configuration edits so UI messages, route targets, approval expectations, and server-action decisions all read from one `OrderEditModePolicy` while existing write guards remain authoritative and unchanged in behavior.

## Read First

- `AGENTS.md` - repository rules, especially service-only DB access, small scope, and docs-only progress behavior.
- `context/ui-context.md` - locked sales view, adjustment workspace, and dashboard component patterns for the touched POS surfaces.
- `context/reviews/centralization-roadmap.md` - Spec R9, risk controls, R9 test row, do-not-touch boundaries, and R9/R10/R11 sequencing.
- `context/feature-specs/103-r8-composition-consumer-swaps.md` - current R8 handoff; POS consumers now receive composition projectors and must not regain component-side business decisions.
- `src/modules/orders/order.service.ts` - current direct POS write guards, delivered-order checks, open-workspace fields, and `getPOSWorkspace(...)` shape.
- `src/modules/orders/order.schema.ts` - existing POS mutation inputs and manager-approval fields.
- `src/modules/orders/order.types.ts` and `src/modules/orders/pos-handlers.types.ts` - current `POSWorkspace`, invoice lock state, handler contracts, and inline approval flag.
- `src/modules/orders/composition/projections/` - current R7/R8 projected POS composition shapes; R9 must consume them as read context only.
- `src/components/orders/financial-sidebar-draft.tsx` - current locked invoice notice.
- `src/components/orders/pos-package-composition.tsx` - current package/photo locked notices and `ConfigureSessionPanel` mode wiring.
- `src/components/orders/pos-add-on-marketplace.tsx` - current marketplace locked notice and approval behavior.
- `src/components/session-configurations/configure-session-panel.tsx` - current draft/locked/adjustment session-configuration edit affordances.
- `app/orders/[orderId]/actions.ts` - current `configureSessionAction(...)` route classification and workspace edit action.
- `app/orders/[orderId]/sales/page.tsx` and `app/orders/[orderId]/sales/actions.ts` - current direct-sales handler wiring and POS safe error messages.
- `app/orders/[orderId]/adjustment-workspace/page.tsx`, `app/orders/[orderId]/adjustment-workspace/actions.ts`, and `app/orders/[orderId]/adjustment-workspace/pos-handler-adapters.ts` - current staged edit schemas, workspace handler adapters, and inline approval disablement.
- `src/modules/session-configurations/session-configuration-selection.service.ts` - current `resolveConfigureSessionRoute(...)`, financial/operational selection split, and post-lock write errors.
- Existing tests in `tests/orders/`, `tests/session-configurations/configure-session-action.test.ts`, and `tests/adjustment-workspace/` - current render, action, and staged-edit regression patterns.

## Rules

- **Single PR.** R9 ships as one coherent policy PR. Do not split into separate consumer swaps unless implementation discovers an unavoidable review blocker.
- **Policy only, not write rewrite.** Add the centralized read/policy layer and wire consumers to it. Do not change invoice, payment, credit-note, adjustment finalization, package, add-on, selected-photo, or session-configuration write semantics.
- **Service guards remain authoritative.** Existing service-level guards such as delivered-order checks, locked direct-POS blocking, session-configuration post-lock checks, and manager approval errors must still enforce writes. The new policy must read the same predicates or shared predicate helpers so UI and action messages cannot drift from guard behavior.
- **No schema or migration change.** If the policy wants context that is not currently loaded, add a service-layer context loader from existing rows. Do not persist policy state.
- **No workflow policy work.** Do not build booking, editing, production, or delivery workflow policy builders. R10 owns workflow action availability.
- **No order-details orchestrator.** Do not introduce `getOrderDetailsView(orderId)` or collapse order page loaders. R11 owns that reassessment.
- **No consumer-side rule decisions.** Components may render policy fields and keep local form state, but they must not decide locked-vs-adjustment behavior, blocked reasons, route targets, or approval requirements from `workspace.invoice?.isLocked` directly after their surface is wired.
- **Keep write paths split.** Direct sales handlers still call direct POS server actions. Adjustment workspace handlers still stage `AdjustmentWorkspaceEdit` operations. The policy chooses the correct affordance and message; it does not merge persistence paths.
- **Session configuration ownership stays intact.** `session-configuration-selection.service.ts` may still resolve which configurations are financial vs operational for an order package. The decision about direct write vs Adjustment Workspace route must be policy-driven.
- **Client import boundary.** Client components may import policy types and pure display constants only if those files do not import DB-backed services. Server-loaded policy DTOs should be passed as props when DB state is required.
- **Current implementation drift to account for.** At drafting time, locked notices are hardcoded separately in `financial-sidebar-draft.tsx`, `pos-package-composition.tsx`, `POSPhotoCountCard`, and `pos-add-on-marketplace.tsx`; one notice still says "future adjustment flow." `configureSessionAction(...)` classifies locked financial vs operational edits locally after `resolveConfigureSessionRoute(...)`. `assertDirectPOSMutationAllowed(...)` is private in `order.service.ts` and returns a generic locked-workspace message that UI notices do not share. Adjustment workspace stage action schemas are action-local and do not explicitly receive an edit-mode decision. R9 must centralize only this drift.

## Scope

### In Scope

- New policy module under `src/modules/orders/policies/`, centered on `edit-mode-policy.ts`.
- A typed policy result that includes at least:
  - `mode`
  - `canEditDirectly`
  - `shouldOpenAdjustmentWorkspace`
  - `requiresManagerApproval`
  - `blockedReason`
  - `routeTarget`
  - a user-facing message field such as `userFacingMessage` or equivalently named display copy.
- A typed edit-kind input covering the R9 surfaces:
  - package tier change
  - package item upgrade
  - selected-photo count change
  - add-on add
  - add-on remove / quantity reduction
  - session-configuration operational edit
  - session-configuration financial edit
- A service-layer policy context loader or mapper, if needed, that reads existing order state:
  - order status / delivered state
  - final invoice id and locked state
  - open adjustment workspace id and route
  - current persistence context (`sales` vs `adjustment`)
  - session-configuration financial behavior for selected configuration ids when configuring sessions.
- Shared predicates or constants that let `order.service.ts` locked direct-POS guards and the new policy agree on the same blocked reason and message. The write guard may remain in `order.service.ts`, but the predicate/message source must not be duplicated.
- `src/components/orders/financial-sidebar-draft.tsx`
  - Render the locked/direct-edit notice from policy output instead of local copy.
  - Preserve invoice/payment rendering and R8 composition projector usage.
- `src/components/orders/pos-package-composition.tsx` and `POSPhotoCountCard`
  - Receive policy output for package, package-item, selected-photo, and configure-session affordances.
  - Render locked notices, disabled states, adjustment route copy, and manager-approval expectations from policy fields.
  - Preserve existing handlers, form payloads, `ConfigureSessionPanel` behavior, and R8 composition projection reads.
- `src/components/orders/pos-add-on-marketplace.tsx`
  - Receive policy output for add and remove affordances.
  - Render locked notice and approval expectations from policy fields.
  - Preserve existing marketplace projection reads, add/remove forms, and inline approval modal behavior.
- `src/components/session-configurations/configure-session-panel.tsx`
  - Use policy-provided locked/adjustment messages and route target instead of constructing them locally.
  - Preserve draft, locked operational-only, locked financial-route, and adjustment staging behavior.
- `app/orders/[orderId]/sales/page.tsx`
  - Build the relevant edit-mode policies on the server and pass them into POS components and handlers.
  - Preserve direct sales handler contracts and `shouldPromptInlineApproval: true`.
- `app/orders/[orderId]/adjustment-workspace/page.tsx` and `pos-handler-adapters.ts`
  - Build adjustment-mode policies and pass them into shared POS components.
  - Preserve staged handler contracts and `shouldPromptInlineApproval: false`.
- `app/orders/[orderId]/actions.ts`
  - Make configure-session direct-write vs Adjustment Workspace routing policy-driven.
  - Keep operational post-lock writes through `writeOrderPackageSelections(..., { allowPostLock: true, postLockAudit })`.
  - Keep financial post-lock edits routed to `/orders/[orderId]/adjustment-workspace`.
- `app/orders/[orderId]/adjustment-workspace/actions.ts`
  - Keep the existing Zod input schemas but ensure staged edit actions run in adjustment mode and return policy-aligned blocked messages when the workspace/edit context is invalid.
- `app/orders/[orderId]/sales/actions.ts`
  - Update safe POS error messages to consume or match policy/guard message constants, without widening exposed error details.
- Tests
  - Unit tests for the policy matrix across unlocked sales, locked sales with no workspace, locked sales with an open workspace, adjustment workspace, delivered order, additive edits, reductive edits, operational session-configuration edits, and financial session-configuration edits.
  - Contract tests proving direct write guard locked messages and policy locked messages stay aligned.
  - Render tests for the three POS locked notices and configure-session route affordances using policy fixtures.
  - Action tests proving locked financial session-configuration edits return the policy route target and locked operational edits still write directly with post-lock audit.
  - Source or architecture tests proving hardcoded locked POS notice strings are not reintroduced in the three R9 components.

### Out of Scope

- Any Prisma schema, migration, seed data, or persisted JSON change.
- Any invoice, payment, allocation, refund, credit-note, adjustment invoice, or adjustment-workspace finalization behavior change.
- Any change to package, add-on, selected-photo, or session-configuration mutation semantics beyond reading shared guard predicates/messages.
- Replacing R8 composition projectors or changing `OrderCompositionViewModel` shape.
- Changing POS handler payloads, hidden form field names, inline approval modal payload shape, or staged edit operation shape.
- Removing `POSWorkspace.invoice` or other compatibility fields from POS components.
- Moving product catalogs, package options, or available session configurations out of `POSWorkspace`.
- Building workflow action policies for booking, editing, production, or delivery.
- Creating `getOrderDetailsView(orderId)` or deleting legacy order detail loader fields.
- Removing R12 compatibility/fallback paths such as `getOrderSettlementInvoices()` or customer-history financial helpers.

## Implementation Direction

Treat R9 as the policy equivalent of R1/R7: one canonical rule source, many surface-specific uses. Start with a small typed policy module under `src/modules/orders/policies/`. Keep a pure builder separate from any DB-backed loader so tests can exercise the policy matrix without fixtures that hit the database.

The policy should answer, for a specific edit kind and context, what the surface should do:

- Draft/unlocked sales edits can write directly.
- Locked sales additive or reductive financial/composition edits should point to the Adjustment Workspace instead of direct POS mutation.
- Locked operational session-configuration edits can write directly with post-lock audit.
- Locked financial session-configuration edits should route to the Adjustment Workspace.
- An open workspace should route locked sales configuration/composition edits to that workspace and should not encourage a second direct edit path.
- Adjustment workspace edits are staged edits, not direct edits, and inline manager approval remains disabled until finalize.
- Delivered or otherwise blocked orders should expose a blocked reason that matches the write guard.

Keep `requiresManagerApproval` precise. It should not mean "this edit is locked." It should mean the current action path needs manager confirmation, such as direct reductive sales edits that can issue credit-note approval prompts or pending adjustment finalization states that already require approval. The policy can expose both `requiresManagerApproval` and `shouldOpenAdjustmentWorkspace` so components do not infer one from the other.

For write guard alignment, prefer extracting tiny shared predicates/constants rather than importing full services into the policy. For example, the locked direct-POS blocked reason/message can live in a small policy/guard helper that both `assertDirectPOSMutationAllowed(...)` and `buildOrderEditModePolicy(...)` read. Do not make projectors, components, or server actions import DB-backed services just to get display copy.

For POS components, pass policy DTOs from server pages into client components. The components can still read `workspace.invoice` for invoice/payment rendering where that is already part of their UI, but the locked notice text, route target, disabled/explanation copy, and approval wording should come from policy props. If a component needs several edit-specific policies, pass a grouped DTO with stable keys rather than making the component rebuild rules.

For configure-session, keep the configuration resolver focused on identifying financial vs operational configurations for the order package. Then let the edit-mode policy decide each selected configuration's route. The action should no longer manually say "if locked and financial then return Adjustment Workspace." It should ask the policy for the selected edit kind, apply direct operational selections only when policy says `canEditDirectly`, and return the policy `routeTarget` / message when policy says `shouldOpenAdjustmentWorkspace`.

For adjustment workspace actions, avoid a broad rewrite of staged schemas. The existing `stagePackageTierChangeSchema`, `stagePackageItemUpgradeSchema`, selected-photo schema, and marketplace schemas can stay action-local. R9 should add policy checks around the stage context where useful and make handler errors use policy-aligned messages. Do not alter `AdjustmentWorkspaceEdit` ids or operations.

Use existing R8 tests as the render pattern. New component tests should not need a real database; policy fixture DTOs are enough to prove locked notices and route affordances render from policy. Service/action tests can cover the DB-backed route resolver and write guard alignment where current tests already stub module boundaries.

## Observability Checklist

### Dashboards / Metrics

- No new production dashboard metric is required.
- Keep existing metrics such as `sales_page.locked.adjustment_action.opened`, `adjustment_workspace.configure_session_panel_rendered`, and session-configuration locked-block logging unless a field rename is mechanically required.
- R9's durable observability is regression coverage: policy matrix tests, guard-message alignment tests, configure-session action tests, and source tests preventing hardcoded locked notices from returning.

### Rollback Plan

- No schema changes. No down-migration needed.
- Roll back by restoring the previous component notice props/copy and action-local configure-session routing while leaving unrelated R8 composition projector wiring intact.
- If a policy rule is wrong, fix the centralized policy first. Do not add compensating locked/route logic back into components or server actions.

### Customer-Visible Surface

- Staff should see no workflow redesign.
- Locked POS, add-on marketplace, selected-photo, package composition, and configure-session messages should become consistent.
- Locked financial/session-configuration edits should continue directing staff to the Adjustment Workspace, while locked operational session-configuration edits should continue saving directly with audit.
- Any visible wording difference must be a consistency cleanup from the centralized policy and documented in the PR notes.

## Post-Implementation

- Update `context/progress-tracker.md` Now to say R9 is complete, POS/configure-session edit-mode messaging and routing consume `OrderEditModePolicy`, and R10 workflow policy builders are next.
- Do not update architecture-context or code-standards unless implementation discovers a documented rule conflict.
- Do not refresh `context/reviews/invariant-catalog.md`; R9 should not change financial reconciliation invariant metadata.

## Acceptance Criteria

- `src/modules/orders/policies/edit-mode-policy.ts` exists and exports a typed policy builder returning `mode`, `canEditDirectly`, `shouldOpenAdjustmentWorkspace`, `requiresManagerApproval`, `blockedReason`, `routeTarget`, and user-facing display copy or equivalent fields.
- The policy covers package tier changes, package item upgrades, selected-photo count changes, add-on additions, add-on removals/reductions, operational session-configuration edits, and financial session-configuration edits.
- Direct POS write guards and policy locked/direct-edit decisions share the same predicate/message source or have a contract test that fails if they drift.
- `FinancialSidebarDraft`, `POSPackageComposition`, `POSPhotoCountCard`, and `POSAddOnMarketplace` render locked/edit-mode notices from policy output rather than hardcoded local locked copy.
- `ConfigureSessionPanel` renders locked operational/financial/adjustment affordances from policy output and no longer owns the route message for financial locked edits.
- `configureSessionAction(...)` asks the policy whether selected locked configurations can write directly or should route to Adjustment Workspace; the action no longer performs the locked-financial route decision with action-local branching.
- Locked operational session-configuration selections still call `writeOrderPackageSelections(..., { allowPostLock: true, postLockAudit })`.
- Locked financial session-configuration selections return a policy message and `/orders/[orderId]/adjustment-workspace` route target.
- Sales handlers preserve direct POS action behavior and `shouldPromptInlineApproval: true`.
- Adjustment workspace handlers preserve staged edit behavior and `shouldPromptInlineApproval: false`.
- Existing manager approval behavior for reductive direct sales edits and adjustment finalization is preserved.
- No package, add-on, selected-photo, session-configuration, invoice, payment, credit-note, or adjustment finalization write semantics change.
- No `@/lib/db` import is added to `app/**` or `src/components/**`.
- Source or architecture tests fail if R9-touched components reintroduce hardcoded locked notice strings such as "future adjustment flow" or component-owned "Invoice is locked..." edit routing copy.
- Policy unit tests cover unlocked sales, locked sales with no open workspace, locked sales with an open workspace, adjustment workspace, delivered order blocking, additive edits, reductive edits, operational configuration edits, and financial configuration edits.
- Configure-session action tests cover draft writes, locked operational writes, locked financial route returns, and open-workspace route messaging.
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector (`modules/financial-cases/projections/` for FinancialCase-bound surfaces) instead of re-deriving in pages or components. Money is read from raw projector fields and formatted via `src/lib/formatting/money.ts`. No `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run build` passes.
- `npm run lint` passes.
