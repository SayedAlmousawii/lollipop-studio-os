# Customer-Credit + Gift-Voucher Plans — Review Findings

**Status:** OPEN — to be discussed and resolved one by one. Created 2026-06-12.
**Scope:** Edge cases, contradictions, and open questions found reviewing `customer-credit-plan.md` + `gift-voucher-plan.md` against each other and the code. Each finding has a stable ID; resolutions get folded back into the two plan docs as we close them.

Legend: 🔴 high (core use case / correctness) · 🟠 medium · 🟡 low / spec-time. All start **OPEN**.

---

## 🔴 High

### H1 — Customer credit funding a NEW booking's deposit  ⟶ RESOLVED (2026-06-12)
**Decision: YES — credit can fund a new booking's deposit at confirmation** (Option-G-style confirmation variant; FIFO pending hold via `ValueApplication(CUSTOMER_CREDIT)`; deposit invoice issued→settled-by-credit-hold→CLOSED+locked→CONFIRMED). Sub-decisions: **no-show → post hold to breakage** (parity with cash/voucher); **credit < deposit → allow credit + cash top-up** (mixed settlement). Determined by existing principles: **cancel-in-window → void the hold and restore the credit** (return-to-source); credit stays **portable** (only the deposit amount is held, remainder stays ACTIVE — no pool commit, unlike vouchers).
**Cascades:** the "deposit paid" check (`booking.service.ts:864`) must recognize a `ValueApplication` as settlement — generalize to ONE "deposit settled by any source" check shared with vouchers (relates H3, M2). **M2 now applies to credit too** (credit-funded deposit credits to FINAL via effective settlement). Introduces a **credit-breakage** income event (no-show forfeit) — relates M5 (expiry breakage).
Folded into `customer-credit-plan.md` (§2 decisions, new §5 deposit-funding flow, dispositions).

### H2 — Outstanding voucher liability undercounts (internal contradiction)  ⟶ OPEN
Foundation: "voucher = liability until redeemed." But `gift-voucher-plan.md §2` and the §7 invariant define **Outstanding Voucher Liability = Σ `currentBalance` of ACTIVE + RESERVED**. After commit, `currentBalance` = 0 (merged into the case pool), yet that committed-but-**unconsumed** pool value is still a liability (not yet revenue, not yet breakage). The metric drops it → liability understated by all in-flight committed value. Correct formula must add `+ Σ unconsumed GIFT_VOUCHER-origin pool credit`. **Fix the metric definition.**

### H3 — A voucher-funded deposit must not be convertible to customer credit  ⟶ OPEN
Customer-credit issuance (`customer-credit-plan.md §5.1`) keys off "the locked DEPOSIT invoice." If the booking was voucher-backed (Option G), the deposit was funded by a `ValueApplication`, not cash — converting it to customer credit would mint value from nothing. The cash cap *implicitly* saves us (`caseNetCashOverpayment` = 0 for a voucher booking → capped at 0), but: (a) the plan never states the guard, and (b) the UI must route voucher-backed cancellations to **voucher-restore**, not offer "convert to credit." Cross-plan. **Add explicit guard + UI routing rule.**

### H4 — Shared value applications need hold lifecycle + idempotency  ⟶ RESOLVED (2026-06-12)
**Decision: YES — `ValueApplication` becomes the shared reservation/application primitive for customer credit and gift vouchers.** Deposit-funded credit/voucher usage starts as a **PENDING hold**, not an immediately-final draw. The hold later resolves exactly once: **POSTED** (attendance deposit commit, no-show penalty, voucher/customer-credit breakage) or **VOIDED** (cancel-in-window / manager release, which restores the source value). This replaces bespoke restore/unwind paths with one source-agnostic disposition model.

Every financial mutation in the credit/voucher layer must also carry an **idempotency key** enforced by a unique constraint. Examples: credit-funded deposit hold, voucher-funded deposit hold, credit redemption, voucher sale fulfillment, manager void/adjustment/extension where retry safety matters. A duplicate key returns the already-created result or fails as an already-processed operation; it must never create a second draw, second credit, second voucher, or second breakage event.

This is a **Postgres schema/service discipline**, not an integration decision. Do not add TigerBeetle, Formance, Voucherify, Odoo, Medusa, or Square as runtime dependencies. Borrow only the primitives: two-phase holds and idempotency. Folded into `customer-credit-plan.md` and `gift-voucher-plan.md`.

---

## 🟠 Medium

