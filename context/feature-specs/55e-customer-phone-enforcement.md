## Goal

Make phone number the primary way to look up and reference customers. Enforce a valid phone format on every customer save so the field is reliable for lookup.

---

## Rules

- No schema changes — `phone` field already exists on `Customer`
- Hard block: any customer create or edit without a valid phone number must fail with a clear error
- Forward-only and retroactive: the block applies to all saves (new and edit); existing customers with invalid phones will be prompted to fix on next edit

---

## Read First

- `src/modules/customers/customer.service.ts` — understand how customers are created and updated
- `src/components/customers/new-customer-form.tsx` (or equivalent create form) — current phone field behavior
- `src/components/customers/edit-customer-form.tsx` (or equivalent edit form)
- The customer search component — how search currently works

---

## Validation

**Location:** Customer Zod schema (wherever `createCustomerSchema` / `updateCustomerSchema` are defined)

Add phone validation:

```ts
phone: z.string()
  .min(7, "Phone number is too short")
  .max(15, "Phone number is too long")
  .regex(/^\+?[\d\s\-().]+$/, "Enter a valid phone number"),
```

Adjust the regex to match the formats used in Kuwait if a stricter format is known. The field must be required (not optional) on both create and update schemas.

**Service layer:** The validation error from Zod will surface through the existing action error handling pattern — no additional service changes needed for validation.

---

## Customer Search — Prioritize Phone

**Location:** The customer search component and the underlying search query in `customer.service.ts`

**Current behavior:** Search queries customer name. Phone is secondary or absent.

**Fix:**
1. Update the search query to search `phone` first, then `name`. Use a Prisma `OR` that puts the phone match first, or use separate priority logic
2. In the search UI, update the input placeholder to "Search by phone or name" to set the correct expectation
3. If the search results display does not already show the phone number prominently, add it as the primary identifier in each result row (larger/bolder than name, or listed first)

---

## Form UI

In both create and edit customer forms:
- Mark the phone field as required (add `*` or `required` attribute)
- Show a FieldError when validation fails
- Move the phone field earlier in the form layout if it is currently below less-important fields — phone should be in the top section alongside name

---

## Post-Implementation

**`context/progress-tracker.md`**
- Update Now section: Feature 55e complete; next is 55f
- Add to Feature History: "Feature 55e: Phone number required on all customer saves; search prioritizes phone."

---

## Acceptance Criteria

1. Creating a customer without a phone number fails with a clear validation error
2. Editing an existing customer and clearing the phone number fails with a clear validation error
3. Customer search finds results by phone number
4. Search UI placeholder indicates phone-first search
5. Phone number is prominently displayed in customer search results
6. TypeScript passes
7. `npm run build` passes
8. `npm run lint` passes
9. Update `context/progress-tracker.md`
