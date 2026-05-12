# Invoice Adjustment Workflow

> ⚠️ **PARTIALLY SUPERSEDED — 2026-05-12**
> This document describes the old "one rolling primary invoice per job" model. The lifecycle architecture revision (May 2026) replaces this with a two-invoice split:
> - **Deposit Invoice** (`InvoiceType.DEPOSIT`) — created at booking confirmation, immediately PAID + LOCKED. Never evolves.
> - **Final Invoice** (`InvoiceType.FINAL`) — created at POS/selection finalization. Subject to recalculation until delivery/close.
>
> The adjustment invoice mechanics described below (locked invoice → create adjustment) remain valid and apply to the Final Invoice after it is locked.
> The `normalizePrimaryWorkflowInvoice` pattern and the "recalculate same invoice from deposit onwards" flow described here are retired.
> See `context/reviews/lifecycle-review.md` and Feature specs 59–63 for the current architecture.

## Purpose

This document defines how Studio OS should handle:
- invoice creation
- recalculation
- locked invoices
- adjustment invoices
- refunds
- post-delivery changes

## Core Rules

- Orders are created from completed bookings.
- An invoice may be recalculated only if it is not locked.
- Locked or closed invoices must never be edited directly.
- Changes after delivery create adjustment invoices only.
- Payments are never deleted when totals change.
- Refunds must be recorded as refund transactions.

## Workflow Diagram

```mermaid
flowchart TD
  A[Order exists from completed booking] --> B[Customer selection / staff review]
  B --> C{Order needs changes?}

  C -->|No changes| D{Invoice exists?}
  D -->|No| E[Create invoice from current order total]
  D -->|Yes| F[Keep existing invoice]

  C -->|Package upgrade| G[Update order final package]
  C -->|Extra photos/add-ons| H[Add order line items]
  C -->|Album / prints added| I[Add production/deliverable line items]
  C -->|Discount / manual override| J[Manager adjusts order total + reason]

  G --> K{Invoice exists?}
  H --> K
  I --> K
  J --> K

  K -->|No invoice yet| E
  K -->|Invoice is DRAFT / ISSUED / PARTIAL / PAID and not locked| L[Recalculate same invoice total]
  K -->|Invoice is CLOSED / locked| M[Create adjustment invoice]

  L --> N[Recalculate paid amount]
  N --> O{Paid amount vs new total}
  O -->|Paid = 0| P[Status: ISSUED]
  O -->|Paid < total| Q[Status: PARTIAL]
  O -->|Paid >= total| R[Status: PAID]

  M --> S[Adjustment invoice linked to parent invoice]
  S --> T{Adjustment type}
  T -->|Customer owes more| U[Positive adjustment invoice]
  T -->|Credit/refund needed| V[Negative adjustment / credit note]

  U --> W[Customer pays adjustment]
  W --> X[Adjustment invoice status updates: PARTIAL / PAID]

  V --> Y{Refund or store credit?}
  Y -->|Refund| Z[Record refund payment / refund transaction]
  Y -->|Store credit| AA[Create customer credit balance]

  E --> AB[Invoice status: ISSUED]
  F --> AC[Continue normal order workflow]

  P --> AD[Order continues]
  Q --> AD
  R --> AD
  X --> AD
  Z --> AD
  AA --> AD
  AB --> AD
  AC --> AD

  AD --> AE{Order delivered?}
  AE -->|No| B
  AE -->|Yes| AF[Close / lock order and invoice records]

  AF --> AG{Customer requests changes after delivery?}
  AG -->|No| AH[No action]
  AG -->|Yes: new add-on / album / extra prints| AI[Create adjustment invoice only]
  AI --> AJ[Do not edit original locked invoice]
  ```