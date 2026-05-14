# Legacy Edit and Selection vs POS Audit

Feature 70e.2 audit before retiring duplicate write surfaces.

## Legacy Edit Order Page

| Field/action | Legacy surface | POS coverage |
|---|---|---|
| Final package selection | `/orders/[orderId]/edit` package select writes through `updateOrder` against the first package line | Covered by POS package-line `Upgrade Package`, which targets a specific `OrderPackage` line |
| Selected photo count | Single `selectedPhotos` order-level number | Covered by POS per-line selected photo count forms |
| Extra photos | Derived from one selected photo count minus one package limit | Covered by POS per-line digital extras and print extras |
| Add-ons | Free-text add-on names/prices, replacing all order add-ons by `orderId` | Covered by POS add-on marketplace and line-aware add-on removal |
| Invoice preview/impact | Local projected totals before submit | Covered by POS financial sidebar computed preview and Final Invoice summary |
| Final payment | Not available on legacy edit page | Covered by POS record-payment dialog |
| Internal notes | Editable non-financial order note | Non-financial; remains visible in existing order detail surfaces and activity context, but is not enough to keep a destructive financial edit page |
| Save action | `updateOrderAction` calls `updateOrder`, which updates first package line and deletes all `OrderAddOn` rows by `orderId` | Retired; POS actions are canonical |

## Selection Workflow Tab

| Field/action | Legacy surface | POS coverage |
|---|---|---|
| Package decision | Single final package select | Covered by POS per-line package upgrade |
| Extra selected photos | Single extra-photo number | Covered by POS per-line digital extras and print extras |
| Selected photos total | Single order-level total | Covered by POS selected-photo card and financial sidebar totals |
| Add-ons | Add-on product picker submitted as a full replacement list | Covered by POS add-on marketplace add/remove controls |
| Invoice/financial consequence | Read-only local calculations and next-action text | Covered by POS financial sidebar invoice preview and remaining balance |
| Final payment | Not available on selection form | Covered by POS record-payment dialog |
| Selection status completion | `completeSelection` submit path | Covered by POS payment dialog selection-status choice for waiting-selection orders |
| Selection notes | Editable non-financial order note | Non-financial/read-only candidate; not enough to keep the legacy financial form |

## Decision

POS covers the financial and selection write capabilities that remain relevant after the multi-package rollout. The legacy edit order page and writable selection workflow form are retired. Order detail keeps a read-only selection summary and routes package, photo, add-on, invoice, and payment work to POS.

## Feature 71 Closure Status

Fixed. The retired service-layer write/read entry points (`updateOrder`, `updateOrderSelectionWorkflow`, and `getEditableOrderById`) and their single-package write schemas/types have been removed. The remaining Selection tab is read-only and renders package-line summaries instead of first-line package data. POS remains the only writable workspace for package, selected-photo, extra-photo, add-on, invoice preview, and final-payment changes.
