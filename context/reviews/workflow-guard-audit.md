# Workflow Guard Audit
Date: 2026-05-10

---

## Purpose

Inventory all existing workflow guards in the service layer, identify missing or weak guards, and propose Feature 52 implementation units in priority order.

This is a review document. No code was changed.

---

## Architectural Principle

Each workflow step requires the previous step to be complete before it can proceed:

- Selection `COMPLETED` → editing can start *(enforced)*
- Editing `APPROVED` or `COMPLETED` → production can be marked `READY_FOR_PICKUP` *(missing — P1)*
- Production `READY_FOR_PICKUP` or `COMPLETED` → delivery can complete *(enforced)*

---

## Existing Guards — What Is Already Enforced

### Booking Workflow (`src/modules/bookings/booking.service.ts`)

| Guard | Location | Notes |
|---|---|---|
| Status machine — `ALLOWED_STATUS_TRANSITIONS` | line ~115 | PENDING → CONFIRMED/CANCELLED; CONFIRMED → CANCELLED; terminal states block further transitions |
| `validateStatusTransition()` | line ~703 | Throws on invalid transition |
| Edit blocked on COMPLETED / CANCELLED / NO_SHOW | line ~339 | Throws with clear message |
| Deposit — no duplicate, only on PENDING | line ~507 | Throws if deposit already recorded or booking is not PENDING |
| Confirm — requires deposit recorded first | line ~443 | Throws: "Booking cannot be confirmed until the deposit is recorded" |
| Base payment — only on CONFIRMED bookings | line ~570 | Throws if not CONFIRMED |
| `validateBookingReferences()` | line ~640 | Verifies customer, package (active), department (active), photographer (role check) |
| `lockBookingForUpdate()` | line ~694 | Pessimistic DB lock (`FOR UPDATE`) during mutations |

### Order Selection Workflow (`src/modules/orders/order.service.ts`)

| Guard | Location | Notes |
|---|---|---|
| `assertSelectionWorkflowWritable()` | line ~2534 | Blocks orders that have not cleared the base payment gate, and CANCELLED orders. Note: the `ACTIVE` status used for the ungated state is a naming issue — it reads as "in progress" but means "base payment not yet recorded". Candidate for renaming to `AWAITING_BASE_PAYMENT` in a future cleanup. |
| Package existence check | line ~440 | Throws if selected package does not exist |

### Order Editing Workflow (`src/modules/orders/order.service.ts`)

| Guard | Location | Notes |
|---|---|---|
| `assertEditingReadyToStart()` | line ~3143 | Requires: selection COMPLETED + base payment verified + editor assigned |
| `assertWorkflowTransition()` on `editingStatus` | line ~566 | Validated against `ORDER_WORKFLOW_TRANSITIONS.editingStatus` state machine |
| Editing blocked on CANCELLED / DELIVERED orders | line ~519 | Throws with order status in the message |
| Editor existence + role check | line ~553 | Throws if editor not found or wrong role |

### Order Production Workflow (`src/modules/orders/order.service.ts`)

| Guard | Location | Notes |
|---|---|---|
| `assertProductionWorkflowWritable()` | line ~2525 | Blocks CANCELLED and DELIVERED orders |
| `assertWorkflowTransition()` on `productionStatus` | inline | Validated against `ORDER_WORKFLOW_TRANSITIONS.productionStatus` state machine |

### Order Delivery Workflow (`src/modules/orders/order.service.ts`)

| Guard | Location | Notes |
|---|---|---|
| `assertDeliveryWorkflowWritable()` | line ~2883 | Blocks CANCELLED and DELIVERED orders |
| `assertProductionReadyForDelivery()` | line ~3109 | Requires: `productionStatus` is `READY_FOR_PICKUP` or `COMPLETED`. Currently also checks that all production sections are individually COMPLETED — this is a bug (see P1b). |
| Payment settlement gate | line ~3020 | Must be Paid or Overridden; override requires reason + `actorUserId` |
| Actor required for delivery completion | line ~3024 | Throws if `actorUserId` missing |
| `assertWorkflowTransition()` on `deliveryStatus` | inline | Validated against `ORDER_WORKFLOW_TRANSITIONS.deliveryStatus` state machine |

### Invoice Workflow (`src/modules/invoices/invoice.service.ts`)

| Guard | Location | Notes |
|---|---|---|
| `updateUnlockedInvoiceTotal()` | line ~44 | Blocks updates to locked invoices |
| Duplicate invoice prevention | line ~153 | Re-checks for existing invoice on unique constraint error to handle race conditions |
| Order existence + package price check | line ~103 | Throws if order missing or has no package price |

### Payment Workflow (`src/modules/payments/payment.service.ts`)

| Guard | Location | Notes |
|---|---|---|
| Invoice existence check | line ~33 | Throws "Invoice not found" |
| Payment blocked on locked invoice | line ~45 | Throws "Cannot record payments against a locked invoice" |

---

## Guard Gaps — Prioritized

### P1 — Production can be marked READY_FOR_PICKUP while editing is still in progress

**What is missing:** There is no guard preventing production from being marked `READY_FOR_PICKUP` while `editingStatus` is still `IN_PROGRESS`, `REVISION_REQUESTED`, or another incomplete state. Since delivery trusts production readiness, the editing check must live at the production level.

**Expected rule:** Production cannot be marked `READY_FOR_PICKUP` unless `editingStatus` is `APPROVED` or `COMPLETED`.

**File:** `src/modules/orders/order.service.ts` — production section update logic (`resolveProductionUpdate`, `canMarkReadyForPickup`)

