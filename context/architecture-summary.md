# Architecture Summary

## 1. Purpose
System structure, module boundaries, storage model, auth/roles, and invariants for Studio OS.

---

## 2. Key Rules / Principles

**Stack:**

| Layer | Technology |
|---|---|
| Frontend | Next.js + React (TypeScript) |
| Styling | Tailwind CSS |
| Database | PostgreSQL via Prisma |
| Auth | Clerk (`@clerk/nextjs`) |
| File Storage | Synology NAS (manual folder link in V1) |
| Payments | Manual recording in V1 |
| Notifications | Manual/template in V1 |

**Layer flow:** `Staff Browser → Next.js Dashboard → API/Services → PostgreSQL → Optional Integrations`

Database is the single source of truth. Google Calendar, WhatsApp, Synology are integrations — not sources of truth.

---

## 3. Required Patterns / Constraints

**Folder structure:**
```text
src/
├── app/              # Pages/routes
├── components/       # ui/, forms/, tables/, calendar/, layout/
├── modules/          # Business logic per domain
│   ├── customers/
│   ├── bookings/
│   ├── packages/
│   ├── orders/
│   ├── financial-cases/  # FinancialCase grouping entity
│   ├── invoices/
│   ├── payments/
│   ├── editing/
│   ├── production/
│   ├── commissions/
│   └── reports/
├── lib/              # db/, auth/, permissions/, validators/, utils/
├── integrations/     # google-calendar/, payments/, whatsapp/, synology/
└── types/
```

**Module ownership (what each module owns):**

| Module | Owns | Does NOT Own |
|---|---|---|
| Customers | parent profile, phone, children, session history | invoices, job statuses |
| Bookings | date/time, dept, session type, status, photographer, themes; BK reference generated at confirmation | final invoice, package upgrade logic |
| Packages | templates, prices, included items, add-on definitions, upgrade rules | customer-specific orders |
| SessionTypes | admin-managed session taxonomy rows, frozen session-type codes, calendar labels/colors, archive state, default PackageFamily creation, and default SessionTypeExtraPhotoPricing rows (DIGITAL, PRINT, unitPrice=0) via createSessionType | department CRUD, package pricing |
| Pricing | active session-type extra-photo unit prices, collapsed digital/print pricing rows for admin editing, transactional paired updates | invoice snapshotting, package pricing, price history |
| Orders | original package, final package, selected photos, deliverables, add-ons, order state, price snapshots | — |
| FinancialCase | financial grouping hub — owns all Invoices and Payments for a workflow thread; bridges Booking → Job | does not own operational workflow state |
| Invoices/Payments | invoice total, deposit invoice, final invoice, upgrade payment, add-on payment, method, status | — |
| AdjustmentWorkspace | post-lock operational edit staging, package-tier/package-item/add-on/photo-count pending changes, owner/takeover lifecycle, event stream, POS-shaped derived read model for staged UI, pending-change display normalization, pending financial preview derivation | accounting/revenue reporting; payment posting |
| Editing | assigned editor, edit status, revision loop, approval status | — |
| Production | print job, album design, vendor album, pickup status | — |
| Commissions | upgrade tracking, commission calc, commission status, reports | — |

**Session Configurations:** `session_configurations`, `session_configuration_options`, and `order_package_session_configuration_selections` persist session-type-scoped operational or financial modifiers. Definition rows remain soft-deleted with `isActive`, while per-package selection rows snapshot configuration code, label, selected option label, input/pricing mode, financial behavior, and price/link metadata at write time so later admin edits do not mutate historical orders. `LINKED_PRODUCT` selections create a real `OrderAddOn` row and store the link at `OrderPackageSessionConfigurationSelection.orderAddOnId`; the selection service is the only writer of selection-owned add-ons, and the add-on delete path blocks manual deletion while that link exists. Admin CRUD lives in `src/modules/session-configurations/` and `src/components/session-configurations/`; the service module is the only DB-touching layer for definition and option rows.

**Session Configuration Pricing Pipeline:** `src/modules/session-configurations/session-configuration-pricing.ts` is the canonical selection-to-money path and description formatter for snapshotted order-package configuration selections. `createInvoiceForOrderWithClient` uses it for final invoice totals, `buildInvoiceLineItems` uses its invoice-line drafts for locked invoice snapshots, and `getPOSWorkspace` exposes the same `sessionConfigurationTotal` for draft POS totals. `FIXED` and `TIERED` selections produce `SESSION_CONFIGURATION` lines; `LINKED_PRODUCT` selections are skipped by this pricing module and contribute through their materialized `OrderAddOn` rows as normal `ADD_ON` lines.

**Session Configuration Selection Writes:** `src/modules/session-configurations/session-configuration-selection.service.ts` is the sole production writer for `OrderPackageSessionConfigurationSelection`, performing full per-package transactional diffs and refreshing all snapshot columns from live definitions on every insert/update. For linked-product toggles, it creates the `OrderAddOn` before inserting the selection and deletes the selection before deleting the linked add-on, preserving the restrictive FK.

