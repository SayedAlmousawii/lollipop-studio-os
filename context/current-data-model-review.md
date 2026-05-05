# Current Data Model Review

## Purpose

This document reviews [current-data-model.md](/Users/bo3li/Desktop/lollipop-studio-os/context/current-data-model.md) against:

- [architecture-context.md](/Users/bo3li/Desktop/lollipop-studio-os/context/architecture-context.md)
- [project-overview.md](/Users/bo3li/Desktop/lollipop-studio-os/context/project-overview.md)

It does not change implementation. It only captures the findings and the gaps that should guide a future schema revision.

---

## Overall Assessment

The current data model is a strong transactional foundation for:

- customers
- bookings
- packages
- orders
- invoices
- payments

It models the financial core better than the high-level docs in some places, especially around invoices and payment stages.

However, it does not yet cover the full V1 operating model described in the architecture and project overview. The main gaps are:

- staff assignment
- theme and department tracking on bookings
- editing workflow
- production workflow
- commissions
- audit logs
- structured add-ons and upgrade records
- storage linkage for Synology/manual file paths

---

## What Matches Well

### 1. Core business backbone matches the product intent

The current model includes the main operational entities needed for the booking-to-payment flow:

- `User`
- `Customer`
- `Child`
- `Package`
- `Booking`
- `Order`
- `Invoice`
- `Payment`

This aligns well with the overview's core flow and major V1 modules.

### 2. Roles align well with the architecture

The `User.role` values are consistent with the architecture's recommended staff roles:

- `ADMIN`
- `MANAGER`
- `RECEPTIONIST`
- `RESERVATION`
- `PHOTOGRAPHER`
- `EDITOR`
- `ACCOUNTANT`

### 3. Order package design is a good fit

Using both `originalPackageId` and `finalPackageId` on `Order` is a strong design choice. It supports the product rule that package upgrades replace the final package instead of adding a second package line.

### 4. Payment staging is well modeled

`Payment.paymentType` already separates:

- `DEPOSIT`
- `BASE`
- `UPGRADE`
- `ADDON`
- `OTHER`

That is a good fit for the multi-stage payment workflow described in the project overview.

---

## What Is Better Than the Higher-Level Docs

### 1. Invoice modeling is more operationally mature

The current model introduces useful financial details that the architecture and overview do not spell out clearly:

- `invoiceNumber`
- `isLocked`
- `parentInvoiceId`
- denormalized `paidAmount`
- denormalized `remainingAmount`

These are practical V1 design decisions and improve financial control.

### 2. Payment lifecycle is clearer than the overview

The current model captures how invoice status moves based on actual recorded payments. That is more concrete and implementation-ready than the high-level project docs.

### 3. The model already identifies some of its own weak points

The observations section in the current data model is good and accurate. It already calls out several real risks that should be addressed in the next revision.

---

## What Needs Adjustment

### 1. The model is too small for the full V1 system

The architecture expects the database to hold more structured business entities than the current model defines. Missing first-class areas include:

- sessions or booking-session detail
- package items
- structured add-ons
- upgrade tracking
- editing jobs
- production jobs
- commissions
- vouchers
- audit logs
- reports metadata

Not all of these need to become complex on day one, but the current model does not yet support the V1 operating workflow described in the docs.

### 2. Booking ownership is thinner than the architecture says it should be

The architecture says the bookings module owns:

- date/time
- department
- session type
- booking status
- assigned photographer
- selected themes
- deposit status

The current `Booking` model only exposes:

- `customerId`
- `packageId`
- `sessionDate`
- `sessionType`
- `status`
- `depositPaid`

That means `department`, photographer assignment, and themes are not modeled yet.

### 3. Staff workflow is under-modeled

The current document explicitly says `User` is not linked to any other entity. That conflicts with the product workflow, which expects assigned photographers and assigned editors.

The data model needs explicit staff assignment relationships, whether directly on `Booking` / `EditingJob` or through assignment tables.

### 4. Order and invoice lifecycle rules need to be reconciled

The current document says:

- order creation happens when a booking moves to `COMPLETED`
- the first deposit flow creates an order if one does not exist

Those are competing lifecycle rules. The target schema and workflow docs should define one authoritative creation path for `Order` and one for `Invoice`.

### 5. `addOns` should not stay as JSON long term

`Order.addOns` is currently documented as JSON. That is acceptable for a short-lived implementation shortcut, but it is weak for:

- validation
- reporting
- price history
- invoice recalculation
- commission logic

For the target V1 model, add-ons should become structured rows.

### 6. The model lacks an explicit storage link field

The architecture says V1 should store a manual Synology folder path or link on the order. The current model does not describe such a field.

### 7. Auditability is not represented structurally

The overview and architecture both require traceability for sensitive actions. The current model does not define an `AuditLog` entity or equivalent structure.

That is a notable gap because audit logging is not optional in the system principles.

---

## What Should Be Fixed

### High priority

1. Add first-class workflow entities for:
   - editing
   - production
   - commissions
   - audit logs
2. Expand `Booking` to support:
   - `department`
   - theme selection
   - assigned photographer
3. Add a Synology/manual storage path field to `Order`
4. Replace `Order.addOns` JSON with structured add-on records
5. Reconcile order creation and invoice creation lifecycle rules

### Medium priority

1. Replace or strictly derive `Booking.depositPaid`
2. Add explicit invoice classification such as:
   - `invoiceType`
   - `isPrimary`
3. Review denormalized `customerId` copies on `Order` and `Invoice`
4. Add upgrade-tracking structure instead of relying only on package FK comparison

---

## Specific Problems in the Current Model

### 1. `Booking.depositPaid` is redundant

The document correctly notes that real deposit truth lives in `Payment` records. Keeping a separate booking boolean creates stale-data risk unless it is fully derived or fully removed.

### 2. Invoice totals can go stale

The review correctly identifies that order updates do not automatically update invoice totals. This is a serious integrity problem if order pricing is expected to remain synchronized with financial records.

### 3. Primary invoice inference is fragile

If the UI infers the "main" invoice from creation order rather than an explicit field, future adjustment flows become fragile.

### 4. Denormalized customer links can drift

Keeping `customerId` on both `Order` and `Invoice` may be acceptable for query performance, but only if the system treats `Booking.customerId` as the canonical source and keeps the copies aligned.

---

## Suggested Direction

The current model should be treated as:

- a good transactional nucleus
- not yet the complete V1 schema

The next step should be a target V1 schema that keeps the strong parts of the current model, while adding the missing workflow entities and clarifying ownership boundaries.

That target is described in [target-data-model.md](/Users/bo3li/Desktop/lollipop-studio-os/context/target-data-model.md).
