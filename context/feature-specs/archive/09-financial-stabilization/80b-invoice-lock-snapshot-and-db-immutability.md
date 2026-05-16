## Goal

Add `InvoiceLockSnapshot` (a per-lock-event frozen copy of an invoice's key fields) and a DB-level `BEFORE UPDATE` trigger on `Invoice` that rejects any mutation of frozen fields while `isLocked = true`. Today, locked-invoice immutability is enforced only at the service layer; Phase F's EC-27 proved direct Prisma can mutate `totalAmount` and even unset `isLocked` on a locked row. With 78a closing the race window and 80a recording who-did-what, this spec closes the *what-changed* leg: the DB itself becomes the last line of defense, and `InvoiceLockSnapshot` provides the at-lock baseline for any divergence audit.

Closes roadmap item **F3**.

---

## Read First

- `context/reviews/77-post-verification-hardening-roadmap.md` — §2 F3, §11 F3
- `context/reviews/77-phase-f-concurrency-security-recovery-review.md` — EC-27 walkthrough
- `prisma/schema.prisma:654` — `Invoice`
- `src/modules/payments/payment.service.ts:312` — `closeInvoiceIfSettled` (the lock-write site)
- `context/feature-specs/78a-settlement-transaction-row-lock-and-auto-lock.md` — companion spec defining lock entry
- `context/feature-specs/80a-audit-log-model-and-service.md` — `recordAuditLog`, used in this spec for unlock attribution

---

## Rules

- An `InvoiceLockSnapshot` row is written **inside the same transaction** that flips `Invoice.isLocked` from `false` to `true`. The snapshot is the canonical at-lock state; the live `Invoice` row may diverge over time only for non-frozen fields.
- The set of *frozen fields* (fields that cannot change while `isLocked = true`) is:
  - `totalAmount`
  - `invoiceType`
  - `parentInvoiceId`
  - `financialCaseId`
  - `jobId`
  - `orderId`
  - `invoiceNumber`
  - `publicId`
- The set of *mutable-while-locked* fields (necessary for downstream mechanics):
  - `status` (transitions like `ISSUED → CLOSED`)
  - `remainingAmount`, `paidAmount` (derived recomputations)
  - `closedAt`
  - `isLocked` itself (only `true → false`, via the sanctioned unlock path; see below)
- The `BEFORE UPDATE` trigger raises an exception if `OLD.isLocked = true AND` any frozen field changed. The exception aborts the transaction.
- Unlocking is a special path: an UPDATE that sets `NEW.isLocked = false` is permitted *only if* the same UPDATE leaves frozen fields unchanged. There is no service-level helper for unlocking yet — adding one is out of scope. The trigger permits the operation so that future tooling (or operator hotfix) is not blocked at the DB level.
- The trigger is **enabled in all environments** including local dev. There is no GUC bypass. If a future migration legitimately needs to touch a frozen field on a locked row, it must explicitly unlock the row inside the same migration transaction, mutate, and re-lock.

---

## Scope

### In Scope

**Schema**

```prisma
model InvoiceLockSnapshot {
  id                String    @id @default(cuid())
  invoiceId         String
  lockedAt          DateTime  @default(now())
  lockedByUserId    String?
  totalAmount       Decimal   @db.Decimal(10, 3)
  invoiceType       InvoiceType
  parentInvoiceId   String?
  financialCaseId   String
  jobId             String
  orderId           String?
  invoiceNumber     String
  publicId          String

  invoice Invoice @relation(fields: [invoiceId], references: [id], onDelete: Cascade)

  @@index([invoiceId, lockedAt])
  @@map("invoice_lock_snapshots")
}
```

Multiple snapshots per invoice are intentional — if an invoice is unlocked and re-locked (rare, future operator action), each lock event produces a new snapshot.

**Trigger migration (raw SQL)**

```sql
CREATE OR REPLACE FUNCTION reject_frozen_field_mutation_on_locked_invoice()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."isLocked" = true THEN
    IF NEW."totalAmount" <> OLD."totalAmount"
       OR NEW."invoiceType" <> OLD."invoiceType"
       OR NEW."parentInvoiceId" IS DISTINCT FROM OLD."parentInvoiceId"
       OR NEW."financialCaseId" <> OLD."financialCaseId"
       OR NEW."jobId" <> OLD."jobId"
       OR NEW."orderId" IS DISTINCT FROM OLD."orderId"
       OR NEW."invoiceNumber" <> OLD."invoiceNumber"
       OR NEW."publicId" <> OLD."publicId"
    THEN
      RAISE EXCEPTION 'Frozen field mutation on locked invoice % is not permitted', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reject_frozen_field_mutation_on_locked_invoice
BEFORE UPDATE ON "Invoice"
FOR EACH ROW
EXECUTE FUNCTION reject_frozen_field_mutation_on_locked_invoice();
```

Ship as a non-Prisma raw migration (`prisma migrate dev --create-only` then hand-edit). Down migration drops the trigger and function.

**Snapshot write on lock**

Extend `closeInvoiceIfSettled` (payment.service.ts:312) and any other path that sets `isLocked = true`. After the `updateMany` that flips the lock, in the same transaction:

```ts
if (updateResult.count > 0) {
  await client.invoiceLockSnapshot.create({
    data: {
      invoiceId: invoice.id,
      lockedByUserId: actorContext.actorUserId,
      totalAmount: invoice.totalAmount,         // pre-lock read; safe because the row is row-locked
      invoiceType: invoice.invoiceType,
      parentInvoiceId: invoice.parentInvoiceId,
      financialCaseId: invoice.financialCaseId,
      jobId: invoice.jobId,
      orderId: invoice.orderId,
      invoiceNumber: invoice.invoiceNumber,
      publicId: invoice.publicId,
    },
  });
  await recordAuditLog(client, actorContext, {
    entityType: AuditEntityType.INVOICE,
    entityId: invoice.id,
    action: AuditAction.INVOICE_LOCKED,
    after: { lockedAt: new Date().toISOString() },
  });
}
```

`recordAuditLog` already lands in 80a. This spec assumes 80a is merged.

**Reconciliation invariant**

Register in `src/modules/financial/invariants.ts`:

```ts
{
  name: 'locked-invoice-frozen-fields-match-snapshot',
  scope: 'global',
  description: 'For every Invoice with isLocked=true, the latest InvoiceLockSnapshot must have matching frozen-field values.',
}
```

This invariant runs in the nightly reconciliation pass. With the trigger in place, this invariant should *never* trip on a clean install — it exists as a belt-and-suspenders check against direct DB tampering or migration mistakes.

**Regression tests**

`tests/financial/locked-invoice-immutability.test.ts`:

- Test A: lock a FINAL via 78a path → confirm one `InvoiceLockSnapshot` row exists with matching frozen fields and one `AuditLog` row with `action = INVOICE_LOCKED`.
- Test B: attempt to mutate `totalAmount` on a locked invoice via direct Prisma update → throws (Prisma surfaces the `check_violation`).
- Test C: attempt to mutate `invoiceNumber` on a locked invoice → throws.
- Test D: mutate `status` (`ISSUED → CLOSED`) on a locked invoice → succeeds. (`status` is mutable-while-locked.)
- Test E: update `isLocked` from `true` to `false` on a locked invoice with no other field changes → succeeds. (Sanctioned unlock path.)
- Test F: update `isLocked` from `true` to `false` AND `totalAmount` in the same UPDATE → throws. (The unlock cannot smuggle frozen-field changes.)
- Test G: nightly reconciliation against a clean dev DB → invariant `locked-invoice-frozen-fields-match-snapshot` reports zero violations.

### Out of Scope

- DB-level append-only enforcement of `AuditLog` (rejecting UPDATE/DELETE on audit_logs) — Sprint 4 cleanup. The trigger pattern from this spec is the template.
- A sanctioned service-layer `unlockInvoice` helper — operator-only workflow; defer until first operational need.
- Backfill of `InvoiceLockSnapshot` rows for already-locked invoices created before this spec. With 78a and prior `closeInvoiceIfSettled` paths, most locked rows in dev are recent; the invariant will surface any pre-existing locked rows without snapshots and a one-shot script can fill them. The fill script is out of this spec.
- DB-level over-collection (C2) and ADJUSTMENT-chain (C3) constraints — **80c**.
- Generalizing the trigger pattern to other tables — case-by-case in later specs.

---

## Implementation Direction

**Risk:** Medium-high. The trigger touches the most-trafficked write surface in the system. A bug or overly-restrictive predicate breaks *every* invoice update. The mutable-while-locked field list must be exhaustive.

**Order of work:**

1. Land 80a first (`AuditLog` + `recordAuditLog`). 80b's snapshot writer calls it.
2. Migration: create `InvoiceLockSnapshot`. Apply. No behavior change yet.
3. Wire `closeInvoiceIfSettled` snapshot write. Add Test A. Run full payment + invoice suites — confirm zero regressions.
4. Migration: install the trigger. Run full suite again — this is where overly-restrictive predicates surface as cascading test failures. Fix the field list, not the test.
5. Add Tests B–F. Confirm all pass.
6. Register the invariant. Add Test G.

**Why disallow GUC bypass:** every "temporarily disable the safety" path I have ever seen gets accidentally left on. If a migration needs to touch a frozen field, it should unlock-mutate-relock explicitly, in writing. The auditability comes for free.

**Why ship the snapshot writer before the trigger:** if the trigger goes in first, every lock attempt that hasn't yet wired the snapshot writer raises — full system halt on payments. Snapshot writer first, trigger second.

**Why an audit invariant when the trigger exists:** the trigger blocks normal application writes. The invariant catches: direct `psql`, future migrations that mishandle the lock state, replication bugs, and restore-from-backup edge cases. Belt-and-suspenders.

**Rollback:** drop trigger first (re-enables loose updates immediately), then drop snapshot table. Existing snapshot rows are lost on rollback — acceptable, as the trigger was the primary enforcement.

---

## Verification

- All seven regression tests pass.
- All existing tests pass.
- `npm run build` passes.
- `npm run lint` passes.
- Manual: as MANAGER, settle a FINAL via POS → confirm `invoice_lock_snapshots` row created, `audit_logs` row created.
- Manual: from `psql`, attempt `UPDATE "Invoice" SET "totalAmount" = "totalAmount" + 1 WHERE id = '<locked-id>'` → fails with `check_violation`.
- Manual: from `psql`, attempt `UPDATE "Invoice" SET "isLocked" = false WHERE id = '<locked-id>'` → succeeds (sanctioned unlock).
- Manual: same UPDATE combining unlock + `totalAmount` change → fails.
- Nightly reconciliation reports zero violations of `locked-invoice-frozen-fields-match-snapshot`.

---

## Post-Implementation

- Update `context/reviews/77-post-verification-hardening-roadmap.md`: mark F3 as completed.
- Update `progress-tracker.md`.
- Cross-reference: when Sprint 4 / Phase 4 (vouchers) introduces new invoice writers, those paths must call the lock helper, not write `isLocked` directly. Add a note to the voucher feature spec.
