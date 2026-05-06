## Goal

Make the Editing tab operational so the order can move from selection into editing with visible assignment, progress, revision, and approval state.

---

## Read First

- `agents.md`
- `context/feature-specs/27-order-workflow-sub-status-foundation.md`
- `context/feature-specs/28-order-activity-audit-log-foundation.md`
- `context/feature-specs/29-tabbed-order-hub-ui-shell.md`

---

## Rules

- Keep this unit focused on the Editing tab only
- Do NOT build a full media management system
- Use stored workflow state; do not derive editing stages from the flat order status
- Record meaningful assignment/status changes for activity visibility

---

## Scope

### In Scope

- Build the Editing tab UI
- Show editor assignment and assignment date
- Show editing progress state
- Track revision count / revision state
- Track customer approval state
- Support core editing workflow actions

### Out of Scope

- File upload/review portal
- Automated proof delivery
- Production workflow implementation beyond sending handoff state
- Staff workload scheduling

---

## Required UI

Show:

- assigned editor
- assigned date
- editing status
- progress indicator
- edited photo count
- revision count
- customer approval state
- estimated completion date

---

## Required Actions

- assign/reassign editor
- mark editing started
- request revision
- mark editing complete
- mark customer approved
- send to production

---

## Workflow Rules

- Editing should normally begin after selection is ready
- Editing must not start until base package payment is verified through the financial source of truth
- Sending to production should use an explicit transition, not a loose note/manual label
- Customer approval state must be visible, even if approval is recorded manually in V1
- Revision count/history can stay lightweight as long as the workflow state is traceable

---

## Service Layer

Expected service behavior:

- validate valid editing transitions
- block `mark editing started` until base package payment is verified
- persist assignment and status fields
- update editing-related counts/dates
- record activity entries for assignment and status changes

If a dedicated editing module is not yet present, keep the implementation surface small and compatible with one later.

---

## Acceptance Criteria

- Editing tab shows assignment, status, progress, revision, and approval information
- Staff can assign/reassign editor and move core editing states forward
- Sending the order to production uses stored workflow state
- Important editing changes create activity records
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Update `context/progress-tracker.md`

---

## Assumptions

- V1 can reference external/manual storage links for edited assets instead of hosting media directly in the app