**Proposed fix (52a):** Add `editingStatus` check before allowing `productionStatus = READY_FOR_PICKUP`.

---

### P1b — `assertProductionReadyForDelivery` incorrectly enforces all sections complete

**What is missing:** The function currently blocks delivery if any production section is not `COMPLETED`, even when `productionStatus = READY_FOR_PICKUP`. This is wrong — `READY_FOR_PICKUP` is a deliberate human judgment that the order is ready regardless of individual section states. Not all sections are required for every job.

**File:** `src/modules/orders/order.service.ts` lines ~3109–3124

**Proposed fix (52a):** Remove the all-sections check from `isProductionReadyForDelivery`. `productionStatus = READY_FOR_PICKUP` or `COMPLETED` is sufficient — section completeness is the production team's responsibility enforced at the `READY_FOR_PICKUP` gate, not at delivery.

---

### P2a — No section dependency order enforcement at production readiness

**What is missing:** Some production sections must precede others. For example, `albumDesign` must be completed before `assemblyStatus` can be marked complete. There is no guard enforcing this ordering.

**When it fires:** This guard should block marking `productionStatus = READY_FOR_PICKUP`, not at the delivery level.

**File:** `src/modules/orders/order.service.ts` (production section update logic, `resolveProductionUpdate`)

**Proposed fix (52b):** Add dependency order checks before allowing `READY_FOR_PICKUP` on production.

---

### P2b — No deliverable-driven required sections enforcement

**What is missing:** Which production sections are required depends on what deliverables are on the order. If an order has an album add-on (or later, a package with a default album), then `albumDesign` and `assemblyStatus` are required before `READY_FOR_PICKUP`. No such mapping or enforcement exists.

**Blocker:** The link between `OrderAddOnOption.category` and required production sections is implicit business knowledge — not yet encoded in the schema. Package-level deliverable defaults are also not modeled yet.

**Proposed fix (52b — deferred part):** Schema support required first. Add explicit deliverable-type mapping before writing the guard. This is a later unit within 52b or a separate spec.

---

### P3 — Permission checks absent at the service layer

**What is missing:** `requirePermission()` and `hasPermission()` are only enforced at the server action level. Service functions called directly (scripts, background jobs, tests, future API routes) bypass permission entirely.

**Example:** A `PHOTOGRAPHER` role lacks `DELIVERY_COMPLETE` permission. The server action enforces this, but `updateOrderDeliveryWorkflow()` itself does not — calling it directly bypasses the check.

**Severity:** Not currently exploitable through the UI, but a single-layer defense.

**Proposed fix (52f):** Add permission checks inside service functions for sensitive operations. This is an authorization concern and should be its own spec, implemented after workflow guard fixes.

---

### P4 — No typed error classes for workflow violations

**What is missing:** All guard failures throw plain `new Error("string")`. Every error falls into `errors._global` in the UI with no way to distinguish error types or render contextual actions.

**When it matters:** Only when the UI does not already pre-block the action (disabled button, hidden control). If the UI is always in sync with guard conditions, typed errors add no value.

**Proposed fix (52c):** Audit which guard errors are actually reachable through the UI (i.e. the guard can fire but the button is not disabled). Add typed error classes and contextual UI handling only for those cases. If a contextual error UI component is needed, build it as part of this unit — not separately.

---

### P5 — No guard on duplicate workflow record creation

**What is missing:** `EditingJob` and `ProductionJob` both have `@unique` on `orderId` at the DB level (confirmed in schema lines 344, 371), so duplicate creation is blocked at the database. However, the service may not catch the unique constraint violation gracefully — it could bubble up as a raw DB error rather than a clean message, unlike the invoice service which explicitly re-checks and handles it.

**Proposed fix (part of 52a/52b):** Verify that `EditingJob` and `ProductionJob` creation in the service catches unique constraint errors and surfaces them cleanly.

---

### P6 — Failed guard blocks on high-risk transitions are not audit-logged

**What is missing:** Guard failures throw and stop execution but leave no trace in the activity log. Only successful transitions are logged.

**Not all failures are worth logging** — only high-risk attempted transitions matter for accountability. The spec must define exactly which failures are logged and what metadata is captured (actor, order, attempted action, reason blocked).

**Candidates:**
- Delivery completion blocked (payment not settled)
- Payment override rejected (missing reason or actor)
- Delivery attempted while editing incomplete

**Proposed fix (52e):** Add audit log entries for the defined set of high-risk guard failures.

---

## Feature 52 Implementation Units

| Unit | Description | Priority |
|---|---|---|
| 52a | (1) Remove all-sections check from `assertProductionReadyForDelivery`; (2) Add `editingStatus = APPROVED/COMPLETED` check to production `READY_FOR_PICKUP` guard; (3) Verify `EditingJob`/`ProductionJob` creation surfaces unique constraint errors cleanly | High |
| 52b | Section dependency order enforcement at `READY_FOR_PICKUP` (e.g. albumDesign before assembly); deliverable-driven required sections deferred until schema supports it | High |
| 52c | Audit UI-reachable guard errors; add typed errors + contextual error component only where needed | Medium |
| 52e | Audit-log failed guard blocks on defined high-risk transitions | Low |
| 52f | Service-layer permission enforcement — own authorization spec | Planned |

---

## Recommended Implementation Order

1. **52a** — Fix delivery guard bug; add editing prerequisite to production readiness; verify duplicate record handling
2. **52b** — Section dependency order; deliverable-driven sections deferred until schema supports it
3. **52c** — Typed errors + contextual UI only where guard errors are UI-reachable
4. **52e** — Audit trail for defined high-risk guard failures
5. **52f** — Service-layer permission enforcement (own spec)
