# Studio OS — New Package & Booking Architecture Discoveries
Date: 2026-05-12

## Purpose

This document summarizes newly discovered real-world business rules from the studio owner that significantly affect the current package, booking, order, POS, pricing, and invoice architecture.

The purpose is NOT to propose solutions yet.

The goal is to review these discoveries against the current codebase and determine the best architectural direction based on the existing system structure.

---

# 1. Department Hierarchy

The studio operates using departments.

Current discovered departments:

- Kids
- NB (Newborn)

Departments affect which session types are available.

---

# 2. Session Type Hierarchy

Session types differ between departments.

Examples:

## NB Department
- Newborn
- Maternity
- Gender Reveal
- Hospital

## Kids Department
- Regular
- Birthday
- Special
- Mini Special
- Special Occasion
- Family
- Duck

Session type is no longer simple metadata.

Session type affects:
- available packages
- operational behavior
- pricing behavior
- package families
- add-on pricing
- scheduling behavior

---

# 3. Package Structure

Packages are grouped differently depending on session type.

Examples:

## NB
- Package 1–7

## Birthday
- Package 1–7

## Regular
- Silver
- Gold
- Rose
- Black

This means package naming is contextual to session type.

“Package 1” is not globally meaningful.

---

# 4. Session Duration Depends on Package

Different packages have different session lengths.

Example:
- NB Package 1 = 1 hour
- NB Package 7 = 2 hours

Duration is therefore package-dependent.

This affects:
- booking duration
- calendar scheduling
- overlap prevention
- availability calculations
- photographer assignment
- operational planning

---

# 5. Orders Can Include Multiple Packages

A single order is allowed to contain multiple packages simultaneously.

Example:
- Birthday Package
- Family Package
- Mini Special Package

This changes the assumption that an order contains one final package.

This affects:
- package ownership structure
- invoice generation
- POS structure
- package upgrade logic
- deliverables aggregation
- production visibility
- financial calculations

---

# 6. Bookings Can Include Multiple Packages

A booking can also contain multiple packages.

Booking duration becomes the total combined duration of all selected packages.

Example:
- Package A = 1 hour
- Package B = 30 minutes

Final booking duration:
- 1 hour 30 minutes

This affects:
- booking architecture
- scheduling logic
- booking duration calculation
- calendar rendering
- booking workflow assumptions

---

# 7. Session Type Determines Extra Photo Pricing

Each session type has different pricing for extra photos.

Example:
- NB extra photo pricing differs from Birthday pricing
- Regular session pricing differs from NB pricing

Extra photo pricing is therefore contextual.

This affects:
- POS calculations
- invoice line calculations
- pricing architecture
- add-on modeling

---

# 8. Digital vs Print Extra Photos

Digital extra photos and print extra photos have different pricing.

Business rule discovered:
- Digital photo price = Print price - 1 KD

This pricing difference exists within the context of the session type.

Example:
- NB print photo price differs from NB digital photo price
- Birthday print photo price differs from Birthday digital photo price

This affects:
- add-on pricing structure
- invoice calculations
- POS logic
- pricing rules architecture

---

# 9. Emerging Business Hierarchy

The business hierarchy now appears to be:

Department
  → Session Type
      → Package Family
          → Packages

Example:

Kids
  → Birthday
      → Birthday Package 1
      → Birthday Package 2

Kids
  → Regular
      → Silver
      → Gold

NB
  → Newborn
      → NB Package 1
      → NB Package 2

---

# 10. Emerging Order Structure

The workflow structure now appears closer to:

Booking
  → Multiple Packages
  → Total Session Duration

Order
  → Multiple Packages
  → Add-ons
  → Adjustments
  → Invoice(s)

---

# 11. Emerging Pricing Structure

Pricing is no longer simple global product pricing.

Pricing now depends on:
- session type
- package context
- media type (digital vs print)
- operational context

This affects:
- package pricing
- add-on pricing
- extra photos
- POS logic
- invoice calculations
- financial architecture

---

# 12. POS Implications

The POS structure is heavily affected by these discoveries.

Current findings imply:
- multiple packages per order
- contextual package families
- contextual pricing
- session-type-specific pricing behavior
- digital vs print pricing differences
- package-specific operational duration

This changes many earlier assumptions around:
- upgrades
- add-ons
- package replacement
- invoice recalculation
- booking duration
- pricing derivation

---

# 13. Architectural Impact Areas

These discoveries potentially affect:

- booking architecture
- package architecture
- order architecture
- POS architecture
- invoice architecture
- add-on architecture
- pricing architecture
- scheduling architecture
- production visibility
- workflow calculations
- duration calculations
- package upgrade logic
- invoice recalculation logic
- deliverables aggregation

---

# 14. Important Note

This document intentionally does NOT propose implementation solutions.

The purpose is to evaluate:
- how these discoveries interact with the current codebase
- which assumptions are no longer valid
- what architectural direction best fits the existing system
- which current structures should remain vs change
