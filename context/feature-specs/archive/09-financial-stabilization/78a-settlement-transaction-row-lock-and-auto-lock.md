## Goal

Close the two coupled race-and-mutation hazards exposed by the Feature 77 review: (1) `recordPayment()` reads invoice balance outside of a row-level lock, so double-click and final-1% races can over-allocate or double-allocate; and (2) when the final cent settles a FINAL invoice in POS, the invoice stays unlocked until staff manually closes it — during that window QA reproduced direct `Invoice.totalAmount` mutation (210 → 275 KD) instead of an ADJUSTMENT.

This spec wraps balance-read, payment-write, recalculation, and lock-on-settlement of FINAL invoices into a single transaction that holds a `SELECT … FOR UPDATE` lock on the target invoice row. Solves roadmap items **F1**, **C1**, **W4** (single-step settlement), and **O3** (no more "Fully Paid + Draft" misleading display).

---

## Read First

- `context/reviews/77-post-verification-hardening-roadmap.md` — §2 F1, §4 C1
- `src/modules/payments/payment.service.ts:179` — `recordPayment` entry point
- `src/modules/payments/payment.service.ts:193` — `recordPaymentWithClient` (the body that needs the lock)
- `src/modules/payments/payment.service.ts:312` — `closeInvoiceIfSettled` (the existing lock path — already locks at `remainingAmount=0`, but only when status is not `DRAFT`)
- `src/modules/invoices/invoice.service.ts` — invoice status / lock transitions

---

## Rules

- `recordPaymentWithClient` must acquire a `SELECT … FOR UPDATE` lock on the target invoice row **before** reading payments/allocations/applications. The lock must be held until the transaction commits.
- Auto-lock applies only to **FINAL** invoices reaching `remainingAmount = 0`. DEPOSIT, ADJUSTMENT, CREDIT_NOTE, and REFUND retain their current close-on-settlement behavior (already covered by `closeInvoiceIfSettled`).
- A FINAL invoice in `DRAFT` status that reaches `remainingAmount = 0` must auto-transition: `DRAFT → ISSUED → CLOSED + isLocked=true` in the same transaction. The current "manual close" intermediate step is removed for FINAL.
- The auto-lock side effect is purely a *consequence* of full payment — there is no new public API for "lock now." Existing explicit lock paths (e.g. for ADJUSTMENT/CREDIT_NOTE flows) remain unchanged.
- If the locked transaction would violate over-collection (`sum(allocations) > totalAmount` after applying the new payment), the transaction aborts. This is the in-service half of C2 — DB-level prevention is a separate spec (Sprint 3).
- `withRetry` continues to wrap the transaction, so Prisma serialization retries still apply.

---

## Scope

### In Scope

**Row-level lock acquisition**

Replace the current first read in `recordPaymentWithClient`:

```ts
const invoice = await client.invoice.findUnique({
  where: { id: invoiceId },
  include: { /* … */ },
});
```

with a raw lock query at the top of the transaction body, then re-read with the existing include:

```ts
// Acquire row-level lock — must be the first DB read inside the tx.
await client.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
const invoice = await client.invoice.findUnique({
  where: { id: invoiceId },
  include: { /* unchanged */ },
});
```

The lock targets a single row by primary key — there is no scan, no deadlock window beyond the transaction itself.

**Auto-lock FINAL at `remainingAmount = 0`**

Extend `closeInvoiceIfSettled` so the `status === InvoiceStatus.DRAFT` skip no longer applies to FINAL invoices. For FINAL specifically, when `remainingAmount = 0`:

- If status is `DRAFT`, transition `DRAFT → ISSUED → CLOSED` in one `updateMany`.
- Set `isLocked = true` and `closedAt = now()` in the same write.
- Emit the existing `InvoiceAdjusted` / "Invoice settled" activity entry.

A FINAL invoice that legitimately needs to stay in DRAFT (e.g., still being composed by staff) will never reach `remainingAmount = 0` in the first place, because we don't accept payments against it until it has line items. So the "DRAFT skip" was protecting against an unreachable state for FINAL — safe to remove.

For DEPOSIT, ADJUSTMENT, CREDIT_NOTE, REFUND: keep the existing DRAFT skip; their lifecycle does not flip through DRAFT-into-CLOSED.

**Activity log**

