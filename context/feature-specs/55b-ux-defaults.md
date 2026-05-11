## Goal

Add two missing default values that staff have to fill manually every time: the estimated editing completion date and the booking session time.

---

## Rules

- No schema changes for the date default
- Booking time field requires a schema addition and action update — stay within that scope
- No new UI components

---

## Change 1 — Estimated Editing Completion Date Defaults to Today + 14 Days

**Location:** `src/modules/orders/order.service.ts` — `mapOrderEditingWorkflow`

**Current behavior:** `estimatedCompletionDateInput` returns `""` when no date is set, leaving the field blank.

**Fix:** When `estimatedEditingCompletionAt` is null, compute a default of today + 14 days and return it as the input default:

```ts
estimatedCompletionDateInput: estimatedEditingCompletionAt
  ? formatDateInput(estimatedEditingCompletionAt)
  : formatDateInput(addDays(new Date(), 14)),
```

Use `date-fns` `addDays` — it is already a project dependency. Import it at the top of `order.service.ts`.

The form field in `editing-workflow-form.tsx` already uses `defaultValue={editing.estimatedCompletionDateInput}` — no form changes are needed. The default is never written to the DB until the user explicitly saves; it only pre-fills the input.

---

## Change 2 — Booking Form: Add Session Time Field

**Location:**
- `src/components/bookings/new-booking-form.tsx`
- `src/components/bookings/edit-booking-form.tsx`
- The booking create/update action and schema
- `prisma/schema.prisma` (add `sessionTime String?` to `Booking` model)

**Current behavior:** Booking form captures session date but no time. Bookings are ambiguous for scheduling.

### Schema

Add to the `Booking` model:

```prisma
sessionTime String
```

Run a migration. Existing records must be backfilled with a placeholder (e.g. `"00:00"`) since the field is required.

### Form

In both `new-booking-form.tsx` and `edit-booking-form.tsx`, add a required time input directly after the session date field:

```tsx
<div className="space-y-2">
  <Label htmlFor="sessionTime">Session time</Label>
  <Input
    id="sessionTime"
    name="sessionTime"
    type="time"
    required
    defaultValue={booking?.sessionTime ?? ""}
  />
</div>
```

### Schema validation

In the booking Zod schema, add:

```ts
sessionTime: z.string().regex(/^\d{2}:\d{2}$/),
```

### Action / service

Pass `sessionTime` through the create and update booking action and service layer. Store as-is (HH:MM string). Read the existing action and service before editing — follow the same pattern used for `sessionDate`.

### Display

Surface `sessionTime` alongside `sessionDate` in the booking detail card and any booking list row that already shows the date.

---

## Post-Implementation

**`context/progress-tracker.md`**
- Update Now section: Feature 55b complete; next is 55c
- Add to Feature History: "Feature 55b: Editing date default (today+14), booking session time field added."

---

## Acceptance Criteria

1. Opening the editing tab with no estimated date pre-fills the field with today + 14 days
2. Saving a booking with no time set is rejected (field is required)
3. Saving a booking with a time stores and displays it correctly
4. Existing records are backfilled so the migration succeeds
5. TypeScript passes
6. `npm run build` passes
7. `npm run lint` passes
8. Update `context/progress-tracker.md`
