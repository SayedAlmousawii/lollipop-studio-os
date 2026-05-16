# Feature 57g — Dashboard Phone Suggestion Dropdown

## Goal

Upgrade the `PhoneSalesSearch` widget on the dashboard to show a live suggestion dropdown as staff type a partial phone number. Staff should be able to type 3+ digits, see up to 5 matching customers, select one, and immediately see their orders — without needing to submit the form. The existing submit-based fallback must remain intact.

---

## Read First

- `src/components/dashboard/phone-sales-search.tsx` — current widget; this is the primary file being upgraded
- `app/(dashboard)/actions.ts` — existing `lookupDashboardSalesByPhone` server action pattern
- `app/(dashboard)/page.tsx` — how the widget is mounted in the dashboard
- `src/modules/customers/customer.service.ts` — `getCustomerByPhone`, `buildCustomerPhoneLookupWhere`, `normalizePhoneSearch` — reuse these directly
- `src/modules/orders/order.types.ts` — `CustomerOrderHistoryItem` type used in the result list

---

## Rules

- Do NOT modify the database schema or any service functions unless a read-only helper is genuinely missing.
- Do NOT replace the submit-based flow. The suggestion dropdown is additive. Staff who type a full number and press Enter or click Search must still get the same result.
- Keep all DB access server-side. The suggestion endpoint must be an API route or server action — no direct DB calls from the client component.
- Limit suggestions to `id`, `name`, `phone` only. Do not fetch orders until a suggestion is selected or the form is submitted.
- Do not debounce below 250ms or above 400ms. 300ms is the target.
- Do not trigger suggestions for fewer than 3 digits (after stripping non-numeric characters).
- Limit results to 5 suggestions maximum.
- Keyboard navigation is required. This is a staff POS tool — mouse-optional is mandatory.
- The dropdown must be dismissible with Escape and must close on outside click.

---

## Scope

### In Scope

- New API route `GET /api/customers/phone-suggestions?q=<partial>` returning `{ id, name, phone }[]`
- Live suggestion dropdown rendered below the phone input as staff type
- Selecting a suggestion triggers the full lookup (by customer `id`, bypassing fuzzy matching)
- Keyboard navigation: arrow keys move through suggestions, Enter selects, Escape dismisses
- Minimum 3 digits before firing, 300ms debounce, 5-result cap
- Cancel in-flight requests when a new keystroke fires before the previous response returns (`AbortController`)
- Loading indicator inside the input or dropdown while suggestions are fetching
- "No results" state when the query returns empty
- Existing submit button and `useActionState` flow unchanged

### Out of Scope

- Replacing or removing the submit-based lookup
- Showing order history inside the dropdown (orders load only after selection/submit)
- Suggestion caching or persistence between sessions
- Matching on customer name (phone-only, consistent with the recent `getCustomerByPhone` change)
- Any changes to the orders list, sales workspace, or invoice flows

---

## Implementation Direction

### Current Behavior

- `PhoneSalesSearch` is a `"use client"` component using `useActionState` wired to `lookupDashboardSalesByPhone`.
- Staff type a full (or partial) phone number and click Search or press Enter.
- The server action calls `getCustomerByPhone`, which does a `contains` partial match and returns the top-ranked customer.
- If 2+ customers match the partial number, only the top-ranked one is shown — staff have no way to see the others.

### Desired Behavior

- As staff type, after 3 digits and 300ms of idle, the input fires `GET /api/customers/phone-suggestions?q=<digits>`.
- A dropdown appears below the input listing up to 5 matching customers (name + formatted phone).
- Staff can click or keyboard-navigate to a suggestion.
- Selecting a suggestion fills the input with the customer's phone and immediately triggers the full lookup for that customer by `id`, showing their orders.
- If staff ignore the dropdown and submit normally, the existing flow runs unchanged.
- Escape or a click outside closes the dropdown without selecting.

### API Route

- Path: `GET /api/customers/phone-suggestions`
- Query param: `q` (string, required)
- Auth: same session/auth check as other dashboard API routes in the project
- Logic:
  - Strip non-numeric characters from `q`
  - If fewer than 3 digits remain, return `[]` immediately (defense in depth — client already gates this)
  - Call `buildCustomerPhoneLookupWhere` (or a lightweight equivalent) with the stripped digits
  - Query `db.customer.findMany({ where, select: { id, name, phone }, take: 5, orderBy: { createdAt: 'desc' } })`
  - Return `[{ id, name, phone }]` as JSON
