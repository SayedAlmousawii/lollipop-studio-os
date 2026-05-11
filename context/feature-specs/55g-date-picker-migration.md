## Goal

Replace all raw `<Input type="date" />` fields across the app with the existing `DatePicker` component (`src/components/ui/date-picker.tsx`). This makes date entry consistent, calendar-based, and visually uniform across the system.

---

## Background

A `DatePicker` component already exists and is used on the orders filters page via `DateRangePicker`. Single-date inputs in forms still use `<Input type="date" />` which renders a native browser date picker — inconsistent with the calendar popover style used elsewhere.

**Component:** `src/components/ui/date-picker.tsx`
- Props: `value?: string` (ISO `yyyy-MM-dd`), `onChange: (value?: string) => void`, `placeholder?`, `className?`
- Does not render a form `name` attribute — each migration requires a controlled state + hidden input pattern

---

## Files to Migrate

| File | Field |
|------|-------|
| `src/components/orders/editing-workflow-form.tsx` | `estimatedEditingCompletionAt` |
| `src/components/bookings/new-booking-form.tsx` | `sessionDate` |
| `src/components/bookings/edit-booking-form.tsx` | `sessionDate` |
| `src/components/invoices/record-payment-form.tsx` | `paidAt` (payment date) |
| `src/components/customers/child-form-dialog.tsx` | Date of birth field |

---

## Migration Pattern

For each field, replace the `<Input type="date">` with state + hidden input + `DatePicker`:

```tsx
// Before
<Input
  id="sessionDate"
  name="sessionDate"
  type="date"
  defaultValue={booking.sessionDate}
/>

// After
const [sessionDate, setSessionDate] = useState(booking.sessionDate ?? "");

<>
  <input type="hidden" name="sessionDate" value={sessionDate} />
  <DatePicker
    value={sessionDate}
    onChange={(v) => setSessionDate(v ?? "")}
    placeholder="Select date"
  />
</>
```

Read each form file before editing — each one may have slightly different initialization patterns. Follow the existing state management style in each file.

---

## Rules

- Do not modify `date-picker.tsx` — it is already correct
- Do not change any server actions, schemas, or service functions — the date format (`yyyy-MM-dd`) is unchanged
- The `DatePicker` is a client component — forms that are not yet `"use client"` will need the directive added if missing (check each file)
- Keep `className` consistent with surrounding input fields for visual alignment

---

## Post-Implementation

**`context/progress-tracker.md`**
- Update Now section: Feature 55g complete; Feature 55 fully done (or note which units remain)
- Add to Feature History: "Feature 55g: Migrated all raw date inputs to DatePicker component across 5 form files."

---

## Acceptance Criteria

1. All 5 files no longer use `<Input type="date" />`
2. Each field shows a calendar popover on click
3. Form submission still sends the correct `yyyy-MM-dd` value via the hidden input
4. Existing defaultValue/initial value logic is preserved
5. TypeScript passes
6. `npm run build` passes
7. `npm run lint` passes
8. Update `context/progress-tracker.md`
