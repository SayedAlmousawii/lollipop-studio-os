## Goal
Build an "Add New Booking" page — a dedicated `/bookings/new` route with a form that writes a new booking record to the database and redirects back to `/bookings` on success.

## Rules
- Read `AGENTS.md` first.
- Do not modify `prisma/schema.prisma`.
- Do not modify shadcn/ui generated files.
- Do not implement deposit recording, order creation, or invoice logic in this unit.
- No Prisma queries outside of service files.
- Use Zod for server-side validation.
- Use design tokens (CSS variables) only — no raw hex values.
- Business logic lives in the service file only.

## Scope
A form page at `/bookings/new` that:
- Fetches customers and active packages from the DB (async server component)
- Renders a styled form with 5 fields
- Submits via a `"use server"` action
- Creates a `booking` row with `status = PENDING` and `depositPaid = 0`
- Redirects to `/bookings` on success
- Returns inline validation errors on failure (no page reload / no thrown error)

## Form Fields

| Field | Input type | DB column | Required |
|---|---|---|---|
| Customer | Searchable combobox | `customerId` | Yes |
| Package | `<select>` | `packageId` | Yes |
| Session Date | `<input type="date">` | `sessionDate` | Yes |
| Session Type | `<select>` | `sessionType` | Yes |
| Notes | `<textarea>` | `notes` | No |

Session Type options (match DB enum exactly): `NEWBORN`, `KIDS`, `FAMILY`, `MATERNITY`, `OTHER`
Display labels: Newborn, Kids, Family, Maternity, Other

## Zod Schema

Create `src/modules/bookings/booking.schema.ts`:

```ts
import { z } from "zod";

export const createBookingSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  packageId:  z.string().min(1, "Package is required"),
  sessionDate: z.coerce.date({ error: "Session date is required" }),
  sessionType: z.enum(["NEWBORN", "KIDS", "FAMILY", "MATERNITY", "OTHER"], {
    error: "Session type is required",
  }),
  notes: z.string().optional(),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
```

## Service Function

Add to `src/modules/bookings/booking.service.ts`:

```ts
export async function createBookingInDb(data: CreateBookingInput): Promise<{ id: string }> {
  return db.booking.create({
    data: {
      customerId:  data.customerId,
      packageId:   data.packageId,
      sessionDate: data.sessionDate,
      sessionType: data.sessionType,
      notes:       data.notes ?? null,
      status:      "PENDING",
      depositPaid: false,
    },
    select: { id: true },
  });
}
```

Import `CreateBookingInput` from `booking.schema.ts`.

## Server Action

Create `app/bookings/new/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { createBookingSchema } from "@/modules/bookings/booking.schema";
import { createBookingInDb } from "@/modules/bookings/booking.service";

export type ActionState = {
  errors?: Partial<Record<string, string[]>>;
};

export async function createBooking(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const raw = {
    customerId:  formData.get("customerId"),
    packageId:   formData.get("packageId"),
    sessionDate: formData.get("sessionDate"),
    sessionType: formData.get("sessionType"),
    notes:       formData.get("notes") ?? undefined,
  };

  const parsed = createBookingSchema.safeParse(raw);
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  await createBookingInDb(parsed.data);
  redirect("/bookings");
}
```

## Components

### `src/components/bookings/new-booking-form.tsx`
- `"use client"` component
- Uses `useActionState` (React 19 / Next.js 15) to call `createBooking`
- Renders label + input + error message for each field
- Customer field: combobox built from shadcn `Popover` + `Command` (search by name)
- Package field: shadcn `Select`
- Session Date: native `<input type="date">` wrapped in shadcn `Input` styling
- Session Type: shadcn `Select`
- Notes: shadcn `Textarea`
- Submit button shows loading state while action is pending (`useFormStatus`)
- Cancel button: `<Link href="/bookings">` styled as secondary button

Props:
```ts
interface NewBookingFormProps {
  customers: { id: string; name: string }[];
  packages:  { id: string; name: string; price: string }[];
}
```

### `app/bookings/new/page.tsx`
- Async server component
- Fetches customers via `getCustomers()` (map to `{ id, name }`)
- Fetches packages via `getPackages()` (map to `{ id, name, price }`) — filter `isActive === true`
- Renders `PageContainer` with back link + page heading + `<NewBookingForm>`

Page heading: "New Booking"
Back link text: "← Back to Bookings" linking to `/bookings`

## Files to Create

| File | Purpose |
|---|---|
| `src/modules/bookings/booking.schema.ts` | Zod validation schema |
| `app/bookings/new/actions.ts` | `createBooking` server action |
| `src/components/bookings/new-booking-form.tsx` | Client form component |
| `app/bookings/new/page.tsx` | Server component page |

## Files to Modify

| File | Change |
|---|---|
| `src/modules/bookings/booking.service.ts` | Add `createBookingInDb()` |
| `app/bookings/page.tsx` | Wrap "New Booking" button in `<Link href="/bookings/new" asChild>` |

## Done Checks
- [ ] `/bookings/new` loads with all customer and package options populated from the DB
- [ ] Submitting a valid form creates a booking row (`status=PENDING`, `depositPaid=0`) and redirects to `/bookings`
- [ ] New booking appears in the bookings table immediately after redirect
- [ ] Submitting with missing required fields shows inline field-level error messages
- [ ] "New Booking" button on `/bookings` navigates to `/bookings/new`
- [ ] Cancel button on the form returns to `/bookings`
- [ ] No TypeScript errors
- [ ] `npm run build` passes
- [ ] `context/progress-tracker.md` updated

## Out of Scope
- Deposit recording or payment tracking
- Order or invoice creation on booking
- Staff assignment
- Edit or cancel booking forms
- Date conflict / availability checks
- Booking detail page
- Filters wired to real data
- Authentication / role checks
