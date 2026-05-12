# POS & Invoice Design Review — May 2026

**Date:** 2026-05-12  
**Context:** Post-feature-57f discussion. Features 56 and 57 (a–f) are complete. This document captures open design questions, implementation gaps, and proposed next steps for review before any new specs are written.

---

## Implementation Status (Features 56–58)

| Feature | Status | Notes |
|---|---|---|
| 56a Product catalog | Complete | Products unified as shared catalog for packages and add-ons |
| 56b Package schema redesign | Complete | `PackageItem`, `bundleAdjustment` shipped |
| 56c Package management UI | Complete | Dedicated `/packages/new` and `/packages/[id]/edit` pages |
| 56d Invoice line items | Complete | Snapshot written at delivery/close; locked invoices immutable |
| 56e Downstream adoption | Complete | Selection tab and overview use structured `PackageItem` data |
| 57a POS route + layout | Complete | `/orders/[orderId]/sales` standalone layout |
| 57b POS package composition | Complete | Deliverable cards, upgrade pickers, locked-invoice blocking |
| 57c POS action buttons + marketplace | Complete | Category pickers, marketplace, extra photos, remove add-ons |
| 57d POS financial sidebar | Complete | Line item snapshot rendering with computed fallback |
| 57e Dashboard phone search | Complete | Submit-based phone lookup with order history and Open Sales links |
| 57f POS embedded payment dialog | Complete | In-place payment modal with KNET/Cash/Link, locked-invoice support |
| 57g Dashboard phone suggestion dropdown | ✅ Complete | Implemented with 300ms debounce, keyboard/mouse selection, Escape/outside dismiss |
| 58 Check-in / order creation | ⚠️ Superseded | Original spec (Feature 58) deleted; superseded by lifecycle revision. Check-in is now Feature 61; booking confirmation is Feature 60. |

**Known bug:** Selection Completed Resets Package Upgrade — re-saving selection can revert the order to the base package. Tracked in `open-issues-review.md`.

---

## Open Design Questions

### 1. Tracking Base vs. Upgrade Package

**Current state:** The data model tracks this correctly — `originalPackage` vs. `finalPackage` on the order, and `InvoiceLineItem` has `PACKAGE_BASE` and `ITEM_UPGRADE` types. Upgrade delta = `finalPackage.price − originalPackage.price`.

**Gap:** The selection-save bug (see above) can corrupt the upgrade state. The model is right; the write path has a fragility.

**Action:** Fix the selection-save bug first, then verify the base/upgrade tracking holds under re-save.

---

### 2. Invoice Should Show Full Order Details + Payment History

**Current state:** The `/invoices/[id]` page shows only payment records. Package, add-on, and upgrade details live on the order page.

**What's available:** `InvoiceLineItem` rows (PACKAGE_BASE, BUNDLE_ADJUSTMENT, ITEM_UPGRADE, ADD_ON, etc.) are already written at lock/delivery time. The data exists — the UI doesn't render it.

**Decision:** Show both on the invoice page:
- Top section: invoice line items snapshot (package, bundle adjustment, add-ons, upgrade delta)
- Bottom section: payment history (existing)

This is a UI-only change. Small spec scope. No schema work needed.

---

### 3. App Sidebar / Top Bar in POS

**Current state:** The POS has its own layout that overrides the tab bar. The global app sidebar (left nav) still shows.

**Options discussed:**
- Keep the global sidebar so staff can navigate away without the back button
- Hide the global sidebar for a full-focus cashier experience
- Add a hide/show toggle

**Recommendation:** A sidebar toggle is reasonable UX polish. Not urgent. Cosmetic spec.

---

### 4. Discount Section in POS (% and Flat)

**Current state:** The `InvoiceLineItem` schema already has `MANUAL_DISCOUNT` and `MANUAL_SURCHARGE` line types. No UI or server action exists to write them.

**What's needed:**
- A discount card/section in the POS composition area
- Two discount modes: flat amount (e.g., −20.000 KD) and percentage (e.g., −20%)
- Design decision required: does % apply to package price only, or the full order total?
- Server action that writes a `MANUAL_DISCOUNT` line item (invoice must not be locked)

**Action:** Needs a design decision on percentage basis before a spec can be written.

---

### 5. When Does the Invoice Update?

