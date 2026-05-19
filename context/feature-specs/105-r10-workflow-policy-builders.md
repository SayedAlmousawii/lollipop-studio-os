# Feature 105 - R10: Workflow Policy Builders

## Goal

Centralize booking, editing, production, and delivery workflow action availability, labels, blockers, and override requirements behind per-area policy builders so workflow forms render policy DTOs instead of hardcoding action lists or recomputing transition rules, while existing write services remain authoritative and unchanged in behavior.

## Read First

- `AGENTS.md` - repository rules, especially narrow context, docs-only progress behavior, and service-only DB access.
- `context/ui-context.md` - order detail, booking detail, form, status badge, and queue UI patterns.
- `context/reviews/centralization-roadmap.md` - Spec R10, R10 split note, risk controls, tests row, do-not-touch boundaries, and R11/R12 sequencing.
- `context/feature-specs/104-r9-order-edit-mode-policy.md` - current policy pattern: pure builder, server-loaded DTOs, guard-message alignment, and component rendering from policy output.
- `src/modules/bookings/booking.service.ts` and `src/modules/bookings/booking.schema.ts` - current booking status transitions, deposit confirmation path, and `updateBookingStatus(...)` guard behavior.
- `src/components/bookings/booking-status-actions.tsx` and `app/bookings/actions.ts` - current booking action map, submit state, and permission/action wrapper.
- `src/modules/orders/order.service.ts` - current workflow mappers, update services, transition assertions, guard errors, activity writes, and delivery payment-settlement drift.
- `src/modules/orders/order.schema.ts`, `src/modules/orders/order.types.ts`, and `src/modules/orders/order.constants.ts` - current workflow action names, DTO shapes, status labels, and transition maps.
- `src/components/orders/editing-workflow-form.tsx`, `src/components/orders/production-workflow-form.tsx`, and `src/components/orders/delivery-workflow-form.tsx` - current form actions, local buttons, blockers, and visible copy.
- `src/modules/financial-cases/financial-case-summary.service.ts`, `src/modules/financial-cases/financial-case-summary.types.ts`, and `src/modules/financial-cases/financial-case-summary.constants.ts` - canonical payment status source needed by delivery.
- Existing tests in `tests/orders/`, `tests/bookings/`, and `tests/adjustment-workspace/` - current policy, workflow, action, and render test style.

## Rules

- **One shared roadmap spec, four independently mergeable tasks.** Implement R10 as R10a booking, R10b editing, R10c production, and R10d delivery. Each task must be independently reviewable, testable, and mergeable.
- **Do not implement unrelated R11/R12 cleanup.** Do not introduce `getOrderDetailsView(orderId)`. Do not remove global compatibility paths such as `summarizeInvoices()` or settlement fallbacks outside the narrow delivery workflow usage called out in R10d.
- **Policy builders are read/policy only.** They return action availability, blocked reasons, labels, confirmations, status display hints, and override requirements. They do not mutate.
- **Write services stay authoritative.** Existing service guards, transition assertions, permissions, transactions, and audit/activity writes remain the enforcement layer. Policies must mirror those rules through shared predicates/constants or contract tests.
- **No schema, enum, migration, or seed change.** If a policy needs context that is not currently loaded, add a service-layer loader/mapper from existing rows.
- **No workflow redesign.** Preserve current visible workflows and action names unless centralizing copy reveals stale component-only wording.
- **No broad subsystem review.** Verify only the touched interfaces and the drift listed here.
- **No component-owned workflow decisions after a surface is wired.** Components may handle local form state and render policy output, but they must not decide available actions from raw statuses, invoice rows, or booleans once their task is complete.
- **Status labels stay centralized.** Reuse existing status label maps in `order.constants.ts` and booking status badge/source labels; do not redefine labels in components.
- **Financial settlement stays canonical where touched.** R10d must source delivery payment settlement from `FinancialCaseSummary` / `paymentStatusEnum`, not from `summarizeInvoices(order.invoices)`.
- **Current implementation drift to account for.** `booking-status-actions.tsx` owns `STATUS_ACTIONS` and contains stale deposit-confirmation gating. Editing, production, and delivery forms render hardcoded buttons from booleans on `Order*Workflow` DTOs. `mapOrderDeliveryWorkflow(...)` and pickup completion currently derive `paymentSettled` from final invoice rows through `summarizeInvoices(...)`; R10d must align that surface with the canonical financial read model.

