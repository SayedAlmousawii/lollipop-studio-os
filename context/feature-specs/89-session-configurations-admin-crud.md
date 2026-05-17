# 89 — Session Configurations: Admin CRUD Page

## Goal

Build the standalone admin page at `/session-configurations` so studio managers can create, edit, archive, and reactivate session configurations (definition rows + their child options). This is the **first code surface** that reads or writes the tables introduced in spec 88.

Establish the centralized module structure (`src/modules/session-configurations/`, `src/components/session-configurations/`) that specs 90–93 will extend. No selection-side logic ships in this spec — admin only manages definitions; selections happen in spec 91.

## Read First

- `context/feature-specs/88-session-configurations-data-model.md` — schema this CRUD reads/writes.
- `context/reviews/session-config-plan.md` — admin UX intent (separate page, not merged into packages/products).
- [app/session-types/page.tsx](app/session-types/page.tsx) — closest comparable admin page; mirror its layout, header buttons, archived-toggle pattern.
- [app/session-types/actions.ts](app/session-types/actions.ts) — server-action shape and error-routing pattern to copy.
- [src/modules/session-types/session-type.service.ts](src/modules/session-types/session-type.service.ts) — service module conventions (custom error classes, `withRetry`, `db.$transaction`).
- [src/modules/session-types/session-type.schema.ts](src/modules/session-types/session-type.schema.ts) — Zod schema conventions.
- [src/modules/session-types/session-type-code.ts](src/modules/session-types/session-type-code.ts) — code-generation pattern to reuse for `SessionConfiguration.code`.
- [src/components/session-types/session-type-form.tsx](src/components/session-types/session-type-form.tsx) — form component layout reference.
- [src/components/session-types/session-type-table.tsx](src/components/session-types/session-type-table.tsx) — admin table reference (archive button column, status badge).
- [prisma/schema.prisma](prisma/schema.prisma) — `SessionConfiguration`, `SessionConfigurationOption` models added in spec 88.

## Rules

- **Centralized module structure is non-negotiable.** All session-configuration domain code lives under two roots:
  - `src/modules/session-configurations/` — services, schemas, types, helpers. No business logic outside this folder.
  - `src/components/session-configurations/` — shared UI components. The admin page and (future) the employee Configure Session panel both consume the same component primitives.
  - Pages and server actions are thin wrappers that delegate. A server action containing Prisma calls or pricing logic is a review-blocker; route it through the service.
