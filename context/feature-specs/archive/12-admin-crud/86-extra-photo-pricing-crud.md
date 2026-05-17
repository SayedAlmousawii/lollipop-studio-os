# 86 — Extra Photo Pricing CRUD

## Goal

Let managers and admins edit extra-photo unit prices (digital and print, per session type) from the admin UI, replacing the current "Extra-photo prices are seeded. Contact engineering to update." surface. One edit form per session type sets both `DIGITAL` and `PRINT` prices together — that pair is the operator's mental unit, not two independent rows. Prerequisite spec 85 (Session Type Admin CRUD) auto-creates the underlying `SessionTypeExtraPhotoPricing` rows when a session type is created, so this unit only edits existing rows.

## Read First

- [prisma/schema.prisma:421-434](prisma/schema.prisma#L421-L434) — `SessionTypeExtraPhotoPricing` model. Unique on `(sessionTypeId, mediaType)`, `unitPrice Decimal(10, 3)`.
- [app/pricing/page.tsx](app/pricing/page.tsx) — current read-only pricing page, already permission-gated by `PACKAGE_CATALOG_MANAGE`. This unit makes it interactive.
- [src/components/pricing/extra-photo-pricing-table.tsx](src/components/pricing/extra-photo-pricing-table.tsx) — current read-only table grouped by department + session type. Becomes editable.
- [src/modules/invoices/invoice.service.ts:43](src/modules/invoices/invoice.service.ts#L43) — invoice consumer (`getExtraPhotoUnitPriceWithClient`). Live-read pattern; do not break it.
- [src/modules/financial/reconciliation-invariants.ts:217-222](src/modules/financial/reconciliation-invariants.ts#L217-L222) — reconciliation join. Must continue to find a row for every `(sessionTypeId, mediaType)` pair.
- [src/components/products/product-form.tsx](src/components/products/product-form.tsx) — form pattern to mirror (server action + `useActionState` + dialog).
- `context/feature-specs/85-session-type-admin-crud.md` — prerequisite. Adds zero-priced rows on session-type creation; this unit assumes those rows exist.

## Rules

- **No price snapshotting in this unit.** Invoice math continues to read the current `unitPrice` at invoice-line-creation time. Snapshot-at-order-time is explicitly deferred to a future spec. The admin form copy must make this clear: "Changes apply to invoices generated after this point."
- **No add/remove of pricing rows from this UI.** Rows are created automatically when a session type is created (per spec 85) and live as long as the session type. Archiving a session type leaves its pricing rows in place; they simply stop being editable (or surfaced) because the parent is archived.
- **Both prices submit together.** A single transaction updates the `DIGITAL` and `PRINT` row for a given session type. Partial updates are not allowed via this form.
- **Decimal validation.** `unitPrice` is `Decimal(10, 3)`. Inputs are non-negative, max 3 decimal places. Zero is allowed (e.g., a session type that doesn't sell prints can keep print price at 0; the business surfacing layer can decide whether to offer it).
- Mutations gated by `PACKAGE_CATALOG_MANAGE` (already gates the page).

## Scope

### In Scope

- **Service layer** — extend (or create) `src/modules/pricing/extra-photo-pricing.service.ts`:
  - `listExtraPhotoPricing()` — returns rows joined with `SessionType` and `StudioDepartment`, filtered to `sessionType.active = true`, ordered by department then session-type name. Each entry shapes as `{ sessionTypeId, sessionTypeName, departmentName, digitalUnitPrice, printUnitPrice }` — the pair is collapsed for the UI.
  - `updateExtraPhotoPricing(sessionTypeId, { digitalUnitPrice, printUnitPrice }, actor)` — updates both rows in a single transaction. Validates non-negative and 3-decimal-place constraints. Throws if either underlying row is missing (shouldn't happen post-85; if it does, it's an integrity bug worth surfacing).
  - Gated by `requireCurrentAppUserPermission(PERMISSIONS.PACKAGE_CATALOG_MANAGE)`.
  - Preserve the existing `getExtraPhotoUnitPriceWithClient` helper untouched — invoice service depends on it.

- **Server action** in `app/pricing/actions.ts` wrapping `updateExtraPhotoPricing` for `useActionState`.

- **Page update** at [app/pricing/page.tsx](app/pricing/page.tsx):
  - Remove the "Extra-photo prices are seeded. Contact engineering to update." message.
  - Add a short banner: "Changes apply to invoices generated after this point. Orders already invoiced are not retroactively adjusted."
  - Keep the existing permission gate.

- **Component update** at [src/components/pricing/extra-photo-pricing-table.tsx](src/components/pricing/extra-photo-pricing-table.tsx):
  - Collapse the existing two-row-per-session-type display (one for DIGITAL, one for PRINT) into **one row per session type** with two price columns: "Digital unit price" and "Print unit price".
  - Per-row "Edit" action opens a dialog rendering both prices in one form.

- **New component** `src/components/pricing/extra-photo-pricing-form.tsx`:
  - Dialog form with read-only session-type + department display (identifying context, not editable) and two numeric inputs: `digitalUnitPrice`, `printUnitPrice`.
  - Mirrors the product-form pattern. Submit → server action → revalidate → close dialog.

- **Tests**:
  - Unit: service rejects negative prices, rejects > 3 decimal places, accepts zero, accepts boundary values like `9999999.999`.
  - Unit: update is transactional — if one row update fails, the other rolls back.
  - Integration: user with `PACKAGE_CATALOG_MANAGE` can edit; user without it 403s on the action.
  - Integration: archived session types (`active = false`) do not appear in the pricing table.
  - Regression: after a price update, a subsequently-generated invoice line uses the new price; an invoice generated before the update remains unchanged (this is the documented behavior — confirming, not fixing).

### Out of Scope

- Snapshot-at-order-time pricing. Deferred. Add to follow-up backlog.
- Adding or removing pricing rows from this UI (handled by spec 85 at session-type create time).
- Bulk edit / CSV import / export.
- Price history / audit log beyond what `requireCurrentAppUserPermission` already records.
- Per-customer or per-package pricing overrides.
- Currency switching — `Decimal(10, 3)` stays in KD as today.
- Tiered pricing (no business rule; current flat unit-price model stays).
- Surfacing pricing for archived session types (intentionally hidden).

## Implementation Direction

### 1. Collapsed row shape

The service flattens the two-row-per-session-type DB shape into one row per session type for display:

```ts
type ExtraPhotoPricingRow = {
  sessionTypeId: string;
  sessionTypeName: string;
  departmentName: string;
  digitalUnitPrice: Decimal;
  printUnitPrice: Decimal;
};
```

Implement as a single Prisma query joining `SessionType` → `SessionTypeExtraPhotoPricing` and pivoting in TypeScript (or two queries if cleaner). Either way, the component never sees the two-row DB shape.

### 2. Transactional update

`updateExtraPhotoPricing` runs both `prisma.sessionTypeExtraPhotoPricing.update` calls inside `prisma.$transaction`. Both target the same `sessionTypeId` with different `mediaType` values. If either row is missing (integrity bug), throw a typed error before issuing updates.

### 3. Banner copy

Place the "Changes apply to invoices generated after this point..." banner above the table. This is a deliberate operator-facing acknowledgment that the system does not snapshot — managers should not change prices to "fix" already-invoiced orders.

### 4. Implementation order

1. Service module + unit tests.
2. Server action.
3. Form component.
4. Table refactor (collapse two-rows-per-session-type to one + add Edit action).
5. Page banner + remove "contact engineering" copy.
6. Tests + regression run against the invoice service (no behavior change expected).

## Observability Checklist

### Dashboards / Metrics

- Counter: `extra_photo_pricing.update` — tagged with actor role, session type, and delta direction (`increase` / `decrease` / `noop`).
- Counter: `extra_photo_pricing.update.invalid_input` — validation failures. High values indicate UX confusion (decimal precision, negatives).
- Gauge: count of session types at `unitPrice = 0` for digital or print — should trend down as managers configure newly-created types (per 85's auto-creation at zero).

### Rollback Plan

- Code-only change. No schema migration. Revert this unit's commits to restore the read-only page.
- Existing pricing rows and their `unitPrice` values persist regardless. On rollback, prices set via the new UI remain in the database and continue to be used by the invoice service.

### Customer-Visible Surface

- Staff (ADMIN/MANAGER): pricing page becomes interactive — Edit action per session type, dialog with digital + print inputs, banner explaining non-retroactive behavior.
- Staff (other roles): unchanged (page already 403s for them).
- Customers: no direct change. Future orders use updated prices; existing invoices are not retroactively adjusted.

## Post-Implementation

- Update `context/architecture-summary.md` with the pricing service module.
- Update `context/ui-context-summary.md` to note the pricing page is now editable.
- Update `context/progress-tracker.md`.
- Add a follow-up backlog item for snapshot-at-order-time pricing if/when business decides historical orders need protection from price changes.

## Acceptance Criteria

- A user with `PACKAGE_CATALOG_MANAGE` can edit both digital and print extra-photo prices for any active session type via a single form, and the change is reflected on the next invoice generated.
- A user without `PACKAGE_CATALOG_MANAGE` receives a 403 on the update action.
- The pricing table shows one row per active session type with two price columns; archived session types do not appear.
- Submitting a negative price, a price with more than 3 decimal places, or a non-numeric value is rejected with a clear inline error and no DB change occurs.
- Submitting valid prices updates both `DIGITAL` and `PRINT` rows atomically — partial failure leaves both unchanged.
- The "Contact engineering to update" message no longer appears anywhere in the app; grep confirms.
- The non-retroactive banner is visible on the pricing page.
- Invoice service behavior is unchanged: existing invoices retain their original line totals; new invoices use the current price.
- `npm run build` passes.
- `npm run lint` passes.
