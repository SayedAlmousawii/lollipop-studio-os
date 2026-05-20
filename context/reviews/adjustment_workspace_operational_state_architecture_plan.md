# Adjustment Workspace + Operational Order State Architecture Plan

Date: 2026-05-20 Purpose: Discussion/finalization document for Claude before writing implementation specs.

---

# Context

During investigation of package upgrade bugs, we discovered that the current system architecture drifted away from the intended operational model.

The original intent was:

```text
Adjustment Workspace = temporary staging state
Finalize = create real invoice + update real operational order state
```

However, the current implementation evolved into a hybrid system where:

```text
finalized adjustment invoice deltas
+ projection logic
= effective current composition
```

This causes:

- inconsistent UI behavior,
- weak database inspectability,
- fragile reporting,
- weak commission foundation,
- operational truth partially depending on invoice replay.

---

# Confirmed Current Architecture

## Current order operational tables

```text
Order
OrderPackage
OrderAddOn
OrderPackageItemUpgrade
```

---

## Current financial tables

```text
Invoice
InvoiceLineItem
Payment
FinancialCase
DocumentApplication
```

---

## Current adjustment staging tables

```text
AdjustmentWorkspace
AdjustmentWorkspaceEvent
```

---

# Current Adjustment Workspace Behavior

AdjustmentWorkspace currently stores:

```text
parent invoiceId
orderId
status
ownership/version fields
baseSnapshotJson
pendingChangesJson
optional finalizedAdjustmentInvoiceId
```

AdjustmentWorkspaceEvent stores:

```text
eventType
payloadJson
actorUserId
```

These are adjustment workflow/staging records.

They are NOT supposed to be:

- permanent operational order state,
- final composition source of truth.

---

# Important Discovery

The current implementation mostly does NOT materialize finalized adjustment changes back into operational order rows.

Instead:

```text
base order rows
+ finalized adjustment invoice lines
= effective composition projection
```

This projection is currently used by:

- Deliverables tab,
- some locked order views,
- some current composition displays.

Meanwhile other areas still read raw order rows.

This caused the discovered bugs:

- original/current package confusion,
- stale headers after adjustment upgrades,
- inconsistent timeline behavior.

---

# Key Architectural Decision

We do NOT want finalized adjustment invoices to be the long-term operational source of truth.

Invoices are:

```text
financial history
```

NOT:

```text
current operational ownership
```

---

# Final Architecture Direction

## Adjustment Workspace responsibility

AdjustmentWorkspace remains:

```text
staging + preview + approval layer
```

It is still correct and useful.

---

## Preview/effective composition responsibility

During staging:

```text
current persisted order state
+ pendingChangesJson
= preview/proposed composition
```

This preview layer is necessary for:

- live financial summary updates,
- live delta previews,
- approval checks,
- showing proposed order state before finalize.

Important:

This preview/projection is TEMPORARY.

It should NOT remain the long-term operational source of truth after finalize.

---

# Finalize Flow (Target)

When adjustment workspace finalizes:

```text
1. Load current persisted operational order state
2. Load pending workspace edits
3. Recompute proposal server-side
4. Compare old state vs proposed new state
5. Generate financial delta lines
6. Create immutable adjustment financial document
7. Materialize new operational order state
8. Write order activity/audit events
9. Finalize/close workspace
```

---

# Critical Principle

The adjustment invoice should represent:

```text
the DELTA between:
old operational state
and
new operational state
```

NOT:

```text
the new full order composition
```

---

# Example

## Before adjustment

```text
Package: Basic
Canvas add-on
5 extra photos
```

---

## Staged changes

```text
Basic -> Standard
Remove Canvas
+2 extra photos
```

---

## Adjustment invoice should contain ONLY

```text
Package upgrade delta
Canvas removal delta
Extra photo delta
```

NOT the full resulting order.

---

# Final Operational State After Finalize

After finalize, real operational rows should reflect current ownership.

Example:

```text
OrderPackage.currentPackageId = Standard
Canvas OrderAddOn removed
extra photo counts updated
```

This becomes the canonical operational truth.

---

# Financial Documents Stay Immutable

Locked FINAL invoice remains frozen.

Adjustment invoices remain immutable financial snapshots.