- **Reuse the `session-types` page as the visual template.** Same `PageContainer`, same header layout (title + description + archived-toggle + create button), same status-badge styling, same table-row archive/unarchive pattern. Studio managers should feel they're using the same admin family.
- **Permissions:** reuse `PERMISSIONS.PACKAGE_CATALOG_MANAGE`. Do **not** introduce a new permission constant in this spec.
- **`SessionConfiguration.code` is system-generated**, not user-input. Compute it from `(sessionType.code, name)` via a new `generateSessionConfigurationCode` helper (mirror `generateSessionTypeCode`). On update, the code is **frozen** — even if the name changes, the code does not, to preserve the snapshot-by-code contract from spec 88.
- **No hard deletes** anywhere in this spec. `isActive=false` is the only "delete" path. The same applies to `SessionConfigurationOption` — deactivate, never destroy. Reason: snapshot rows on orders carry `optionId` FKs; hard-delete would break referential integrity (and spec 88's `Restrict` cascade would refuse it anyway).
- **Conditional fields validated in the schema, not in the UI.** Zod refinements enforce: `pricingMode = FIXED` ⇒ `fixedPriceDelta` required; `pricingMode = LINKED_PRODUCT` ⇒ `linkedProductId` + `linkProductDisplay` required; `inputType = COUNTER` + `pricingMode ≠ NONE` ⇒ `counterPricingMode` required, and `PER_UNIT` ⇒ `counterUnitPrice` required; `inputType = SELECT` ⇒ at least one active option; `pricingMode = TIERED` ⇒ `inputType` must be `SELECT` or `COUNTER` (the only two that produce discrete tier slots). The UI may also hide irrelevant fields, but server-side validation is the contract.
- **Options are managed inline with the parent.** A single create/update server action receives both the configuration fields and the full options list, and writes them atomically inside one `db.$transaction`. There is no separate "edit option" action.
- **No selection-side code in this spec.** Do not write the selection service, the pricing helper, the resolver, the Configure Session panel, or anything that touches `order_package_session_configuration_selections`. Those are specs 90–92. A grep for `OrderPackageSessionConfigurationSelection` outside `prisma/schema.prisma` after this spec must still return zero hits.
- **No order-page or invoice changes.** This spec adds a standalone admin route only.

## Scope

### In Scope

#### Module: `src/modules/session-configurations/`

- `session-configuration.service.ts`:
  - `listSessionConfigurations({ includeArchived?: boolean })` → joined view: configuration + sessionType (id, code, name) + linkedProduct (id, name) + active option count + first ~3 option labels for table preview.
  - `getSessionConfigurationDetail(id)` → full configuration with all options (active + archived) for the edit dialog.
  - `createSessionConfiguration(input, actor?)` → validates input, generates `code`, inserts configuration + options in one transaction.
  - `updateSessionConfiguration(id, input, actor?)` → updates configuration fields (excluding `code`); for options, performs an inline diff: insert new rows, update existing rows by `id`, mark removed rows `isActive=false` (never delete). Single transaction.
  - `archiveSessionConfiguration(id)` → `isActive=false` on the parent. Does not touch child options.
  - `unarchiveSessionConfiguration(id)` → `isActive=true` on the parent.
  - Custom error classes mirroring the session-type pattern: `SessionConfigurationNotFoundError`, `SessionConfigurationCodeConflictError`, `SessionConfigurationSessionTypeNotFoundError`, `SessionConfigurationLinkedProductNotFoundError`, `SessionConfigurationValidationError` (for cross-field invariants Zod cannot express cleanly — e.g. tiered + non-SELECT/COUNTER).
- `session-configuration.schema.ts` — Zod schemas:
  - `sessionConfigurationOptionInputSchema` — `{ id?: string, label, value, priceDelta, sortOrder, isActive }`. `id` present = update existing; absent = new row.
  - `createSessionConfigurationSchema` — full payload including `options: optionInputSchema[]`. Includes a top-level `.superRefine` enforcing the cross-field rules listed in Rules above.
  - `updateSessionConfigurationSchema` — same as create minus `sessionTypeId` (immutable post-create — see decision note) and `code` (always frozen).
- `session-configuration-code.ts`:
  - `generateSessionConfigurationCode(sessionTypeCode, name): string` — `${sessionTypeCode}__${SLUG}` (double-underscore separator so the boundary stays visible). Same character sanitisation as `generateSessionTypeCode`.
- `session-configuration.types.ts`:
  - `SessionConfigurationRow` — flat shape for the table.
  - `SessionConfigurationDetail` — nested shape for the edit dialog.
  - `SessionConfigurationOptionRow` — child shape.

#### Server actions: `app/session-configurations/actions.ts`

- `createSessionConfigurationAction(prev, formData)` → parses FormData, calls service, revalidates `/session-configurations`. Returns `{ errors?, values?, success? }` matching the session-types action shape.
- `updateSessionConfigurationAction(id, prev, formData)` → same shape, scoped to a configuration.
- `archiveSessionConfigurationAction(id, prev, formData)` and `unarchiveSessionConfigurationAction(id, prev, formData)`.

FormData encoding for options: serialize the array as a single JSON string under `options`, parse with `JSON.parse` then validate. Mirrors how existing complex admin forms in this repo handle nested arrays — keep this consistent. If no existing complex form uses this pattern, hidden inputs per option are an acceptable fallback; do not invent a third pattern.

#### Page: `app/session-configurations/page.tsx`

- RSC. Calls `requireCurrentAppUserPermission(PERMISSIONS.PACKAGE_CATALOG_MANAGE)`.
- Reads `searchParams.includeArchived === "1"`.
- `Promise.all`: `listSessionConfigurations({ includeArchived })`, `listSessionTypes({ includeArchived: false })` (for the create dialog dropdown — only active session types are pickable), `listActiveProducts()` (for the linked-product dropdown — reuse the existing product list loader if available; otherwise add a thin `listActiveProducts` helper to `src/modules/products/` in this spec).
- Layout: identical to `/session-types` — title "Session Configurations", subtitle "Manage operational and pricing modifiers shown during session setup.", archived-toggle button, "New Configuration" primary button opening `SessionConfigurationCreateDialog`.
- Renders `SessionConfigurationTable`.

#### Page: `app/session-configurations/layout.tsx`

- Minimal wrapper matching `app/session-types/layout.tsx` (likely just `{children}`). Add only if existing admin pages have one.

#### Components: `src/components/session-configurations/`

- `session-configuration-table.tsx` — columns: Name, Code (mono), Session Type, Input Type, Pricing Mode, Financial Behavior, Required (icon), Linked Product (or "—"), Status, Actions. Edit and Archive/Unarchive actions per row.
- `session-configuration-status-badge.tsx` — Active / Archived pill (copy `session-type-status-badge.tsx` styling).
- `session-configuration-create-dialog.tsx` — wraps `SessionConfigurationForm` in a Dialog, wired to `createSessionConfigurationAction`.
- `session-configuration-edit-dialog.tsx` — same, loads detail from the row prop (no extra fetch — pass full detail down from the table; if the table only carries the row preview, fetch detail lazily on dialog open via a server action `getSessionConfigurationDetailAction`).
- `session-configuration-form.tsx` — the conditional form. Top-level fields: name, sessionTypeId (create only; read-only on edit), inputType (radio group), pricingMode (radio group), financialBehavior (radio group: Operational / Financial), required (checkbox), sortOrder (number). Then conditional sub-blocks driven by current pricingMode + inputType selections:
  - `pricingMode = FIXED` → `fixedPriceDelta` numeric (KD, 3 decimals).
  - `pricingMode = LINKED_PRODUCT` → `linkedProductId` (dropdown), `linkProductDisplay` (radio: Line Item / Modifier Only).
  - `pricingMode = TIERED` → renders the options editor; option rows carry `priceDelta`.
  - `inputType = SELECT` → renders the options editor (no `priceDelta` column when `pricingMode = NONE`).
  - `inputType = COUNTER` and `pricingMode ≠ NONE` → `counterPricingMode` (radio: Per Unit / Tiered). If `PER_UNIT`, show `counterUnitPrice`. If `TIERED`, render the options editor with option rows representing tier breakpoints.
- `session-configuration-options-editor.tsx` — add/remove/reorder option rows. Each row: label, value, priceDelta (when applicable), sortOrder, isActive (an "Archive" toggle that flips the option to `isActive=false` on save — never deletes existing rows; new unsaved rows can simply be removed from the array).
- `session-configuration-archive-button.tsx` — copy session-type pattern.
- `session-configuration-preview.tsx` — small read-only preview block at the bottom of the form rendering what the employee will see in the Configure Session panel (label + input control disabled). Reuses the **shared input renderer** (see next bullet). This validates the centralization principle: admin preview and employee panel render through the same component.
- `session-configuration-input-renderer.tsx` — **shared** renderer keyed by `inputType`. Renders the appropriate read-only or disabled control (Toggle / Select / Number input / Text input / Counter). Spec 91 will extend this with a `mode: "edit"` prop and selection-state wiring. In spec 89, the only consumer is `session-configuration-preview.tsx` rendering in disabled/preview mode. Place it in `src/components/session-configurations/` not in the admin folder — it is shared infrastructure.

#### Tests

- Service-level:
  - Create configuration with `pricingMode = FIXED` → row persisted, `code` generated correctly, no options created.
  - Create with `inputType = SELECT` + options → configuration + N options persisted in one transaction.
  - Create with mismatched config (e.g. `pricingMode = TIERED` + `inputType = TEXT`) → throws `SessionConfigurationValidationError`; nothing persisted.
  - Update changes name + adds one option + removes one existing option → name updated, code unchanged, new option inserted, removed option flipped to `isActive=false` (not deleted, asserted by direct DB query).
  - Archive flips `isActive=false`; unarchive flips back. Options unaffected.
  - Duplicate `code` (forced by re-using same sessionType + name) → throws `SessionConfigurationCodeConflictError`.
- Schema-level:
  - Each cross-field invariant has a Zod test (FIXED without fixedPriceDelta; LINKED_PRODUCT without linkedProductId or linkProductDisplay; COUNTER PER_UNIT without counterUnitPrice; SELECT without options; TIERED with inputType = TEXT).
- Page-level:
  - The `/session-configurations` page renders the table with a seeded fixture (2 active, 1 archived) and the archived row is hidden when `includeArchived` is unset.
  - The create dialog form submission round-trips through the action and ends with the row appearing in the table.

### Out of Scope

- Selection-side anything: `OrderPackageSessionConfigurationSelection` reads/writes, pricing math, resolver, Configure Session panel, summary chip. Specs 90–92.
- Invoice / receipt display of selections. Spec 93.
- Order-page edits.
- Reordering configurations via drag-and-drop. `sortOrder` is editable as a number field; nicer UX can come later.
- Bulk import / export of configurations.
- A dedicated `SESSION_CONFIGURATIONS_MANAGE` permission — reuse `PACKAGE_CATALOG_MANAGE` for now; a split can come later if RBAC requires it.
- Mobile / responsive redesign beyond what the existing table primitives already give us.
- Audit-logging admin CRUD events (no `AuditLog` writes in this spec; configuration CRUD is admin-scoped and not subject to the post-lock financial-behavior contract from spec 92).
- Allowing `sessionTypeId` to change after create. It is set on create and immutable thereafter; if a manager needs to re-target a configuration, they archive and recreate. Reason: changing session type retroactively would silently re-scope existing selections — a hazard not worth the convenience.

## Implementation Direction

### 1. Module first, page second

Build in this order to keep the page thin:

1. `src/modules/session-configurations/` — types, schema, code generator, service. Service is the only place that imports `db` for these tables.
2. Server actions in `app/session-configurations/actions.ts` — thin wrappers over the service, handling FormData parsing and `revalidatePath`.
3. Shared components (`session-configuration-input-renderer.tsx`, `session-configuration-options-editor.tsx`, `session-configuration-form.tsx`) before the dialogs/table.
4. Dialogs + table.
5. Page composition.

### 2. Code generation and conflict handling

`generateSessionConfigurationCode(sessionTypeCode, name)` returns `${sessionTypeCode}__${slug(name)}`. The configuration's `@unique` constraint on `code` is the single source of truth — collisions surface as a Prisma `P2002` and the service catches it and throws `SessionConfigurationCodeConflictError` (mirror `SessionTypeNameConflictError` handling).

### 3. Options diff on update

The update path receives `options: OptionInput[]`. Inside one `db.$transaction`:
1. Load existing options for the configuration.
2. For each input row with an `id`: update fields.
3. For each input row without an `id`: insert.
4. For each existing option whose `id` is not in the input set: `update { isActive: false }`. Do not call `delete`.

This is the only way snapshot rows referencing the option `id` remain valid forever.

### 4. Linked-product dropdown

Add `listActiveProducts()` to `src/modules/products/` if not already present. Returns `{ id, name }[]`, ordered by name. The form dropdown shows only active products. Inactive products that are already linked on an existing configuration are still rendered (read-only label) in the edit dialog — the service's detail loader joins the linked product even if archived, so the dialog can display its name; the dropdown options list itself excludes archived products from being newly picked.

### 5. Preview block and shared renderer

`session-configuration-input-renderer.tsx` is the centralization gate. Its props in spec 89:

```ts
type Props = {
  inputType: SessionConfigurationInputType;
  options?: { label: string; value: string }[];
  mode: "preview"; // spec 91 adds "edit" + selection-state props
};
```

Render the appropriate disabled control. Keep the API minimal — spec 91 will extend.

### 6. Status badge and table actions

Mirror `session-type-table.tsx` exactly: status badge column, archive button on active rows, unarchive button on archived rows, edit dialog launches from a per-row "Edit" affordance. Do not invent new affordances.

### 7. Revalidation paths

`createSessionConfigurationAction` / `updateSessionConfigurationAction` / archive / unarchive all call:
- `revalidatePath("/session-configurations")`

Do **not** revalidate order or invoice paths in this spec — there is no consumer of these tables outside this admin page yet. Specs 91+ will add the relevant revalidations as they introduce consumers.

## Observability Checklist

### Dashboards / Metrics

- Counter: `admin.session_configurations.created` — increments on successful create.
- Counter: `admin.session_configurations.updated` — increments on successful update.
- Counter: `admin.session_configurations.archived` / `.unarchived`.
- Discrepancy log: if a service mutation completes but a downstream `revalidatePath` throws, log with the configuration id. (Optional — only add if existing admin services do this; otherwise skip.)

### Rollback Plan

- Code-only change. Revert the spec-89 commits to restore the prior state. The schema from spec 88 stays in place (tables remain empty unless this spec was used in prod).
- No flag. No data migration.
- Non-recoverable data: any configurations created via the admin page before rollback persist as orphaned rows. Either delete manually post-rollback, or leave (they remain dormant until spec 89 is reintroduced).

### Customer-Visible Surface

- Staff with `PACKAGE_CATALOG_MANAGE` see a new nav entry / route at `/session-configurations`. (If the side nav requires a manual addition, do it in this spec — match the session-types nav entry style.)
- Customers: no change.

## Post-Implementation

- Update `context/architecture-summary.md` to point at `src/modules/session-configurations/` and `src/components/session-configurations/` as the centralized owners of this domain, and call out that the service module is the only DB-touching layer.
- Update `context/progress-tracker.md`.
- If a side-nav entry was added, note it in the progress tracker so reviewers see the surface change.

## Acceptance Criteria

- `/session-configurations` is reachable by users with `PACKAGE_CATALOG_MANAGE` and 403s otherwise (mirroring `/session-types`).
- Creating a configuration with each of the five input types succeeds and produces correctly-shaped rows in the database (asserted by tests).
- Creating a configuration with `inputType = SELECT` and three options writes the parent + three children in a single transaction; truncating the test DB and re-running the action reproduces the same outcome deterministically.
- Updating a configuration's name does not change its `code`. Asserted by a test that creates → updates name → reads back and compares `code` equality.
- Updating a configuration's options to remove one and add one results in: removed option still present in the database with `isActive=false`, new option inserted, and `id`s of unchanged options preserved.
- Archiving a configuration flips `isActive=false` without touching child options. Unarchiving reverses the parent only.
- All cross-field invariants throw `SessionConfigurationValidationError` (or the appropriate specific error class) and persist nothing. Each is covered by a schema-level test.
- The admin table renders the archived-toggle behavior identically to `/session-types`: archived rows hidden by default, shown when `?includeArchived=1`.
- The `session-configuration-input-renderer.tsx` component lives in `src/components/session-configurations/` (not in an admin-only folder) and is consumed by `session-configuration-preview.tsx` in this spec.
- A grep for `db.sessionConfiguration` or `db.sessionConfigurationOption` or `db.orderPackageSessionConfigurationSelection` across `app/` returns **zero** hits — Prisma access lives entirely inside `src/modules/session-configurations/`.
- A grep for `OrderPackageSessionConfigurationSelection` across `src/` and `app/` returns **zero** hits — no selection-side code was added in this spec.
- `npm run build` passes.
- `npm run lint` passes.