## Scope

### In Scope

- A shared workflow policy DTO shape or closely related per-area DTOs with at least:
  - action key
  - label
  - action intent / severity metadata, such as `WorkflowActionIntent = "primary" | "secondary" | "warning" | "destructive"`
  - availability / disabled state
  - blocked reason or blocker messages
  - confirmation message where applicable
  - manager/admin override requirement where applicable
  - optional next-status or route/display metadata where useful.
- Pure policy builders, separated from DB-backed loaders, for:
  - `buildBookingWorkflowPolicy`
  - `buildEditingWorkflowPolicy`
  - `buildProductionWorkflowPolicy`
  - `buildDeliveryWorkflowPolicy`
- Service-layer mappers/loaders that build policy context from existing booking/order rows.
- Workflow DTO updates that pass policy output to the corresponding components while preserving existing compatibility fields where needed during the task.
- Component updates so the visible workflow buttons, labels, disabled states, warnings, blockers, and confirmations render from policy output.
- Contract tests proving policy decisions match the current write-service guards/transition rules for each completed task.
- Source or render tests preventing component-local hardcoded workflow action lists from returning in each completed task.

### Out of Scope

- Prisma schema, migration, seed data, enum, or persisted JSON changes.
- Invoice, payment, allocation, refund, credit-note, adjustment invoice, or adjustment-workspace finalization behavior changes.
- Booking confirmation/deposit/check-in write behavior changes.
- Editing, production, or delivery transaction behavior changes beyond reading centralized policy context and canonical delivery payment settlement.
- Permission model changes.
- Queue page redesigns.
- New workflow statuses, new workflow actions, or renamed action form values.
- `getOrderDetailsView(orderId)` or order detail loader collapse.
- Removing global legacy helpers except the direct R10d replacement of delivery workflow payment settlement reads.

## Implementation Direction

Treat R10 like the workflow-policy counterpart to R9: pure builders own display/action decisions, service write functions still enforce the rules, and components render DTOs. Keep each task small. It is acceptable for R10a to establish shared workflow policy types and for later tasks to extend them, as long as each task leaves the app buildable and tests passing.

Prefer this implementation shape:

- Policy modules live in the owning domain. Booking policy belongs under `src/modules/bookings/`; order workflow policies belong under `src/modules/orders/policies/`.
- Pure builders accept already-loaded context: current status, payment/readiness booleans, assignment state, section statuses, delivery payment settlement, and order terminal state.
- DB-backed service loaders/mappers assemble that context and then attach the policy DTO to existing workflow results.
- Components render `policy.actions` or equivalent typed action rows instead of maintaining their own action list.
- Components render button styling, confirmation emphasis, and warning/destructive treatment from policy-owned intent metadata. They must not infer destructive or warning semantics from action names, blocked reasons, or status strings.
- Write services either reuse the same small predicate/message helpers or get contract tests that fail when policy and guard behavior diverge.

The action intent field is part of centralizing workflow display semantics the same way R9 centralized edit-mode messaging and routing semantics. It is not a workflow redesign, does not add actions, does not change submitted payloads, and does not require schema changes.

### R10a - Booking Workflow Policy

Add `buildBookingWorkflowPolicy` for booking detail status actions. It should mirror `ALLOWED_STATUS_TRANSITIONS` and current service behavior without changing deposit recording or check-in flows.

The booking policy should expose the currently valid status actions for the booking detail page, including no-show and cancellation for confirmed bookings, confirmation copy for destructive actions, and blocker/empty states for pending, checked-in, cancelled, and no-show bookings. `BookingStatusActions` should render from the policy output instead of `STATUS_ACTIONS`.

