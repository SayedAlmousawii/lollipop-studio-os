# Identifier Architecture Review

_Generated: 2026-05-08 | Read-only analysis. No schema or code changes made._

---

## Purpose

This document records the current identifier direction after comparing the implemented schema and active UI behavior against the intended architecture.

Sources: `prisma/schema.prisma`, `src/modules/identifiers/identifier.service.ts`, `identifier.constants.ts`, `src/modules/bookings/booking.service.ts`, `src/modules/orders/order.service.ts`, `src/modules/invoices/invoice.service.ts`, `src/modules/payments/payment.service.ts`, active booking/order/invoice UI surfaces, `context/target-data-model.md`, and related feature specs.

---

## Current State

- `Job` is the canonical workflow anchor and owns the immutable `jobNumber`.
- `Booking`, `Order`, `Invoice`, and `Payment` all carry `jobId` links back to the canonical job thread.
- Active booking and order UI surfaces use `jobNumber` instead of `publicId` as the staff-facing operational identifier.
- `EditingJob` and `ProductionJob` already exist as extracted workflow entities.
- Structured `OrderAddOn` rows are already the active add-on persistence model.
- `deliveryCompletedById` is already the authoritative delivery-actor reference.

---

## Still Transitional

- `Booking.publicId`, `Order.publicId`, and `Invoice.publicId` still exist in schema and are still generated.
- `Order.addOns` JSON still exists as a deprecated compatibility field.
- `Order.deliveryCompletedBy` free text still exists as a legacy fallback.
- Booking and order routes still use cuid URL segments rather than `jobNumber`.
- Propagated `jobNumber` string columns still exist on downstream entities even though `jobId` now exists.

The remaining work is cleanup and simplification, not foundational identifier architecture.

---

## Keep Vs Transitional

| Item | Status | Direction |
|---|---|---|
| `Job.jobNumber` | Canonical operational identifier | Keep |
| `Job` entity + downstream `jobId` relations | Canonical ownership model | Keep |
| `Invoice.invoiceNumber` | Financial document identifier | Keep |
| `Payment.publicId` | Payment/receipt identifier | Keep |
| `Booking.publicId` | Transitional compatibility field | Remove later |
| `Order.publicId` | Transitional compatibility field | Remove later |
| `Invoice.publicId` | Transitional compatibility field | Re-evaluate later |
| `Order.addOns` JSON | Deprecated compatibility field | Remove later |
| `Order.deliveryCompletedBy` | Legacy fallback field | Remove later |
| Downstream propagated `jobNumber` strings | Denormalized convenience fields | Decide later |

---

## Summary

Staff should operate on one workflow identifier: `jobNumber`.

The implemented schema already reflects that direction through canonical `Job` ownership and `jobId`-backed relations. The main remaining cleanup areas are legacy public IDs, old compatibility fields, and routing that still depends on internal record IDs.
