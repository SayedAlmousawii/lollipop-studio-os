# Development Utilities Tracker

This document tracks development-only UI controls and server utilities that exist to speed local testing. Review and remove or hard-disable these before shipping beyond local development.

## Removal Rule

- Anything listed here must stay gated behind `process.env.NODE_ENV === "development"` in the UI.
- Server-side functions must also reject non-development execution.
- Before production shipping, remove the UI entry points and confirm the underlying server actions/services are unreachable or deleted.

## Current Utilities

### Main Workflow Reset

- **Purpose:** Reset workflow test data after local testing.
- **UI entry point:** `src/components/layout/topbar.tsx` renders `DevResetWorkflowButton` in the app topbar.
- **Button component:** `src/components/layout/dev-reset-workflow-button.tsx`
- **Server action:** `resetWorkflowAction` in `app/dev/actions.ts`
- **Service function:** `resetWorkflowTestData` in `src/modules/development/dev-reset.service.ts`
- **Visible in:** Every authenticated app page using the shared topbar, development only.
- **Confirmation text:** `Reset bookings, orders, invoices, payments, and workflow sequences?`
- **Data affected:** Adjustment workspaces/events, document applications, payment allocations, payments, invoice snapshots/lines/invoices, order package session-configuration selections, order package item upgrades, order add-ons, order activities, production jobs, editing jobs, order packages, orders, financial cases, booking themes, booking packages, bookings, jobs, and identifier sequences.
- **Sequences reset:** `booking_public_id_seq`, `order_public_id_seq`, `invoice_public_id_seq`, `payment_public_id_seq`, `invoice_number_seq`.
- **Cache revalidated:** `/bookings`, `/orders`, `/invoices`, `/calendar`
- **Server guard:** Throws unless `NODE_ENV === "development"`.
- **Removal before shipping:** Remove topbar render/import first, then delete `DevResetWorkflowButton`, `resetWorkflowAction` if unused, and `dev-reset.service.ts` if no other dev tooling needs it.

### Session Configuration Reset

- **Purpose:** Reset session-configuration test data without touching the rest of workflow data.
- **UI entry point:** `app/session-configurations/page.tsx` renders `DevResetSessionConfigurationsButton`.
- **Button component:** `src/components/session-configurations/dev-reset-session-configurations-button.tsx`
- **Server action:** `resetSessionConfigurationsAction` in `app/session-configurations/actions.ts`
- **Service function:** `resetSessionConfigurationTestData` in `src/modules/session-configurations/session-configuration-reset.service.ts`
- **Visible in:** `/session-configurations`, development only.
- **Confirmation text:** `Reset session configurations, options, and saved order-package selections?`
- **Data affected:** `OrderPackageSessionConfigurationSelection`, `SessionConfigurationOption`, and `SessionConfiguration`.
- **Data intentionally not affected:** Session types, products, packages, extra-photo pricing, bookings, orders, invoices, payments, and customers.
- **Cache revalidated:** `/session-configurations`, `/orders`
- **Permission guard:** Rechecks `PACKAGE_CATALOG_MANAGE` in the server action.
- **Server guard:** Throws unless `NODE_ENV === "development"`.
- **Removal before shipping:** Remove page render/import first, then delete the button component, action export, and reset service if unused.

### Create Test Booking

- **Purpose:** Create one preset pending booking from existing active records.
- **UI entry point:** `app/bookings/new/page.tsx` renders `DevCreateTestBookingButton`.
- **Button component:** `src/components/bookings/dev-create-test-booking-button.tsx`
- **Server action:** `createTestBookingAction` in `app/dev/actions.ts`
- **Service function:** `createDevelopmentTestBooking` in `src/modules/development/dev-create-booking.service.ts`
- **Visible in:** `/bookings/new`, development only.
- **Data affected:** Creates a pending booking through the normal booking service path.
- **Fixture inputs:** First active customer, first active package, first active department, first assignable photographer if available, next-day session date, `17:00` session time, and `DEV TEST BOOKING` note.
- **Cache revalidated:** `/bookings`, `/calendar`, `/bookings/new`
- **Redirect after success:** `/bookings`
- **Server guard:** Throws unless `NODE_ENV === "development"`.
- **Removal before shipping:** Remove the development quick-action block from `/bookings/new`, then delete the button component, action export if unused, and `dev-create-booking.service.ts` if no other dev tooling needs it.

## Pre-Ship Checklist

- [ ] Search for `DevResetWorkflowButton`, `DevResetSessionConfigurationsButton`, and `DevCreateTestBookingButton`.
- [ ] Search for `resetWorkflowAction`, `resetSessionConfigurationsAction`, and `createTestBookingAction`.
- [ ] Search for `resetWorkflowTestData`, `resetSessionConfigurationTestData`, and `createDevelopmentTestBooking`.
- [ ] Confirm no development utility buttons render in production builds.
- [ ] Confirm no development reset or fixture-creation server action is still imported by production UI.
- [ ] Remove this document or move any remaining local-only tooling notes to internal developer documentation.
