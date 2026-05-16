# Studio OS — Package Pricing & POS Architecture Notes

Date: 2026-05-11

---

# Core Discovery

The studio does NOT operate like a traditional e-commerce cart system.

Packages are NOT:
- strict summed product carts
- fixed immutable SKUs
- standalone product collections

Instead:

Packages are:
- commercial bundles
- operational deliverable templates
- customizable sales starting points

This distinction is extremely important.

---

# Pricing Model Discovery

The business clarified:

- albums inside packages still have their normal canonical prices
- standalone add-ons use the same canonical product prices
- upgrades use actual product price differences
- the package total differs because the package itself applies a bundle adjustment/discount

Example:

| Item | Price |
|---|---|
| Premium Album | 80 KD |
| Canvas | 30 KD |
| 40 Photos | 40 KD |
| Raw Total | 150 KD |

Package marketed as:
120 KD

Therefore:

Package Adjustment = -30 KD

Final Formula:

Final Package Price =
Raw Product Total + Package Adjustment

---

# Important Architectural Decision

Products retain canonical prices globally.

Packages apply:
- bundle pricing
- commercial adjustments
- discounts/premium pricing

The package adjustment belongs to:
- the bundle itself

NOT:
- individual products

This allows:
- upgrades
- add-ons
- replacements
- invoice recalculation

to work naturally.

---

# Upgrade Logic

Example:

Included:
- Premium Album = 80 KD

Customer upgrades to:
- Luxury Album = 110 KD

Upgrade charge:
+30 KD

The package adjustment remains untouched.

This was identified as the correct and most natural pricing behavior.

---

# POS / Sales Page Behavior

The POS page SHOULD visually behave like:

an editable package composition.

Employees should be able to:
- add/remove products
- upgrade albums
- change canvases
- increase photos
- add standalone add-ons
- apply discounts/adjustments

The package should visually appear to consist of products/deliverables.

However:

UI composition and financial composition are separate concepts.

---

# Critical Architecture Separation

UI / Operational View:
- package contains editable deliverables

Financial View:
- package = products + bundle adjustment

This separation is essential.

---

# Package Template vs Order Composition

Important discovery:

Packages should act as:
- starting templates

NOT:
- permanent immutable financial entities

Recommended flow:

Package Template
→ copied into mutable Order Composition

After selection:
employees modify the ORDER composition,
not the original package template.

This supports:
- customizations
- upgrades
- add-ons
- negotiated sales

without corrupting package definitions.

---

# Recommended Data Structure Direction

Conceptual structure:

Package
├── included items
├── raw calculated subtotal
├── package adjustment
└── final package total

Order
├── copied package composition
├── editable order line items
├── standalone add-ons
├── pricing snapshots
└── invoice calculations

---

# Package Upgrade Behavior

Package upgrades should replace:
- the current package composition
with:
- the new package template composition

Then recalculate totals using:
- new products
- new bundle adjustment

This allows:
Silver Package → Gold Package
to work naturally.

---

# Add-On Behavior

Standalone add-ons:
- are NOT part of the package adjustment
- use canonical standalone product prices
- remain separate order line items

Examples:
- extra album
- extra canvas
- extra prints
- extra edited photos

---

# Final Pricing Formula

Final Order Total =
Current Package Composition
+ Package Bundle Adjustment
+ Standalone Add-ons
+ Manual Discounts / Adjustments

---

# Very Important Accounting Rule

Historical orders/invoices must NEVER dynamically recalculate from future product prices.

When order/invoice is finalized:
the system should snapshot:
- product prices
- bundle adjustment
- totals
- quantities

Otherwise:
future price changes would alter historical invoices.

This would break accounting integrity.

---

# Key Operational Insight

The system is evolving toward:

Service Studio POS Architecture

NOT:
Traditional Inventory Cart Architecture

The workflow is:
- package-centric
- consultation-driven
- customizable
- operationally flexible

This aligns with real photography studio operations.

---

# Final Agreed Direction

Recommended architecture:

1. Canonical product pricing
2. Bundle/package adjustment layer
3. Mutable order composition
4. Editable POS-style sales workflow
5. Snapshot-based invoice history
6. Standalone add-on support
7. Product replacement/upgrade support
8. Package replacement/upgrade support

This was identified as:
- flexible
- operationally realistic
- financially safe
- scalable
- easier to maintain long-term