Operational order rows are allowed to change through finalized adjustments.

---

# Multi-Package Direction

We do NOT want to return to:

```text
Order.originalPackageId
Order.finalPackageId
```

That old model was single-package.

---

# BookingPackage Is The Original Baseline

Business rule:

```text
Original package = originally booked package
```

Therefore:

```text
BookingPackage
```

is the immutable original baseline.

---

# Proposed OrderPackage Direction

Likely future direction:

```text
OrderPackage
- bookingPackageId
- currentPackageId
- original/current snapshots
- selected photo counts
- extra photo counts
- sessionTypeId
- sortOrder
```

Important:

```text
bookingPackageId
```

implicitly provides:

```text
originalPackageId
```

through:

```text
bookingPackage.packageId
```

So separate originalPackageId duplication may not be necessary.

---

# Important Relationship

```text
BookingPackage
    ↓ immutable original baseline
OrderPackage
    ↓ mutable current operational state
AdjustmentWorkspace
    ↓ temporary staging/proposal state
Invoices
    ↓ immutable financial history
```

---

# Operational vs Financial Truth

## Operational rows answer:

```text
What does the customer currently own?
```

Examples:

- current package
- current add-ons
- current deliverables
- current photo counts

---

## Financial documents answer:

```text
What financial documents were issued?
```

Examples:

- FINAL invoice
- ADJUSTMENT invoice
- CREDIT\_NOTE
- REFUND
- payments

---

# Current Composition / Effective Composition Clarification

The concept itself is NOT wrong.

It is still needed during staging.

Correct usage:

```text
workspace preview only
```

NOT:

```text
permanent post-finalization operational truth
```

---

# Important Existing Tables

## OrderPackage

Represents package lines within the order.

Currently stores:

```text
packageId
originalPackagePriceSnapshot
finalPackagePriceSnapshot
selectedPhotoCount
extraDigitalCount
extraPrintCount
```

Current gap:

```text
packageId
```

currently acts as:

- current package identity,
- but original package identity is not separately preserved.

---

## OrderAddOn

Structured add-on table.

Stores:

```text
nameSnapshot
priceSnapshot
quantity
notes
```

Can belong to:

- order-level,
- or package-line level.

---

## OrderPackageItemUpgrade

Tracks deliverable/item upgrades inside a package.

Example:

```text
small album -> premium album
```

This is separate from package tier upgrades.

---

# UpgradeRecord Clarification

Old architecture docs mentioned:

```text
UpgradeRecord
```

with:

```text
fromPackageId
toPackageId
upgradeCharge
changedByUserId
reason
```

Important:

This was NEVER implemented in the real schema.

Codex confirmed:

- no Prisma model exists,
- no migration created it.

It was historical design intent only.

---

# Possible Future Upgrade Tracking

We may still want a modern multi-package version later.

Possible future concept:

```text
OrderPackageChange
or
UpgradeRecord
```

Potentially:

```text
orderPackageId
fromPackageId
toPackageId
priceDelta
sourceAdjustmentWorkspaceId
sourceInvoiceId
changedByUserId
reason
```

This is NOT finalized yet.

---

# Important Constraints

## Do NOT

```text
Use InvoiceLineItems
as long-term operational order truth
```

---

## Do NOT

```text
Mutate locked FINAL invoices
```

---

## Do NOT

```text
Use UI-only fake composition
as permanent operational truth
```

---

## DO

```text
Keep adjustment workspace as staging only
```

---

## DO

```text
Materialize finalized adjustments
into real operational order rows
```

---

# Main Goal

The final architecture should allow someone inspecting the database to directly understand:

```text
What was originally booked?
What does the customer currently own?
What financial documents were issued?
What changed?
Who changed it?
Why?
```

without replaying invoice projections or UI-only logic.

---

# Requested Claude Task

Please:

1. Review this architecture direction against the CURRENT codebase.
2. Validate or challenge assumptions.
3. Identify risks.
4. Identify migration/backfill concerns.
5. Identify projection/double-application risks.
6. Propose the cleanest schema direction.
7. Propose the finalize transaction flow.
8. Propose the safest phased implementation/spec breakdown.
9. Recommend whether operational change ledger/event sourcing is needed now or later.
10. Write final implementation specs after architecture review.

