# Studio OS — Session Configuration System (Planning Document)

## Purpose

This document summarizes:

- owner feedback
- operational requirements
- agreed architectural direction
- UX decisions
- proposed data modeling direction
- future extensibility considerations

for the upcoming “Session Configuration System” inside Studio OS.

The goal is to support configurable session-specific operational and pricing rules without hardcoding workflow behavior into package/order screens.

---

# Problem Summary

The studio currently has operational rules and pricing modifiers that staff apply manually during order setup.

Examples:

## Newborn
- age-range surcharge tiers
- twins surcharge

## Birthday
- twins surcharge
- cake option
- t-shirt option

Currently these concepts do not fit cleanly into:
- packages
- products
- photo pricing
- generic add-ons

The existing system mainly supports:
- packages
- upgrades
- add-ons
- photo pricing

but these new requests represent:
- contextual session modifiers
- operational configuration choices
- conditional pricing behavior

---

# Agreed Direction

## New System Category

A new category should be introduced:

> Session Configurations

This should become a first-class concept in the system.

Session configurations are:
- contextual options shown during session/order setup
- tied to session type, package type, or family type
- optionally operational
- optionally financial
- optionally both

---

# Examples

| Configuration | Operational | Financial |
|---|---|---|
| Twins | Yes | Yes |
| Newborn Age Range | Yes | Yes |
| Cake | Yes | Maybe |
| T-Shirt | Yes | Maybe |
| Shirt Size | Yes | No |
| Cake Theme | Yes | No |
| Weekend Surcharge | No | Yes |

---

# Important Architectural Principle

Employees should feel like they are:

> configuring the session

NOT:

> manually constructing invoice rows or accounting adjustments

The system should internally generate:
- order modifier rows
- pricing adjustments
- operational metadata

without exposing accounting complexity to employees.

---

# Employee UX Direction

## Order Page

Inside each package card:
- keep existing package info
- keep “Upgrade Package”
- add a new button:

> Configure Session

---

## Configure Session Panel

Clicking the button opens:
- modal
or
- side sheet/panel

The panel dynamically renders configuration options relevant to that package/session.

---

## Example — Newborn

### Session Configuration
- Age Range → dropdown
- Twins → toggle

---

## Example — Birthday

### Session Configuration
- Twins → toggle
- Cake → toggle
- T-Shirt → toggle

---

## After Save

The package card should display a compact summary.

Example:

> Config: 30–45 Days + Twins + Cake  
> Added Fees: +25 KD

This keeps the order page compact while still visible.

---

# Dynamic Rendering Direction

The order page should NOT hardcode:
- newborn logic
- birthday logic
- twins logic
- age-tier logic

Instead:

package/session type → fetch related configurations → render dynamically

---

# Input Types

Session configurations should support multiple input types.

Examples:

| Input Type | Example |
|---|---|
| toggle | Twins |
| select | Age Range |
| number | Extra Child Count |
| text | Cake Theme |
| counter | Number of Siblings |

This allows the UI to become configuration-driven rather than hardcoded.

---

# Proposed Conceptual Model

Potential conceptual fields:

| Field | Purpose |
|---|---|
| name | Twins |
| code | TWINS_FEE |
| inputType | toggle/select/number/text |
| appliesTo | newborn/birthday/etc |
| pricingMode | fixed/tiered/manual/none |
| required | yes/no |
| affectsPrice | yes/no |
| operationalOnly | yes/no |
| linkedProductId | optional |
| sortOrder | UI ordering |

This is conceptual only and not final schema design.

---

# Pricing Behavior

Configurations may:
- not affect price
- add fixed fees
- add tiered fees
- attach products automatically
- affect operational workflow only

Examples:

| Config | Pricing Mode |
|---|---|
| Twins | Fixed Fee |
| Age Range | Tiered Fee |
| Cake Theme | No Price |
| T-Shirt | Linked Product |

---

# Important Financial Direction

Session configurations should NOT behave like:
- arbitrary invoice edits
- manual accounting adjustments

Instead they should become:
- structured order-level configuration/modifier data

This preserves:
- reporting integrity
- reconciliation integrity
- auditability
- adjustment invoice consistency
- future commission calculations

This aligns with the existing financial hardening and adjustment-invoice architecture direction.

---

# Admin UX Direction

Agreed direction:
- create a separate admin area/page

NOT:
- merge deeply into packages page
- merge deeply into products page
- merge deeply into photo pricing page

because session configurations bridge all three concepts.

---

# Proposed Admin Navigation

## Session Configurations

Separate admin section/page.

Purpose:
- manage session configuration definitions
- choose applicability
- define pricing behavior
- define rendering/input behavior

---

# Example Admin Table

| Name | Applies To | Input Type | Pricing |
|---|---|---|---|
| Twins | Newborn/Birthday | Toggle | +15 KD |
| Age Range | Newborn | Select | Tiered |
| Cake | Birthday | Toggle | Product |
| T-Shirt | Birthday | Toggle | Product |

---

# Relationship Direction

Current preferred direction:

## Primary Scope
Configurations belong primarily to:
- session type
or
- family type

NOT directly to every package individually.

Example:
- all newborn sessions share age-range rules
- all birthday sessions share cake/twins logic

---

# Future Direction

Potential future uses:
- outdoor session fees
- weekend surcharge
- premium setup
- parent shots
- sibling count
- extra photographer
- stylist selection
- theme upgrades

This system should become extensible enough to support future operational growth without major order-page rewrites.

---

# Important Separation

The architecture should separate:

## Configuration Definition
(admin setup)

from:

## Configuration Selection
(employee order usage)

This separation is important for long-term maintainability.

---

# Suggested Naming

Preferred terminology:

> Session Configurations

Avoid:
- “add-ons”
- “fees”
- “extras”

because many configurations are:
- operational only
- not products
- not purely financial

---

# Current Existing Related Areas

Current system already contains:
- Packages page
- Products page
- Photo Pricing page

The new Session Configurations system should integrate with them conceptually while remaining operationally separate.

---

# Non-Goals (Current Scope)

Not currently part of this phase:
- advanced rule engines
- conditional dependency trees
- customer-facing dynamic forms
- fully generic workflow automation
- inventory management
- advanced pricing formulas

The goal right now is:
- operational clarity
- configurable session setup
- structured pricing modifiers
- scalable architecture
- compact employee UX