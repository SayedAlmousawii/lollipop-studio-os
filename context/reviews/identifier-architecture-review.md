# Identifier Architecture Review

_Originally generated: 2026-05-08 | Updated: 2026-05-12 to reflect May 2026 lifecycle architecture revision._

---

## Purpose

This document records the current identifier direction after comparing the implemented schema and active UI behavior against the intended architecture. Updated to reflect the two-reference model (BK + JOB) decided in the lifecycle review.

Sources: `prisma/schema.prisma`, `src/modules/identifiers/identifier.service.ts`, `identifier.constants.ts`, `src/modules/bookings/booking.service.ts`, `src/modules/orders/order.service.ts`, `src/modules/invoices/invoice.service.ts`, `src/modules/payments/payment.service.ts`, active booking/order/invoice UI surfaces, `context/reviews/lifecycle-review.md`, and related feature specs.

---

## Current State (post-Feature-59 schema)

- `Job` remains the canonical operational workflow anchor and owns the immutable `JOB-` reference.
- `Booking.publicId` has been **repurposed** as the `BK-` reference — generated at booking *confirmation*, not at creation. It is no longer a transitional field to be removed.
- `FinancialCase` is the new financial hub, grouping all Invoices and Payments for a customer workflow thread. It owns `bookingId` and nullable `jobOrderId` (stamped at check-in).
- `identifier_sequences` now has a `kind` discriminator to maintain separate counters for BK and JOB sequences.
- `Booking`, `Order`, `Invoice`, and `Payment` all carry nullable `jobId` links. These are nullable while the lifecycle transition (Features 60–63) moves reference creation to the correct lifecycle stages.
- Active booking and order UI surfaces use `jobNumber` / `BK-` reference as the staff-facing operational identifiers depending on lifecycle stage.
- `EditingJob` and `ProductionJob` already exist as extracted workflow entities.
- Structured `OrderAddOn` rows are already the active add-on persistence model.
- `deliveryCompletedById` is already the authoritative delivery-actor reference.

---

## Two-Identifier Model

The system now uses **two separate workflow identifiers** at different lifecycle stages:

| Identifier | Format | Generated At | Purpose |
|---|---|---|---|
| Booking Reference | `BK-DEPT-YEAR-XXXXX` | Booking confirmation | Reservation lookup, receptionist workflow, customer communication before job begins |
| Job Reference | `JOB-DEPT-YEAR-XXXXX` | Check-in (job/order creation) | Canonical operational workflow ID for editing, production, delivery, accounting |

Both use the same `DEPT-YEAR-XXXXX` format. Each has its own counter in `identifier_sequences` via the `kind` discriminator.

### UI grouping rule
- Before check-in: UI groups financial history by `BK-xxxx` only
- After check-in: UI groups by `BK-xxxx` + `JOB-xxxx` together

---

## Pending Booking Rule

Pending bookings consume **no** references. They are calendar holds only. On cancellation they are hard-deleted — no BK or JOB reference is ever consumed.

---

## FinancialCase

`FinancialCase` (no public ID — internal cuid only) is the financial ownership entity:
- Created at booking confirmation alongside the BK reference and Deposit Invoice
- Fields: `id`, `bookingId`, `jobOrderId?` (nullable, stamped at check-in), `customerId`, `createdAt`
- Owns all `Invoice[]` and `Payment[]`
- On confirmed booking cancellation: FinancialCase remains with settled Deposit Invoice and null `jobOrderId` — clean audit trail

---

## Keep Vs Transitional / Changed

| Item | Status | Direction |
|---|---|---|
| `Job.jobNumber` | Canonical operational identifier (JOB ref) | Keep |
| `Job` entity + downstream `jobId` relations | Canonical ownership model | Keep |
| `Invoice.invoiceNumber` | Financial document identifier | Keep |
| `Payment.publicId` | Payment/receipt identifier | Keep |
| `Booking.publicId` | **Now the BK reference** — generated at confirmation | Keep — do NOT remove |
| `FinancialCase` | New financial hub | Core to lifecycle architecture |
| `identifier_sequences.kind` | BK vs JOB sequence discriminator | Keep |
| `Order.publicId` | Transitional compatibility field | Remove later |
| `Invoice.publicId` | Transitional compatibility field | Re-evaluate later |
| `Order.addOns` JSON | Deprecated compatibility field | Remove later |
| `Order.deliveryCompletedBy` | Legacy fallback field | Remove later |
| Downstream propagated `jobNumber` strings | Denormalized convenience fields | Decide later (post-63) |

---

## Summary

Staff now operate on **two workflow identifiers** depending on lifecycle stage:

- `BK-xxxx` — from booking confirmation until check-in (receptionist, customer-facing)
- `JOB-xxxx` — from check-in onward (operations, editing, production, accounting)

The implemented schema (post-Feature-59) already provides the foundation through nullable lifecycle fields, `FinancialCase`, and the `identifier_sequences.kind` discriminator. The flows that generate and stamp these references are being built in Features 60–63.

The main remaining cleanup areas (Order.publicId, legacy compatibility fields, routing that still depends on internal record IDs) should be revisited after Feature 63 when the lifecycle is stable.
