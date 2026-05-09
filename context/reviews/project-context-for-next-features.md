# Project Context for Next Features
**Date:** 2026-05-08

This note is a compact discussion brief for future feature specs, build plans, and architecture questions. It summarizes where the software is now, the intended data flow, and the core project shape.

## Current Progress

Studio OS is already past the basic scaffold stage and now has a real workflow backbone:

- `jobNumber` is the staff-facing identifier across the workflow
- canonical `Job` rows own the immutable workflow thread
- `Booking.jobId`, `Order.jobId`, `Invoice.jobId`, and `Payment.jobId` link back to that thread
- deposits come from `Payment` records, not from `Booking.depositPaid`
- editing and production are now owned by dedicated `EditingJob` and `ProductionJob` records
- delivery completion now uses `Order.deliveryCompletedById` as the authoritative actor reference
- order add-ons are stored as structured `OrderAddOn` rows instead of only JSON
- invoice locking now prevents rolling workflow invoices from being reused once locked

In plain terms: the app is no longer just a set of pages. The workflow state is becoming database-backed and traceable.

## Target Data Flow

The intended system flow is:

`Booking -> Job -> Order -> Invoice -> Payment -> Editing -> Production -> Delivery`

The practical rules behind that flow are:

- bookings start the workflow and generate the shared `jobNumber`
- orders are created from bookings, not directly from the Orders page
- invoices belong to the workflow thread and are tied to the job/customer context
- payments are recorded against invoices
- package changes, upgrades, add-ons, and overrides must be auditable
- delivery can only complete after production is actually done

The key product idea is that each stage adds structure to the same job thread instead of creating disconnected records.

## Current Open Threads

These are the main areas that still need careful feature-spec discussion:

- the Customers module is functional at the list level, but create/edit/profile/children/history work is still being broken into smaller unit specs
- invoice adjustment policy is not fully finished yet, especially locked-invoice adjustments, delivery-time locking, refunds, and credit-note behavior
- some identifier fields are still transitional, including legacy public IDs and a few compatibility columns that are no longer the preferred source of truth
- customer-facing or public self-service is still out of scope for V1

## Project Overview

Studio OS is an internal operations system for a photography studio. It replaces a mix of manual tracking tools and covers the studio lifecycle from booking through delivery.

V1 scope is centered on:

- customer management
- booking and scheduling
- packages and package upgrades
- invoices and manual payment recording
- photo selection
- editing workflow
- production tracking
- commissions
- basic reports

Out of scope for V1:

- customer self-service
- online booking
- WhatsApp automation
- Synology integration beyond storing a folder path
- inventory management
- advanced analytics

## Architecture Summary

The project follows a strict layer path:

`UI -> API route / server action -> service layer -> database`

The main structure is:

- `app/` for routes and pages
- `components/` for UI
- `modules/` for domain logic
- `lib/` for shared utilities like db/auth/permissions

Important rule: business logic lives in `modules/*/*.service.ts`, not in pages or UI components.

## What This Means For Future Specs

When we design the next feature, the main questions are usually:

- which module owns the data
- whether it changes workflow state or just presentation
- whether the change needs audit logging or a transaction
- whether it belongs in V1 scope
- whether the source of truth is already in the database or still needs to be made explicit

That is the lens to use when discussing the next build plan.
