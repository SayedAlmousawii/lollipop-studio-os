## Goal

Stop deriving the full order workflow from one flat order status and add real stored workflow sub-status fields that can power later tabs.

---

## Read First

- `agents.md`
- `context/feature-specs/22-booking-model-and-flow-alignment.md`
- `context/feature-specs/26-order-package-changes-invoice-sync.md`

---

## Rules

- Keep this unit focused on workflow state modeling and read/write foundations
- Do NOT build the full tabbed UI in this unit
- Keep the existing high-level order status if current reads still depend on it
- Do NOT fake workflow detail from derived labels once real sub-status fields exist
- Service-layer code must own transitions

---

## Scope

### In Scope

- Add stored sub-status fields for order workflow areas
- Define enum/constant values for those sub-statuses
- Update order read models to return real workflow state
- Add service helpers/actions for valid workflow transitions needed by current UI
- Keep current detail page compatible while shifting it to real stored values

### Out of Scope

- Full editing assignment workflow
- Full production section workflow
- Full delivery action workflow
- Full activity timeline UI
- Role/permission expansion beyond current admin-first assumptions

---

## Suggested Workflow Fields

Exact names may align with current schema conventions, but this unit should create separate stored fields for:

- `selectionStatus`
- `editingStatus`
- `productionStatus`
- `deliveryStatus`

`paymentStatus` should not be stored independently on the `Order` row in this unit.

Instead:

- derive `paymentStatus` from the invoice/payment module
- expose it in order read models as computed workflow context
- keep invoice/payment records as the source of truth for money-state reporting

---

## Suggested Status Values

### Selection

```text
PENDING
IN_PROGRESS
COMPLETED
```

### Editing

```text
NOT_STARTED
ASSIGNED
IN_PROGRESS
REVISION_REQUESTED
AWAITING_APPROVAL
APPROVED
COMPLETED
```

### Production

```text
NOT_STARTED
WAITING_FOR_EDITING
IN_PROGRESS
WAITING_FOR_VENDOR
READY_FOR_PICKUP
COMPLETED
```

### Delivery

```text
NOT_READY
READY_FOR_PICKUP
CUSTOMER_NOTIFIED
PICKED_UP
COMPLETED
```

### Payment

For order-hub display, expose a computed `paymentStatus` sourced from invoice/payment state, for example:

```text
PENDING
PARTIALLY_PAID
PAID
OVERRIDDEN
```

---

## Transition Rules

- High-level `order.status` may remain for summary/reporting compatibility
- Sub-statuses become the source of truth for workflow sections
- `paymentStatus` remains derived from invoice/payment state rather than persisted as an independent order workflow field
- Transitions must be explicit in service code, not loosely inferred in components
- Invalid jumps should surface clear errors
- Future units may add more detailed guards, but this unit should establish the foundational transition pattern now

---

## UI Impact

Current order detail reads that show:

- selection status
- editing status
- production status
- delivery status

should switch from derived display mapping to real stored fields where available.

V1 can keep the visual presentation simple as long as the values are no longer fake.

---

## Acceptance Criteria

- Order workflow areas have separate stored sub-status fields
- Status constants/enums are defined centrally
- Services own workflow transition writes
- Order reads expose real workflow sub-status values
- Existing order detail UI no longer depends on one flat derived workflow map for these areas
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Update `context/progress-tracker.md`

---

## Assumptions

- Existing historical orders can receive safe default sub-status values during migration if exact legacy workflow state cannot be reconstructed
