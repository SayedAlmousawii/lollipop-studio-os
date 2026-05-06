## Goal

Make the Selection tab operational so staff can manage photo counts, add-ons, and the keep-package-vs-upgrade decision in one guided workflow.

---

## Read First

- `agents.md`
- `context/feature-specs/26-order-package-changes-invoice-sync.md`
- `context/feature-specs/27-order-workflow-sub-status-foundation.md`
- `context/feature-specs/29-tabbed-order-hub-ui-shell.md`

---

## Rules

- Keep this unit focused on the selection workflow area only
- Reuse the financial sync behavior from Unit 26; do not duplicate invoice logic in UI
- Use real selection workflow state from Unit 27
- Guide staff toward the next financial decision instead of leaving all reasoning manual

---

## Scope

### In Scope

- Build the operational Selection tab UI
- Show package selection limits and overage context
- Update selected photo count
- Manage order add-ons within the selection flow
- Capture selection notes
- Mark selection completed
- Surface upgrade recommendation / payment-adjustment guidance

### Out of Scope

- Full media upload/gallery system
- Editing workflow controls
- Production workflow controls
- Delivery workflow controls

---

## Required UI

Show:

- package photo limit
- selected photo count
- extra selected photos
- upgrade recommendation
- add-ons
- selection notes
- selection completed timestamp

Also show a clear decision aid between:

```text
Keep current package + pay extras/add-ons
```

or

```text
Upgrade package + pay difference
```

---

## Required Actions

- update selected photo count
- add/remove add-ons
- recommend upgrade
- mark selection completed
- create or route to payment adjustment handling if needed

Keep action wiring thin:

- UI collects intent
- service layer validates and computes outcomes

---

## Workflow Rules

- Selection state should come from stored sub-status, not derived order labels
- Completing selection should update `selectionStatus`
- If financial consequences exist, the tab should surface them clearly before completion
- The system should reduce manual staff math when extras or upgrades are involved
- If the staff finalizes an upgrade path, the service flow must trigger the commission-creation/update hook for the resulting upgrade difference, even if the full Commission module is still a later unit

---

## Service Layer

The order/selection service behavior should return enough data for the tab to show:

- included photo count
- over-limit count
- current add-on total
- package upgrade difference
- next recommended financial action

Do not place pricing formulas directly in the component tree.

If the tab finalizes an upgrade decision, the service flow should:

- sync the invoice adjustment outcome
- trigger the commission hook
- return the updated financial consequence for staff confirmation

---

## Acceptance Criteria

- Selection tab shows package limit, selected count, and extra count
- Add-ons can be managed from the selection workflow
- Upgrade recommendation guidance is visible when relevant
- Selection notes and completion state are supported
- Completing selection updates stored workflow state
- Financial consequences route through service-layer logic, not manual UI math
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Update `context/progress-tracker.md`

---

## Assumptions

- V1 can use numeric selection counts and notes without requiring image-by-image asset selection
