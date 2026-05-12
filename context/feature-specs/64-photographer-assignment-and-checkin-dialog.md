# Feature 64 — Photographer Assignment & Check-In Dialog

## Goal

Move photographer assignment into a purposeful check-in dialog that collects two required data points — assigned photographer and social media consent — before completing check-in. Booking forms gain a recommended-photographer default based on customer history. `Job` gains first-class photographer and consent fields for future commission use.

## Read First

- `context/feature-specs/61-check-in-rewrite.md` — check-in transaction shape and what gets created
- `src/components/bookings/check-in-button.tsx` — current check-in UI (button + window.confirm)
- `src/components/bookings/check-in-dropdown-item.tsx` — table row variant of same
- `src/components/bookings/new-booking-form.tsx` — booking form photographer field
- `src/components/bookings/edit-booking-form.tsx` — booking edit form photographer field
- `src/modules/bookings/booking.service.ts` — `checkInBooking()`, `getPhotographers()`, photographer recommendation logic goes here

## Rules

- Photographer is **optional** on booking create/edit — no validation change there
- Photographer is **required** at check-in — the dialog must not submit without one selected
- Social media consent is **required** at check-in — the Switch must be explicitly toggled (do not default to true; start unchecked and require the receptionist to make a deliberate choice)
- Check-in remains a single atomic transaction — photographer and consent writes happen inside the existing `checkInBooking()` transaction, not as separate calls
- Do not add a server-side default for `socialMediaConsent` — it must be explicitly provided at check-in
- `window.confirm()` is fully replaced by the new dialog in both `CheckInButton` and `CheckInDropdownItem`
- Recommendation logic is read-only — it never auto-assigns, only pre-fills the picker

## Scope

### In Scope

- Schema: add `assignedPhotographerId` (nullable FK → `User`) and `socialMediaConsent` (nullable `Boolean`) to `Job`
- Migration for both new fields
- Service: extend `checkInBooking()` to accept and write `assignedPhotographerId` and `socialMediaConsent` to `Job`; also update `Booking.assignedPhotographerId` if the receptionist changed it in the dialog
- Service: add `getRecommendedPhotographer(customerId)` — queries the customer's full booking history, groups by `assignedPhotographerId`, returns the most frequent non-null photographer (id + name), or null if no history
- Check-in dialog component (new) replacing both `CheckInButton` and `CheckInDropdownItem` — shadcn Dialog with:
  - Photographer select (required), pre-filled from `Booking.assignedPhotographerId`
  - Recommended photographer note below the picker: "Recommended: [Name]" or "No photographer history found"
  - Social media consent Switch (yes/no label), starts unchecked, required
  - Submit blocked until both fields are satisfied
  - Existing global error surface preserved
- New/Edit booking forms: on customer load/change, fetch the recommended photographer and default the picker to that value; show "No photographer history found" note below the field if no recommendation exists; field remains optional

### Out of Scope

- Displaying `socialMediaConsent` or `Job.assignedPhotographerId` anywhere in the UI beyond what is described above
- Commission calculation — `Job.assignedPhotographerId` is schema-only for now
- Consent history or audit logging
- Per-customer consent defaults

## Implementation Direction

**Schema first.** Add `assignedPhotographerId` and `socialMediaConsent` to `Job` in `schema.prisma` and run the migration. Both are nullable so existing job rows are unaffected.

**Service layer.** Add `getRecommendedPhotographer(customerId: string)` in `booking.service.ts` alongside the existing `getPhotographers()`. Query `Booking` where `customerId` matches and `assignedPhotographerId` is not null, group the results client-side (or via a `groupBy`) to find the most frequent value, then resolve the user name. Return `{ id, name } | null`.

Extend `checkInBookingSchema` to include `assignedPhotographerId` (required string) and `socialMediaConsent` (required boolean). Inside the `checkInBooking()` transaction, write both to the `Job` create call, and update `Booking.assignedPhotographerId` to the submitted value (it may differ from what was on the booking if the receptionist swapped it).

**Check-in dialog.** Create a new `CheckInDialog` component that wraps the shadcn `Dialog`. It receives `bookingId`, `assignedPhotographerId` (from the booking read model), `photographers` list, and `recommendedPhotographer` (resolved before render). The dialog form posts to `checkInBookingAction`. Replace the render output of both `CheckInButton` and `CheckInDropdownItem` with this dialog — keep the same entry-point props so call sites don't change.

The social media consent Switch should use the shadcn `Switch` component with a clear "Yes / No" label alongside it. A hidden input synced to Switch state passes the boolean value to the form action.

**Booking forms.** In the server components that render `NewBookingForm` and `EditBookingForm`, call `getRecommendedPhotographer(customerId)` when a `customerId` is available and pass the result as a prop. In the form components, use this to set the `defaultValue` of the photographer select and render the note below it. On the new booking form, `customerId` is selected by the user — the recommendation should resolve server-side on the initial render where a `customerId` query param exists, and the note should clarify that the recommendation is based on session history.

## Post-Implementation

- Update `context/progress-tracker.md` — Now section and Feature History

## Acceptance Criteria

- [ ] `Job` has `assignedPhotographerId` and `socialMediaConsent` in schema; migration applies cleanly
- [ ] `checkInBooking()` writes both fields to `Job` and updates `Booking.assignedPhotographerId` in the same transaction
- [ ] Check-in dialog appears for both the detail-page button and the table dropdown item
- [ ] Dialog photographer field pre-fills from booking's assigned photographer
- [ ] Recommended photographer note shows correctly; "No photographer history found" when no history
- [ ] Dialog blocks submission if photographer is not selected
- [ ] Dialog blocks submission if social media consent Switch has not been toggled (remains in default unchecked state without interaction — require explicit interaction, not just a value check)
- [ ] New booking form defaults photographer picker to recommended photographer when customerId is present
- [ ] Edit booking form shows recommended photographer note; picker retains saved value
- [ ] Photographer field on booking forms remains optional (no validation error on save without one)
- [ ] `npm run build` passes
- [ ] `npm run lint` passes
