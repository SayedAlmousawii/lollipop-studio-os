## Goal

Build the tabbed Order detail shell so the order page becomes a clearer operational workspace without yet implementing every workflow action.

---

## Read First

- `agents.md`
- `context/feature-specs/18-add-edit-order-page.md`
- `context/feature-specs/27-order-workflow-sub-status-foundation.md`
- `context/feature-specs/28-order-activity-audit-log-foundation.md`

---

## Rules

- Keep this unit focused on layout and read-oriented page structure
- Do NOT implement full tab workflows in this unit
- Use real available data; do not build decorative fake widgets
- Reuse current order reads and summary concepts where possible
- Keep future tab actions easy to plug in without rewriting the shell

---

## Scope

### In Scope

- Refactor the order detail page into a tabbed layout
- Add a compact header area
- Add summary cards / workflow progress strip
- Add tab panels for:
  - Overview
  - Selection
  - Editing
  - Production
  - Delivery
  - Financials
  - Activity
- Render read-only previews/placeholders for tabs whose full actions come later

### Out of Scope

- Full selection action workflow
- Full editing assignment workflow
- Full production controls
- Full delivery completion controls
- Deep invoice editing UI

---

## Page Requirements

### Header Area

Show only the top-order context:

- order number / public ID
- customer
- session date/time/type
- package summary
- financial summary
- overall workflow status
- primary next action

### Workflow Summary

Add a compact progress/status strip based on real stored workflow state where available.

### Tabs

Create the main shell with:

```text
Overview | Selection | Editing | Production | Delivery | Financials | Activity
```

---

## Overview Tab

Include:

- next action card
- high-level workflow progress
- recent activity preview
- key order notes
- links to related records such as customer, booking, invoice, and package

This tab should feel operational, but it does not need every future action button yet.

---

## Data Requirements

The order page read model may need a composed query/view model that gathers:

- order summary
- package summary
- invoice summary
- workflow sub-statuses
- recent activity preview

Keep composition in the service layer.

---

## Acceptance Criteria

- Order detail page uses a tabbed shell
- Header is simplified and focused on the most important context
- Overview tab renders real summary content
- Selection, Editing, Production, Delivery, Financials, and Activity tabs exist as page structure
- Tabs consume real available data instead of fake placeholders where data already exists
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Update `context/progress-tracker.md`

---

## Assumptions

- Using existing tab primitives/design tokens is preferred over introducing a new UI pattern for this page