**Session Configuration Post-Lock Routing:** `ConfigureSessionPanel` has explicit draft, locked, and adjustment modes and remains mounted per order-package card/line. Draft mode writes both operational and financial selections directly. Locked mode allows operational direct edits through `writeOrderPackageSelections(..., { allowPostLock: true, postLockAudit })`, writes co-transactional `AuditLog` rows, and sends financial edits to the Adjustment Workspace. Adjustment mode stages both operational and financial `change_session_configuration_selection` edits with optimistic workspace versions; finalization routes per edit, writing operational rows plus `post_lock_workspace` audit logs, `FIXED`/`TIERED` financial rows plus `SESSION_CONFIGURATION` adjustment lines, and `LINKED_PRODUCT` financial rows plus materialized `ADD_ON` adjustment lines linked to the real add-on row.

**Session Configuration Invoice Display:** `src/components/financial/invoice-line-items.tsx` is the canonical grouped invoice-line renderer for customer invoice composition and the Order Details Financials Price Breakdown. It renders non-session-configuration invoice lines first, then groups `SESSION_CONFIGURATION` lines under a "Session Configuration" subheading. `src/components/orders/operational-configurations-block.tsx` is the staff-only order detail block for operational selections; customer invoice surfaces do not render operational selection values.

**Role permissions:**

| Role | Access |
|---|---|
| Admin | Full access to everything |
| Manager | Full view; can edit assignments, overrides, commissions, reports |
| Receptionist | Customers + bookings; cannot do financial overrides or commissions |
| Reservation Employee | Calendar + scheduling; no financial access |
| Photographer | Assigned sessions only; no payments/invoices/commissions |
| Editor | Assigned editing jobs only; no financial data |
| Accountant | Invoices + payments + reports; no editing/production changes |

**Auth rules:**
- Every user must log in
- Every action must check role permissions
- Financial changes must be audit logged
- Commission changes must be audit logged
- Package price overrides must be audit logged

**V1 decisions (do not over-engineer):**
- Payments: manual recording (no gateway)
- Synology: store folder path string in order record
- Calendar: internal system is source of truth
- WhatsApp: manual messages only
- No background jobs required in V1

---

## 4. Core Invariants (never violate)

1. DB is source of truth — not Google Calendar, WhatsApp, or Synology
2. Pending bookings consume no references (no BK, no JOB, no invoice numbers); they are calendar holds only and are hard-deleted on cancellation
3. Booking confirmation is atomic: generates BK reference + creates FinancialCase + issues Deposit Invoice (20 KD, immediately PAID + LOCKED)
4. Session cannot move to editing until the Final Invoice remaining balance is fully paid (`PaymentType.FINAL`) — `BASE` is retired
5. Package upgrade = replace final package (not add a second line)
6. Upgrade charge = final package price − original paid package price
7. Commission created only from package upgrade revenue
8. Every payment, package change, commission change, price override = audit logged
9. Editing / printing / album / pickup are separate sub-statuses (not one flat status)
10. Staff can only update their responsible workflow area (unless manager/admin)
11. Order must not be marked delivered until all required production jobs are complete
12. Manual overrides must store: who changed it, when, and why
13. Package template edits must not retroactively change old invoices/orders
14. Locked final invoices allow post-lock operational session-configuration edits only through `writeOrderPackageSelections(..., { allowPostLock: true, postLockAudit })`, which produces operational diffs plus co-transactional `AuditLog` rows. Adjustment Workspace session-selection changes are staged through `change_session_configuration_selection`; operational edits finalize as row writes plus `post_lock_workspace` audit logs. Standard financial session-selection edits (`FIXED` / `TIERED`) finalize as `SESSION_CONFIGURATION` adjustment invoice lines linked to the real selection row, while `LINKED_PRODUCT` financial edits finalize as `ADD_ON` adjustment invoice lines linked to the real `OrderAddOn` row.
15. `derivePOSWorkspaceFromAdjustmentWorkspace()` is the read-only bridge from staged workspace state to shared POS UI modules: handlers stage edits into `pending_changes_json`, while the unlocked sales page handlers still commit directly.
16. `derivePendingAdjustmentPreview()` is the service-layer source for Adjustment Workspace sidebar preview totals. Base Locked Total is read live from the parent final invoice plus finalized ADJs through settlement math, while pending additions/reductions/net come from `computeWorkspaceProposal()`.
17. `buildPendingChangesView()` is the pure display normalizer for staged edits. It renders business-facing pending change rows from the edit DSL and optional base/proposed/delta context; it is not a financial calculation source.

---

## 5. What to Avoid

- Do not place business logic outside `modules/*/`
- Do not query the DB from UI components or pages
- Do not treat external integrations as sources of truth
- Do not skip the service layer in API routes
- Do not add integrations before V1 workflow is stable

---

## 6. When to Read Full Document

Read `architecture-context.md` when:
- Designing a new module or changing folder structure
- Adding a new role or permission rule
- Evaluating a new integration strategy
- Unsure about which module owns a piece of data

---

## Recommended Usage
**Read when working on data structure, module boundaries, roles/permissions, or integration decisions.**