**Current behavior:**
- Invoice totals recalculate automatically on add/remove add-ons, package change, or payment — as long as the invoice isn't locked
- Invoice line item snapshot is written once at order delivery or invoice close
- After delivery/close: `isLocked = true`, no further recalculation, no overwriting line items

**Summary:** Live-recalculated until delivery/close, then permanently frozen. Only new payment recordings or total changes trigger a UI refresh (via route revalidation).

**No action needed** — this is correct per the architecture. Worth surfacing to staff as guidance.

---

### 6. Bundle Adjustment Naming — "The Photos Cost"

**The problem:** In a typical package:

```text
Package price (150 KD) = deliverable total (75 KD albums) + bundleAdjustment (75 KD)
```

The bundle adjustment is absorbing the implied value of everything not individually priced — in this case, photos and session time. Calling it "Bundle Adjustment" is confusing because it implies a discount when it's actually an implied cost.

**Options:**
1. Rename to something like "Included Services" or "Photography Session" as a positive display label — cosmetic only
2. Add photos as an explicit product in the catalog (e.g., "40 Edited Photos — 75.000 KD") so they appear as a real deliverable and the bundle adjustment becomes a true discount or near-zero
3. Add a label: "Bundle value (inc. session + editing)" for transparency

**Recommendation (option 2):** Add a `PHOTOGRAPHY_SESSION` or `PHOTO_EDITING` product to the catalog with a canonical price so photos are an explicit deliverable in the package composition. The bundle adjustment would then represent a true discount or be zero.

**Action:** Short spec — product catalog addition guidance + package rebuild guidance for existing packages. No schema change needed (products already support any category).

---

### 7. POS Controlling Order Status — When Does Selection Complete? Move to Editing?

**Current state:** The selection workflow tab drives status transitions, not the POS. Flow:
- Selection tab save → `WAITING_SELECTION` → `SELECTION_COMPLETED`
- Editing start requires: selection complete + editor assigned + full invoice settled

The POS is currently financial/commercial only — it doesn't touch workflow status.

**The question:** Should the POS be the primary staff surface that also drives workflow status, or should status transitions stay in the order workflow tabs?

**Tradeoffs:**
- POS as financial-only: simpler, cleaner separation. Staff use workflow tabs for status.
- POS as primary surface: makes the POS the single place staff interact with during the customer visit, which matches cashier workflows better. But adds complexity to the POS.

**Adjacent:** Feature 61 (check-in rewrite) moves order creation to a booking-level button under the new lifecycle architecture. After check-in, the customer is seated and selection begins. Where does selection get saved — the order tab, or the POS?

**Decision needed before speccing:** Define which surface owns which status transitions. Current recommendation: keep POS financial-only and keep workflow tabs for status transitions. The check-in (Feature 61) is the bridge between booking confirmation and the operational job.

---

## Proposed Next Specs

Listed in suggested priority order:

| # | Spec | Scope | Dependency | Status |
|---|---|---|---|---|
| 1 | Fix selection-save package upgrade bug | Bug fix | None | Open |
| 2 | Feature 57g — Dashboard phone suggestion dropdown | Spec exists | None | ✅ Complete |
| 3 | Feature 60 — Booking confirmation rewrite | Lifecycle revision | Feature 59 ✅ | In spec |
| 4 | Feature 61 — Check-in rewrite | Lifecycle revision | Feature 60 | In spec |
| 5 | Feature 62 — Deposit invoice display | Lifecycle revision | Feature 61 | In spec |
| 6 | Feature 63 — Final invoice / POS integration | Lifecycle revision | Feature 62 | In spec |
| 7 | Invoice page: show line items + payment history | New spec, UI only | 56d ✅ | Open |
| 8 | POS discount section (flat and %) | New spec | Design decision on % basis | Blocked — decision needed |
| 9 | Photos as explicit product in packages | Short spec | None | Open |
| 10 | POS sidebar toggle | Polish spec | None | Open |

---

## Notes on Invariants (No Action Needed — Just Confirmation)

- Editing cannot start until selection is complete + editor assigned + full payment settled — this is enforced
- Invoice line items are immutable after delivery/close — confirmed working
- Locked invoices can still accept append-only payments if balance remains — implemented in 57f
- Bundle adjustment is stored explicitly on `Package`, not computed on read — confirmed per 56b
