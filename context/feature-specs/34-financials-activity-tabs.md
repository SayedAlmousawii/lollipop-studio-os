## Goal

Complete the Financials and Activity tabs so the order hub exposes strong read-focused visibility into money state and operational traceability.

---

## Read First

- `agents.md`
- `context/feature-specs/26-order-package-changes-invoice-sync.md`
- `context/feature-specs/28-order-activity-audit-log-foundation.md`
- `context/feature-specs/29-tabbed-order-hub-ui-shell.md`

---

## Rules

- Keep this unit focused on read-first visibility for Financials and Activity
- Do NOT duplicate large invoice-editing workflows inside the order page
- Reuse the activity foundation from Unit 28
- Present data clearly enough that staff can understand balance and history without leaving the order unless deeper editing is needed

---

## Scope

### In Scope

- Complete the Financials tab UI
- Complete the Activity tab UI
- Show invoice/payment summaries from real data
- Show full chronological order activity timeline
- Add light filtering/grouping only if it stays simple

### Out of Scope

- Full invoice editor embedded inside the order page
- New payment recording flow if it already belongs elsewhere
- Global audit search/reporting screens

---

## Financials Tab Requirements

Show:

- invoice number
- invoice status
- package price
- upgrade adjustments
- add-on adjustments
- invoice total
- paid amount
- balance due
- payment stages
- links to invoice/payment records

The tab should be read-focused, with links/actions that route to the dedicated invoice/payment area where deeper edits belong.

---

## Activity Tab Requirements

Show:

- full chronological activity timeline
- important event labels
- workflow status changes
- payment/invoice events
- package/add-on changes
- assignment changes
- note-related events

Simple filtering by event type is allowed if implementation remains lightweight.

---

## Presentation Rules

- Most recent events first is acceptable
- Grouping by date is acceptable if it improves scanability
- Event labels should be clear to staff, not raw internal codes
- Metadata should be rendered in a human-readable summary form

---

## Service Layer

Expected service behavior:

- provide a composed financial summary read model for the order
- provide paged or limited activity reads if needed for performance
- keep invoice/payment source data in their owning services/modules

---

## Acceptance Criteria

- Financials tab shows the defined invoice/payment summary fields
- Activity tab shows the order’s chronological event history
- Staff can navigate from the order hub to full invoice/payment records
- Financials remain read-focused if deeper editing belongs to the invoice/payment module
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Update `context/progress-tracker.md`

---

## Assumptions

- If the activity timeline grows large, simple pagination or capped initial loading is acceptable for V1