The settlement activity entry already exists in `recordPaymentWithClient` (around line 277, the `INVOICE_ADJUSTED` branch on `justClosed`). No new activity types — the existing "Invoice settled" copy covers FINAL too.

**Verification helper**

Add an integration test `tests/payments/settlement-transaction.test.ts`:

- Test A: two concurrent `recordPayment` calls for the same invoice each paying the full remaining amount → exactly one succeeds, the other throws "No outstanding balance remains."
- Test B: FINAL invoice with `totalAmount = 230`, paid 229 in step 1, paid 1 in step 2 → after step 2, invoice is `status = CLOSED, isLocked = true`.
- Test C: FINAL in `DRAFT` with one line item (`totalAmount = 230`), paid 230 in one call → after the call, invoice is `status = CLOSED, isLocked = true`.
- Test D: attempt to overpay (`totalAmount = 230`, prior paid 200, new payment 50) → throws "Payment amount cannot exceed the remaining invoice balance"; no payment row written.

Tests use the existing `tests/fixtures/financial.ts` builders. Concurrency test uses `Promise.all` on two `recordPayment` calls — sufficient under SQLite/Postgres test container with serializable isolation.

**Invariant registration**

In `src/modules/financial/invariants.ts` (or wherever invariants are registered), add:

```ts
registerInvariant({
  name: 'final-invoice-fully-paid-must-be-locked',
  scope: 'global',
  run: /* every FINAL with remainingAmount = 0 has isLocked = true and status = CLOSED */,
});
```

This invariant fires in the nightly reconciliation pass; any historical row that doesn't satisfy it surfaces in F6's investigation output.

### Out of Scope

- **F3** DB-level locked-invoice immutability (trigger / UPDATE policy) — Sprint 3.
- **C2** DB-level over-collection CHECK constraint — Sprint 3.
- **C3** DB-level ADJUSTMENT-chain CHECK — Sprint 3.
- **W2 / O4** Manager-prompt UX on reductive locked edits — Sprint 2.
- **Backfill** of any historical FINAL invoices that are fully paid but not locked. Handled by F6's investigation — if such rows exist, a one-shot migration covers them; if not, the invariant catches future regressions.
- The DEPOSIT / ADJUSTMENT / CREDIT_NOTE / REFUND close behavior — not touched.

---

## Implementation Direction

**Risk:** Medium. The lock change is small and targeted, but `recordPayment` is the most-trafficked financial entry point in the system. A bug here corrupts payment recording.

**Order of work:**

1. Add the `SELECT … FOR UPDATE` line and re-run the existing payment test suite to confirm no regression in single-caller paths.
2. Add the concurrency test (Test A) — it should fail today, pass after the lock lands.
3. Extend `closeInvoiceIfSettled` for FINAL auto-lock — add Tests B and C.
4. Run nightly reconciliation invariant locally; confirm zero violations on dev data.

**Why one transaction, not two:** the current code already wraps `recordPaymentWithClient` in `db.$transaction`. The lock just needs to be the first statement inside that transaction. We are not adding a new transaction boundary — we are tightening the existing one.

**Rollback:** Revert the two changes (the `SELECT … FOR UPDATE` line and the `closeInvoiceIfSettled` FINAL branch). No data corruption: locked FINAL invoices that were locked under this code path remain valid; they would just not have been auto-locked under the old code. Manual close was always available as a fallback.

**Dependency note:** S1+S2 (78b) is independent of this spec but lands in the same sprint. If 78b merges first, this spec inherits the new required `actorRole`; if this spec merges first, `actorContext` remains optional and 78b retrofits it. Either order is safe.

---

## Verification

- New concurrency / settlement test suite passes (`tests/payments/settlement-transaction.test.ts`).
- Existing payment test suite passes unchanged.
- Manual: POS settlement of a FINAL with `remainingAmount = 0.001` left → final payment auto-locks the invoice; "Close invoice" button no longer needed.
- Manual: attempt to mutate `Invoice.totalAmount` on a just-auto-locked FINAL via the order edit path → blocked by existing classifier; ADJUSTMENT prompted (this is the live-staff hazard F1 was protecting against).
- Nightly reconciliation reports zero violations of `final-invoice-fully-paid-must-be-locked`.
- `npm run build` passes.
- `npm run lint` passes.

---

## Post-Implementation

- Update `context/reviews/77-post-verification-hardening-roadmap.md`: mark F1, C1, W4, O3 as completed.
- Update `progress-tracker.md`.
