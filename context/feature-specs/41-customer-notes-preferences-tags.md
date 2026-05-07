## Goal

Add useful internal customer context to the customer profile, starting with persisted notes and only extending into preferences/tags where the current data model already supports it.

---

## Read First

- `agents.md`
- `context/feature-specs/38-edit-customer-flow.md`
- `context/feature-specs/39-customer-detail-profile-page.md`
- `context/reviews/customers-page-gap-review.md`

---

## Rules

- Use the existing `Customer.notes` field for persistence in this unit
- Do NOT introduce database schema changes for preferences or tags without explicit approval
- Keep this feature internal-facing; no marketing automation or external messaging flows
- Do not expand this unit into reporting or loyalty work

---

## Scope

### In Scope

- Add a clear internal notes section on the customer profile
- Allow notes to be created/edited through the shared customer update flow or a focused notes action
- Display notes in a way that is easy for staff to scan
- Optionally add lightweight non-persistent UI placeholders for future preferences/tags only if clearly labeled and not misleading

### Out of Scope

- New database fields for preferences, tags, consent tracking, or loyalty data
- Marketing automation
- WhatsApp integration
- Advanced reporting

---

## Implementation Direction

Preferred behavior:

- persist internal notes via the existing customer update path
- show notes on `app/customers/[customerId]/page.tsx`
- keep notes editable from either:
  - the edit customer page, or
  - a focused inline profile action if that is simpler and consistent

If the current schema has no real place to store preferences or tags, omit them rather than shipping decorative controls that suggest saved behavior.

---

## Acceptance Criteria

- Staff can view a customer’s internal notes from the profile page
- Staff can add or update notes through a real save flow
- Saved notes persist across refreshes
- The UI does not imply that unsupported preference/tag data is being saved
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Update `context/progress-tracker.md`

---

## Assumptions

- In the current schema, notes are the only persisted customer-context field available for this unit
- Preferences and tags should remain future work unless explicit schema support is approved later
