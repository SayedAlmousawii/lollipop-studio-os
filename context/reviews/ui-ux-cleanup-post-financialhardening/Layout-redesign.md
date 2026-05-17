Sales Workspace Layout Redesign Notes

Purpose

These notes define the intended direction for the Sales/Order workspace layout after the introduction of:

* locked invoices
* adjustment invoices
* deposits
* credit flows
* future refunds/credits

The current invoice-centric UI is becoming difficult for employees to understand because operational truth and accounting document history are now different concepts.

The goal of this redesign is to separate:

* operational/customer-facing truth
* deliverable/production truth
* payment/balance truth
* raw accounting documents

without exposing accounting implementation details directly in the main operational workflow.

⸻

Core UX Direction

The Sales page should no longer behave like:

“single invoice details page”

Instead, it should behave like:

“effective order + payment workspace”

Invoices become supporting financial documents rather than the primary UI structure.

The screen should be divided into:

* LEFT SIDE → operational composition + deliverables
* RIGHT SIDE → payment/balance summary + financial references

⸻

LEFT SIDE — Operational Truth

Purpose

The left side represents:

“What the customer currently owns”

This is the effective final composition after combining:

* original final invoice
* adjustment invoices
* reductions
* swaps
* upgrades
* add-ons
* extra photos

The user should NOT need to understand:

* invoice chains
* adjustment delta math
* accounting snapshots
* negative invoice rows

The UI should derive a clean merged composition.

⸻

Section 1 — Current Order Composition

Goal

Display a human-readable merged pricing composition.

This is customer-facing and employee-facing.

The section should show:

* final package
* upgrades
* add-ons
* extra photos
* album upgrades
* canvas upgrades
* quantity
* prices

The section should resemble a clean invoice-style pricing breakdown, but derived from the effective merged state rather than raw invoice documents.

⸻

Example Structure

Current Order Composition

Package

* Premium Package — 250 KD

Upgrades

* Album Upgrade: 30×30 → Leather Album (+35 KD)
* Canvas Upgrade: 40×60 → 60×90 (+25 KD)

Extra Photos

* 5 Extra Prints — 15 KD
* 3 Extra Digitals — 6 KD

Add-ons

* Canvas 40×60 — 35 KD
* USB Box — 20 KD

⸻

Current Composition Total

351 KD

⸻

Important Rules

Rule — No raw adjustment math rows

Do NOT expose rows such as:

* “Album 30x30 to Album 20x20”
* “2 × -20 KD”
* “Album 30x30 to Album 30x30”

These are accounting implementation details.

Instead, upgrades/swaps should be rendered as:

Album Change

* From: Album 30×30
* To: Leather Album
* Adjustment: +35 KD

⸻

Rule — Hide meaningless zero-delta rows

Rows with:

* 0 KD
* no operational meaning
* duplicate before/after values

should not appear in the operational composition UI.

⸻

Section 2 — Deliverables

Purpose

This section represents:

“What the studio must deliver”

This is operational truth for:

* production
* editing
* delivery
* packaging
* pickup

This section should NOT focus on pricing.

It should focus purely on deliverables.

⸻

Example Structure

Deliverables

* 1 Premium Leather Album
* 1 Canvas 60×90
* 25 Edited Photos
* 5 Printed Photos
* USB Box

⸻

Important Principle

Deliverables are NOT the same as invoice rows.

The deliverables section should represent the final effective operational output after all adjustments and upgrades.

⸻

RIGHT SIDE — Payment & Financial Summary

Purpose

The right side represents:

“What the customer owes, paid, and why”

This page is NOT intended to be accountant-focused.

The right side should help employees:

* explain balances to customers
* understand payment state quickly
* understand effective pricing totals
* access invoices when needed

without exposing raw accounting complexity.

⸻

Section 1 — Payment Summary

Goal

Provide a fast, highly readable balance overview.

This should be the most visually prominent section.

⸻

Example Structure

Payment Summary

Effective Total

316 KD

Paid

316 KD

Remaining

0 KD

⸻

Breakdown

* Deposit Applied: 20 KD
* Final Invoice: 258 KD
* Adjustments: +58 KD

⸻

Important Principle

Employees should NOT need to manually calculate:

* adjustment totals
* paid amounts
* remaining balance
* invoice relationships

The system should derive and present this clearly.

⸻

Section 2 — Current Pricing Breakdown

Purpose

Employees still need visibility into:

* why the total equals its current value
* what pricing changes occurred
* what customer is being charged for

However, this should be represented as:

merged effective pricing composition

NOT:

raw invoice line items

⸻

Example Structure

Current Pricing Breakdown

* Premium Package ………… 250 KD
* Extra Prints (5) ………. 15 KD
* Canvas 40×60 ………….. 35 KD
* Album Upgrade …………. 16 KD

⸻

Total

316 KD

⸻

Important Rule

Do NOT show:

* raw adjustment invoice rows
* negative accounting delta rows
* snapshot-only invoice rows
* invoice-chain math

This section should feel like a clean merged pricing breakdown.

⸻

Section 3 — Linked Financial Documents

Purpose

Raw invoices should still be accessible when needed.

However:

* invoice numbers
* accounting documents
* adjustment chains

should NOT dominate the operational workspace.

Instead, they should exist as secondary/supporting references.

⸻

Example Structure

Financial Documents

* DEP-00001
* INV-00002
* ADJ-00003

Each item should:

* be clickable
* open invoice detail page
* optionally show type/status badge

⸻

Important Principle

Invoices are supporting financial records.

They are no longer the primary operational UI structure.

The operational page should focus on:

* effective ownership
* deliverables
* balance/payment state

while raw accounting documents remain accessible separately.

⸻

Adjustment Workspace Direction

The adjustment workspace button should remain accessible, but with clearer context.

Example helper text:

“This sale is finalized. New changes will be staged as adjustments.”

The button should not feel disconnected from the financial workflow.

⸻

Overall Architectural UX Direction

The system is evolving from:

invoice-centric UI

into:

effective-state operational UI

This is necessary because the financial architecture now supports:

* deposits
* locked finals
* adjustments
* future refunds
* credits
* multiple financial documents

As a result:

* raw invoices are no longer operational truth
* effective merged composition becomes the primary operational truth
* deliverables become their own operational concern
* payment summary becomes its own operational concern

The UI should reflect these separations clearly.