- Do not return orders, invoice data, or any field beyond `id`, `name`, `phone`
- On error, return `[]` — do not surface a 500 to the UI

### Selection Flow

- When a suggestion is selected, do not re-run the fuzzy phone search.
- Instead, fire a separate server action or API call that accepts `customerId` and returns the same `DashboardPhoneLookupState` shape (customer + orders).
- This bypasses the ambiguity of partial matching and always resolves to the exact customer.
- Add a new server action `lookupDashboardSalesByCustomerId(customerId: string)` in `app/(dashboard)/actions.ts` for this path.

### Component Architecture

- Keep `PhoneSalesSearch` as the root client component.
- Extract the suggestion dropdown into a focused sub-component: `PhoneSuggestionDropdown`.
- Use a `useRef` on the container div for outside-click detection (`pointerdown` on `document`).
- Use `useState` for: `suggestions`, `isLoadingSuggestions`, `showDropdown`, `highlightedIndex`.
- Use `useRef` for the debounce timer and the `AbortController`.
- The project has no `cmdk` or dedicated combobox primitive. Use Radix `Popover` (already in the project) as the positioning/anchor primitive for the dropdown, or a simple absolutely-positioned div — both are acceptable given the widget's contained layout. Do not install a new library for this.
- Reuse existing design tokens and component classes (`bg-surface`, `border-border`, `text-text-primary`, etc.) — do not introduce new visual patterns.

### Keyboard Interaction

- `ArrowDown` — move highlight to next suggestion (wraps to first)
- `ArrowUp` — move highlight to previous suggestion (wraps to last)
- `Enter` — select highlighted suggestion (if dropdown is open and an item is highlighted); otherwise submit the form normally
- `Escape` — close dropdown, keep typed value, return focus to input
- `Tab` — close dropdown, move focus normally

### Accessibility

- The input must have `aria-autocomplete="list"`, `aria-controls` pointing to the suggestions list, and `aria-activedescendant` tracking the highlighted item.
- The suggestions list must be `role="listbox"` with each suggestion as `role="option"`.
- Selected state: `aria-selected="true"` on the highlighted option.
- The dropdown must not trap focus — Tab should close it and continue normal tab order.

---

## Files Likely to Change

- `app/api/customers/phone-suggestions/route.ts` — new API route (create)
- `app/(dashboard)/actions.ts` — add `lookupDashboardSalesByCustomerId`
- `src/components/dashboard/phone-sales-search.tsx` — upgrade input to combobox, add dropdown sub-component

---

## Verification Commands

- `npm run lint`
- `npm run build`

---

## Testing Checklist

- Typing fewer than 3 digits shows no dropdown
- Typing 3+ digits fires the suggestion request after ~300ms
- Up to 5 suggestions appear with name and formatted phone
- Typing fast does not fire multiple concurrent requests (only the last debounced one fires)
- Clicking a suggestion fills the input and shows that customer's orders without needing to press Search
- Keyboard: ArrowDown/Up moves highlight, Enter selects, Escape dismisses
- Outside click closes the dropdown
- Selecting a suggestion resolves by customer ID, not by re-running the fuzzy phone search
- Submit button still works as before when dropdown is not used
- Empty result state is shown clearly when no suggestions match
- API route returns `[]` on error — no 500 surfaces in the UI
- `npm run lint` passes
- `npm run build` passes

---

## Post-Implementation

- Update `context/progress-tracker.md`
- Record Feature `57g` as complete once the suggestion dropdown is shipped

---

## Acceptance Criteria

1. Typing 3+ digits in the phone input shows a dropdown of up to 5 matching customers within ~300ms of the last keystroke.
2. The dropdown does not appear for fewer than 3 digits.
3. Suggestions show customer name and formatted phone number.
4. Clicking or keyboard-selecting a suggestion fills the input and immediately shows that customer's orders, without pressing Search.
5. Selection resolves by customer `id` — not by re-running the partial phone search.
6. Keyboard navigation (ArrowDown, ArrowUp, Enter, Escape) works correctly.
7. The dropdown closes on Escape and on outside click.
8. The existing Search button and submit flow remain fully functional when the dropdown is not used.
9. The suggestion API returns only `id`, `name`, `phone` — no orders are fetched until a customer is selected or the form is submitted.
10. In-flight suggestion requests are cancelled when a new keystroke fires.
11. The dropdown meets basic ARIA combobox requirements (`role="listbox"`, `role="option"`, `aria-autocomplete`, `aria-activedescendant`).
12. `npm run lint` passes.
13. `npm run build` passes.
