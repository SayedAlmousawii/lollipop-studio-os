## Goal

**Investigation only — no production code changes.** Phase G reconciliation surfaced an `INV-18` mismatch on order `cmp6tm9n30007n7t3ramturmp` in dev: the order's package + add-on total is 230 KD, but the sum of revenue documents (FINAL, ADJUSTMENT, CREDIT_NOTE, applied DocumentApplications) totals 225 KD — a 5 KD gap. Decide whether this is:

- (A) **Historical drift** from pre-Feature-77 data that survived migration but is no longer reachable by current code paths, or
- (B) **An active divergence** caused by a still-present bug in the financial pipeline.

The output of this spec is a written finding, an updated roadmap entry for F6, and (if B) a minimal repro test added to the invariant suite. Any *fix* lands in Sprint 4 — this spec is a fork in the road, not a code change.

---

## Read First

- `context/reviews/77-post-verification-hardening-roadmap.md` — F6
- `context/reviews/77-financial-risk-report.md` — INV-18 origin
- Phase G reconciliation runner — the source that reported the mismatch
- `src/modules/financial/invariants.ts` — INV-18 definition
- `src/modules/invoices/invoice.calculation.ts` — canonical revenue composition

---

## Rules

- **No data mutation.** Read-only investigation against dev DB.
- **No auto-repair.** Even if the fix looks trivial, document and defer to Sprint 4. Auto-repair before understanding root cause risks masking a real bug.
- The investigation must end with one of three written outcomes: "Historical drift, no active bug," "Active bug — root cause identified, repro test added," or "Inconclusive — needs production data to resolve." No fourth option.

---

## Scope

### In Scope

**Step 1 — Reproduce locally**

Run the reconciliation runner against dev DB. Confirm `cmp6tm9n30007n7t3ramturmp` still mismatches 230 vs 225. Capture the exact INV-18 output.

**Step 2 — Enumerate the order's financial composition**

For order `cmp6tm9n30007n7t3ramturmp`:

- List every invoice row (id, type, status, totalAmount, isLocked, createdAt) including DEPOSIT, FINAL, ADJUSTMENT, CREDIT_NOTE, REFUND.
- For each invoice, list every PaymentAllocation (paymentId, amount, allocatedAt).
- For each invoice, list every DocumentApplication where it is target or source (sourceDocId, targetDocId, amountApplied, appliedAt).
- List every OrderActivity entry for the order (type, title, createdAt, metadata).
- List the order's packages, packageItemUpgrades, orderAddOns with current and snapshot prices.

Save the raw output to `context/reviews/77-f6-investigation-data.md`.

**Step 3 — Compare against the invariant**

INV-18 expects: `sum(FINAL.totalAmount + ADJUSTMENT.totalAmount - CREDIT_NOTE.totalAmount) == order.totalAmount`. Walk through the actual numbers and identify which side of the equation is off and by how much (the 5 KD).

Likely candidates to inspect:
- A CREDIT_NOTE issued without corresponding line-item removal on the order
- An ADJUSTMENT whose total was edited after issuance (pre-78a, no DB lock)
- A historical pre-DocumentApplication-cutover row that the migration missed
- An add-on whose snapshot price diverged from the line-item price at insertion time

**Step 4 — Determine drift vs active**

For each invoice / allocation / application involved in the 5 KD discrepancy, inspect its `createdAt` against the Feature 77 cutover commit (`74e-financial-rearch-phase-1-cutover-and-reconciliation`). If every row predates the cutover and current code paths cannot reproduce the shape, classify as **historical drift**.

If any row postdates the cutover, or current code can reproduce the shape via service paths, classify as **active divergence** and write a failing repro test in `tests/financial/inv-18-regression.test.ts` that reproduces the divergence under the current code.

**Step 5 — Write the finding**

`context/reviews/77-f6-investigation-finding.md` — short doc covering:
- Reproducible commands (the queries used)
- The exact 5 KD breakdown
- Classification: drift / active / inconclusive
- If active: pointer to the failing repro test
- Recommended Sprint 4 fix shape (one paragraph)

**Step 6 — Update the roadmap**

Add a one-line note under F6 in `77-post-verification-hardening-roadmap.md` pointing at the finding doc. If the classification is "drift," Sprint 4's fix is a one-shot dev-data migration; if "active," Sprint 4 fixes the underlying code path and backfills.

### Out of Scope

- Any code fix to the financial pipeline. That is Sprint 4.
- Production data inspection — investigation runs against dev. If dev is inconclusive, the finding doc says so and Sprint 4 begins with a production-data inspection step.
- Repairs to the offending row in dev. Leave it in place so the invariant continues to flag it until the Sprint 4 fix lands.
- Generalizing to other potential INV-18 mismatches. Scope is exactly `cmp6tm9n30007n7t3ramturmp`. If the investigation surfaces other orders, list them in the finding doc but do not chase.

---

## Implementation Direction

**Risk:** None — investigation only.

**Order of work:** Steps 1–6 sequentially. Step 4's classification gates whether step 5's finding mentions an active bug.

**Why this matters for Sprint 1:** F6's classification determines whether vouchers and other Phase 4 work land on a financial substrate with a known dormant bug, or a known historical artifact. Both are acceptable; mistaking one for the other is not. The investigation completes in Sprint 1 so Sprints 2–3 don't unknowingly build on a divergent foundation.

---

## Verification

- `context/reviews/77-f6-investigation-data.md` exists and contains the raw composition dump.
- `context/reviews/77-f6-investigation-finding.md` exists and ends with one of the three approved classifications.
- If "active": a failing repro test exists at `tests/financial/inv-18-regression.test.ts` and the test reproduces the 5 KD gap under current code.
- The roadmap's F6 line links to the finding doc.

---

## Post-Implementation

- Update `context/reviews/77-post-verification-hardening-roadmap.md` F6 row with the classification.
- If classified "active," ensure Sprint 4's F6 item references the repro test and root-cause analysis.
- Update `progress-tracker.md`.
