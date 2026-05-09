# Feature 51 Permission Coverage

This file tracks the explicit permission-guarded actions implemented in Feature 51.

## Shared Permission Keys

- `booking:status-update`
- `payment:create`
- `invoice:create`
- `invoice:issue`
- `invoice:close`
- `invoice:adjustment-create`
- `order:financial-update`
- `delivery:update`
- `delivery:complete`
- `delivery:payment-override`

## Current Role To Permission Map

This is the current app-level authorization map implemented in
[src/lib/permissions/index.ts](/Users/bo3li/Desktop/lollipop-studio-os/src/lib/permissions/index.ts).

### Admin

- Allowed to do everything listed in this file.

### Manager

- Allowed to do everything listed in this file.

### Receptionist

- `booking:status-update`
- `payment:create`
- `delivery:update`
- `delivery:complete`

### Reservation

- `booking:status-update`

### Accountant

- `payment:create`
- `invoice:create`
- `invoice:issue`
- `invoice:close`
- `invoice:adjustment-create`

### Photographer

- No explicit Feature 51 sensitive-action permissions currently granted.

### Editor

- No explicit Feature 51 sensitive-action permissions currently granted.

## Who Is Allowed To Do What

### Important Distinction

- `invoice:create` means the user can run the explicit standalone invoice-creation action.
- Some permitted workflows can still create or reuse an invoice internally as part of a broader allowed action.
- Example: a receptionist with `payment:create` can record a deposit or base payment even when no invoice exists yet, because the payment flow is allowed to create the required invoice behind the scenes.
- Read this section as:
  direct action permission first, then workflow side-effects second.

- Update booking status:
  `ADMIN`, `MANAGER`, `RECEPTIONIST`, `RESERVATION`

- Record deposit:
  `ADMIN`, `MANAGER`, `RECEPTIONIST`, `ACCOUNTANT`
  Note: this can indirectly create or reuse a booking invoice as part of the payment workflow.

- Record base payment and complete booking:
  `ADMIN`, `MANAGER`, `RECEPTIONIST`, `ACCOUNTANT`
  Note: this can indirectly create or reuse a booking invoice as part of the payment workflow.

- Create order invoice:
  `ADMIN`, `MANAGER`, `ACCOUNTANT`
  Note: this is the direct standalone invoice creation action.

- Issue invoice:
  `ADMIN`, `MANAGER`, `ACCOUNTANT`

- Close or lock invoice:
  `ADMIN`, `MANAGER`, `ACCOUNTANT`

- Record invoice payment:
  `ADMIN`, `MANAGER`, `RECEPTIONIST`, `ACCOUNTANT`

- Create adjustment invoice:
  `ADMIN`, `MANAGER`, `ACCOUNTANT`

- Update selection workflow when it changes package/add-ons/invoice math:
  `ADMIN`, `MANAGER`

- Update direct order financial edits:
  `ADMIN`, `MANAGER`

- Prepare order for pickup:
  `ADMIN`, `MANAGER`, `RECEPTIONIST`

- Record customer notification:
  `ADMIN`, `MANAGER`, `RECEPTIONIST`

- Record pickup:
  `ADMIN`, `MANAGER`, `RECEPTIONIST`

- Complete delivery:
  `ADMIN`, `MANAGER`, `RECEPTIONIST`

- Complete delivery with payment override:
  `ADMIN`, `MANAGER`

## Implemented Guarded Actions

### Booking

- `updateBookingStatusAction`
  Permission: `booking:status-update`
  File: [app/bookings/actions.ts](/Users/bo3li/Desktop/lollipop-studio-os/app/bookings/actions.ts)

- `recordDepositAction`
  Permission: `payment:create`
  File: [app/bookings/actions.ts](/Users/bo3li/Desktop/lollipop-studio-os/app/bookings/actions.ts)
  Notes: May create or reuse the needed booking invoice internally before recording the deposit.

- `recordBasePaymentAndCompleteAction`
  Permission: `payment:create`
  File: [app/bookings/[bookingId]/actions.ts](/Users/bo3li/Desktop/lollipop-studio-os/app/bookings/[bookingId]/actions.ts)
  Notes: May create or reuse the needed booking invoice internally before recording the base payment.

### Invoices And Payments

- `createOrderInvoiceAction`
  Permission: `invoice:create`
  File: [app/orders/[orderId]/actions.ts](/Users/bo3li/Desktop/lollipop-studio-os/app/orders/[orderId]/actions.ts)
  Notes: Direct standalone invoice creation for an order.

- `issueInvoiceAction`
  Permission: `invoice:issue`
  File: [app/invoices/actions.ts](/Users/bo3li/Desktop/lollipop-studio-os/app/invoices/actions.ts)

- `closeInvoiceAction`
  Permission: `invoice:close`
  File: [app/invoices/actions.ts](/Users/bo3li/Desktop/lollipop-studio-os/app/invoices/actions.ts)

- `recordPaymentAction`
  Permission: `payment:create`
  File: [app/invoices/actions.ts](/Users/bo3li/Desktop/lollipop-studio-os/app/invoices/actions.ts)
  Notes: Records payment against an existing invoice; does not use the standalone create-invoice action.

- `createAdjustmentInvoiceAction`
  Permission: `invoice:adjustment-create`
  File: [app/invoices/actions.ts](/Users/bo3li/Desktop/lollipop-studio-os/app/invoices/actions.ts)

### Order Financial Mutations

- `updateSelectionWorkflowAction`
  Permission: `order:financial-update`
  File: [app/orders/[orderId]/actions.ts](/Users/bo3li/Desktop/lollipop-studio-os/app/orders/[orderId]/actions.ts)
  Notes: Covers package changes, extra-photo pricing impact, add-on pricing impact, and invoice-syncing order edits done through the selection workflow.

- `updateOrderAction`
  Permission: `order:financial-update`
  File: [app/orders/[orderId]/edit/actions.ts](/Users/bo3li/Desktop/lollipop-studio-os/app/orders/[orderId]/edit/actions.ts)
  Notes: Covers direct financially meaningful order edits such as final package changes, selected photo count changes, add-on changes, and notes recorded alongside the edit flow.

### Delivery Workflow

- `updateDeliveryWorkflowAction`
  Permission depends on action:
  File: [app/orders/[orderId]/actions.ts](/Users/bo3li/Desktop/lollipop-studio-os/app/orders/[orderId]/actions.ts)

- `prepareForPickup`
  Permission: `delivery:update`

- `recordCustomerNotification`
  Permission: `delivery:update`

- `markPickedUp`
  Permission: `delivery:update`

- `completeOrder`
  Permission: `delivery:complete`

- `completeOrder` with payment override enabled
  Additional permission: `delivery:payment-override`

## Current Gaps Intentionally Left For Later

- Editing workflow actions currently carry authenticated actor context but do not yet enforce a dedicated explicit permission key.
- Production workflow actions currently carry authenticated actor context but do not yet enforce a dedicated explicit permission key.
- Customer actions and non-sensitive CRUD outside the Feature 51 priority list were not expanded in this unit.
- Full page-level or navigation-level RBAC visibility is still deferred.