Keep deposit recording and check-in separate. Do not reintroduce a status-action path for confirmation; confirmation remains the deposit recording transaction. If the stale `nextStatus === CONFIRMED` deposit gate disappears as part of replacing `STATUS_ACTIONS`, that is acceptable because the component no longer owns the action list.

Tests for R10a should cover policy rows for pending, confirmed, checked-in, cancelled, no-show, deposit-paid/unpaid context, and contract alignment with invalid `updateBookingStatus(...)` transitions.

### R10b - Editing Workflow Policy

Add `buildEditingWorkflowPolicy` for editor assignment and editing progression. It should own the action DTOs for assign, start, request revision, complete, approve, and send to production.

Move action availability currently represented by `canAssignEditor`, `canMarkStarted`, `canRequestRevision`, `canMarkComplete`, `canMarkApproved`, and `canSendToProduction` into policy output. Preserve existing form inputs, editor selection, estimated completion, edited-photo count behavior, and the outstanding-payment warning/payment-dialog surface.

The policy must represent blockers already enforced by `updateOrderEditingWorkflow(...)` and `assertEditingReadyToStart(...)`: cancelled/delivered order, missing editor, incomplete selection, unsettled deposit/final balance, and invalid status transitions. Do not change the current editing action names submitted by the form.

Tests for R10b should cover the editing state table, start blockers, assignment edge cases, revision/approval transitions, send-to-production transition, and contract alignment with `assertEditingReadyToStart(...)` / transition assertions.

### R10c - Production Workflow Policy

Add `buildProductionWorkflowPolicy` for production section actions and final readiness. It should own the action DTOs and labels for album design, printing, assembly, vendor, framed prints, and final readiness.

Move action selection currently split across `buildProductionSections(...)`, `productionSection(...)`, `canUpdateProduction`, `canMarkReadyForPickup`, and `resolveProductionReadinessWarning(...)` into policy-owned output. The production form should render section actions from policy output, while preserving the current section cards, status metrics, and action form values.

The policy must represent current blockers: cancelled/delivered order, editing not approved/completed for pickup readiness, album assembly depending on album design completion, already-ready/completed production, and invalid transition attempts. Do not change activity titles, metadata, production-job upsert behavior, or delivery readiness writes.

Tests for R10c should cover each section status, assembly dependency, ready-for-pickup blocker states, cancelled/delivered blocking, and contract alignment with `resolveProductionUpdate(...)` guard errors.

### R10d - Delivery Workflow Policy

Add `buildDeliveryWorkflowPolicy` for customer notification, pickup completion, payment override requirements, and completion blockers.

Move action availability currently represented by `completionBlockers`, `requiresPaymentOverride`, `canRecordNotification`, and `canMarkPickedUp` into policy output. The delivery form should render blockers, override copy, and action buttons from policy output while preserving pickup notes, override checkbox, override reason validation UI, and submitted action names.

Replace delivery workflow payment settlement reads with `FinancialCaseSummary`-sourced settlement. `mapOrderDeliveryWorkflow(...)` and pickup completion guard logic should receive/use a canonical payment-settlement context derived from `getFinancialCaseSummary({ orderId })` or an equivalent service-layer helper. Treat `PAID` and `OVERPAID` as settled. Preserve the current manager/admin override path for unsettled payment. If the summary is missing, expose an explicit payment-settlement blocker rather than silently deriving from invoice rows in the delivery workflow path.

Do not remove `summarizeInvoices()` globally in R10d. Only stop using it for delivery workflow settlement and pickup-completion decisions.

Tests for R10d should cover ready/not-ready delivery, customer notification, pickup completion, payment settled/unsettled/overpaid/refunded/missing-summary contexts, manager override requirements, actor-missing errors, production readiness blockers, and contract alignment with `resolveDeliveryUpdate(...)` / `WorkflowGuardError` codes.

## Observability Checklist