### M1 — Non-cash credit-issuance Payment collides with cash reconciliation  ⟶ OPEN
Issuance settles the REFUND invoice with a `Payment(direction=OUT, method=credit-issuance)`. `caseNetCashOverpayment` sums OUT payments **by direction, no method filter** → it subtracts this non-cash 20, and the **nightly cash reconciliation** may flag a discrepancy (an OUT payment exists but the till never decreased). `customer-credit-plan.md §9` flags "exclude from cash-out reporting" but not the **capacity-math + reconciliation-invariant** interaction. **Define how the non-cash method is treated by `caseNetCashOverpayment` and the reconciliation runner.**

### M2 — DEPOSIT→FINAL credit for a voucher-funded deposit  ⟶ OPEN
At attendance the deposit "credits to FINAL (existing DEPOSIT→FINAL `DocumentApplication`)." That mechanic must credit the deposit's **effective** settlement (the `ValueApplication`), not a cash `paidAmount`. If the existing deposit→final logic reads cash payments only, a voucher-funded deposit credits 0 to FINAL. **Verify/extend the deposit→final credit source.**

### M3 — Voucher expiry while RESERVED  ⟶ OPEN
A voucher reserved to a future booking can hit its 1-year-from-purchase expiry **before the session**. Does reservation freeze expiry? Does the booking become unsecured at expiry? Must the session occur before expiry? Undefined in `gift-voucher-plan.md`. **Decision needed.**

### M4 — Lazy expiry breaks liability metrics AND breakage timing (cross-plan)  ⟶ OPEN
Both plans use lazy expiry ("no background job"). Consequences: (a) any "Σ where status=ACTIVE" liability metric includes expired-but-not-yet-flipped rows — must also filter `expiresAt > now`; (b) "breakage recognized at the event" has **no event** for expiry without a sweep. Architecture §5 allows a nightly reconciliation workflow, but neither plan says expiry breakage is recognized there. **Define expiry-recognition timing (lazy-on-read vs nightly sweep) for both credit and vouchers.**

### M5 — Expired customer-credit value accounting is undefined  ⟶ OPEN
`customer-credit-plan.md` has an `EXPIRED` status but never says what happens to the value (studio keeps it → should be breakage income, paralleling vouchers) or when. The cancelled-deposit→credit→expiry path eventually recognizes the original deposit cash as income, just deferred up to a year. **Define expired-credit value accounting (parity with voucher breakage).**

### M6 — Case-closure breakage risks premature recognition  ⟶ OPEN
Forfeiting leftover voucher pool credit at "job delivered / receivables settled" (`gift-voucher-plan.md §6.7`) is risky if a post-delivery **ADJUSTMENT** can still arrive — you'd recognize breakage, then need to claw it back to fund the ADJ. Trigger is flagged open; the **premature-recognition hazard** specifically should drive a conservative trigger. **Pin the closure trigger conservatively.**

---

## 🟡 Low / spec-time

### L1 — Mixed-source reversal attribution inconsistent between plans  ⟶ OPEN
Voucher plan defines it ("non-cash first"); customer-credit plan defers it ("re-credit on later reversal — likely out of v1"). Same rule should govern both. **Unify.**

### L2 — Polymorphic `ValueApplication.sourceId` has no DB FK  ⟶ OPEN
Diverges from the master plan's "financial records use strong FK / RESTRICT." Conscious tradeoff; wants an app-layer integrity guard (or a documented exception). **Note the mitigation.**

### L3 — No terminal status for a voucher depleted to 0 by no-shows  ⟶ OPEN
Sits ACTIVE/0; enum has no `DEPLETED`/`REDEEMED`. Already flagged in the voucher plan's open items. **Add a status or define handling.**

### L4 — Partial-use voucher refund undefined  ⟶ OPEN
`gift-voucher-plan.md §3` only covers "unused" voucher refund. Refund of a partially-used voucher (balance reduced by a no-show) is undefined. **Define or explicitly disallow.**

### L5 — FIFO tiebreak + partial-VOID semantics  ⟶ OPEN
Customer-credit FIFO needs a tiebreak for equal `expiresAt` (e.g. `createdAt`). Partial-VOID of a partially-spent credit (void only the remaining) is unspecified. **Specify at spec time.**

---

## Resolution log
- **H4 — RESOLVED 2026-06-12.** Shared `ValueApplication` gets a two-phase hold lifecycle (`PENDING -> POSTED|VOIDED`) plus unique idempotency keys for credit/voucher money movements. Updated `customer-credit-plan.md`, `gift-voucher-plan.md`, and `credit-settlement-application-plan.md`.
- **H1 — RESOLVED 2026-06-12.** Credit can fund a new booking's deposit (confirmation variant, FIFO pending hold). No-show → post hold to breakage; credit < deposit → credit + cash top-up; cancel-in-window → void hold and restore credit; credit stays portable (no commit). Updated `customer-credit-plan.md`. Cascades into H3/M2 (shared deposit-settled-by-any-source check) and M5 (credit breakage).