### Dashboards / Metrics

- No new production metric or dashboard is required.
- Preserve existing activity/audit writes and guard-blocked activity logs.
- R10 observability is regression coverage: per-policy state-table tests, contract tests against write guards, render tests for forms, and source tests preventing component-owned action lists from returning.

### Rollback Plan

- No schema changes. No down-migration needed.
- Roll back one task at a time by restoring that workflow component to its previous DTO booleans/action list while leaving completed policy tasks intact.
- If a policy rule is wrong, fix the policy or shared predicate first. Do not add compensating workflow action logic back into components.
- For R10d, rollback may temporarily restore delivery settlement from invoice rows only if the canonical summary integration is the fault; document the rollback because it reintroduces roadmap drift.

### Customer-Visible Surface

- Staff should see the same workflow actions and statuses, but action availability, blocker copy, and confirmations should become more consistent.
- Booking actions remain no-show/cancel where currently visible.
- Editing, production, and delivery forms keep their current layout and submitted actions.
- Delivery payment override behavior remains visible only when payment is not settled, now based on canonical FinancialCase payment status.

## Post-Implementation

- After each task PR, update `context/progress-tracker.md` to name the completed R10 task and the next R10 task.
- After R10d, update `context/progress-tracker.md` Now to say R10 workflow policy builders are complete and R11 order-details orchestrator reassessment / R12 cleanup are next.
- Do not update architecture-context or code-standards unless implementation discovers a documented rule conflict.
- Do not refresh `context/reviews/invariant-catalog.md`; R10 should not change financial invariant metadata.

## Acceptance Criteria

- R10a creates a booking workflow policy builder and `BookingStatusActions` renders from policy output instead of a component-local `STATUS_ACTIONS` map.
- R10a preserves deposit recording and check-in as separate flows and does not add a status-action confirmation path.
- R10a tests cover booking statuses, allowed actions, destructive confirmations, and alignment with `updateBookingStatus(...)` invalid-transition behavior.
- R10b creates an editing workflow policy builder and `EditingWorkflowForm` renders action buttons from policy output instead of local `can*` decisions.
- R10b preserves existing editing form inputs, action names, payment warning/dialog behavior, activity writes, and transition semantics.
- R10b tests cover editing action availability, start blockers, invalid transitions, and guard-message alignment.
- R10c creates a production workflow policy builder and `ProductionWorkflowForm` renders section/final-readiness actions from policy output.
- R10c preserves production section keys, action names, status labels, activity metadata, and delivery readiness side effects.
- R10c tests cover section action matrices, readiness blockers, assembly dependency, terminal order states, and guard-message alignment.
- R10d creates a delivery workflow policy builder and `DeliveryWorkflowForm` renders blockers, override requirements, and action buttons from policy output.
- R10d delivery payment settlement uses `FinancialCaseSummary` / `paymentStatusEnum`, not `summarizeInvoices(order.invoices)`, for both display policy and pickup-completion guard decisions.
- R10d treats canonical `PAID` and `OVERPAID` statuses as settled, requires override for unsettled statuses, and shows an explicit blocker for missing summary context.
- R10d tests cover payment-settlement statuses, missing summary, override permissions, actor-missing handling, production readiness blockers, and guard-code alignment.
- Every completed task has a pure policy-builder unit test and at least one render or source test proving the corresponding component no longer owns the workflow action list.
- Existing write services remain authoritative; policy decisions are backed by shared predicates/constants or contract tests that fail on drift.
- No workflow action form values are renamed.
- No Prisma schema, migration, enum, seed, invoice/payment/refund/adjustment, booking confirmation, check-in, or workflow transaction semantics change.
- No `@/lib/db` import is added to `app/**` or `src/components/**`.
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector (`modules/financial-cases/projections/` for FinancialCase-bound surfaces) instead of re-deriving in pages or components. Money is read from raw projector fields and formatted via `src/lib/formatting/money.ts`. No `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run build` passes.
- `npm run lint` passes.
