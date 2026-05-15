## Goal

Introduce an `AuditLog` model and service that records actor attribution and before/after state for every booking-, financial-, and lock-scoped action that today is either unrecorded or recorded only as a free-form `OrderActivity` description. Phase F review surfaced this as the highest-impact gap blocking immutability proofs (INV-14), commission persistence, the accountant reporting view, and external integrations — all of which need a stable, queryable audit surface. The existing `OrderActivity` table covers order-scoped narrative events; `AuditLog` is the structured-state companion for cross-entity changes.

Closes roadmap items **A1** and **S4**.

---

## Read First

- `context/reviews/77-post-verification-hardening-roadmap.md` — §1 (no AuditLog), §5 A1, §4 S4, §11 (A1 gating)
- `context/reviews/77-phase-f-concurrency-security-recovery-review.md` — risk §B/§D actor-attribution gaps
- `prisma/schema.prisma:590` — `OrderActivity` (the shape-template; this spec adds a sibling, not a replacement)
- `src/modules/orders/order-activity.service.ts` — `recordOrderActivity` (the write-pattern to mirror)
- `src/lib/auth/actor-context.ts` — `ActorContext` (every audit write requires one)
- `src/lib/auth/assert-actor-permission.ts` — created in 78b (every audit-recording call site is already inside an authorized path)

---

## Rules

- Every write to `AuditLog` requires a non-null `actorUserId` — sourced from the same `ActorContext` that 78b made required. No anonymous audit entries.
- `AuditLog` is **append-only**. No update or delete on the table from application code. Schema-level prevention is a stretch goal in 80b's trigger spec — for now, code-level discipline plus the absence of any update/delete helper in `audit-log.service.ts`.
- `before` and `after` are JSON snapshots of the affected entity at field granularity — only the changed fields, not the whole row. Snapshots use the same JSON encoding as `OrderActivity.metadata` (Prisma `Json`).
- Every audit write is co-transactional with the action it records. If the action's transaction rolls back, the audit entry rolls back with it. No background "audit later" path.
- The set of audited actions in this spec is finite and listed in Scope. Future actions extend the list; this spec does not retroactively audit historical events.

---

## Scope

### In Scope

**Schema**

```prisma
model AuditLog {
  id          String        @id @default(cuid())
  actorUserId String
  entityType  AuditEntityType
  entityId    String
  action      AuditAction
  before      Json?
  after       Json?
  context     Json          @default("{}")  // optional: orderId, financialCaseId, requestId, etc.
  occurredAt  DateTime      @default(now())

  actor User @relation(fields: [actorUserId], references: [id], onDelete: Restrict)

  @@index([entityType, entityId, occurredAt])
  @@index([actorUserId, occurredAt])
  @@index([action, occurredAt])
  @@map("audit_logs")
}

enum AuditEntityType {
  INVOICE
  PAYMENT
  ORDER
  BOOKING
  FINANCIAL_CASE
  CREDIT_NOTE
  REFUND
}

enum AuditAction {
  INVOICE_LOCKED
  INVOICE_UNLOCKED
  INVOICE_TOTAL_MUTATED
  PAYMENT_RECORDED
  PAYMENT_REFUNDED
  CREDIT_NOTE_ISSUED
  ADJUSTMENT_ISSUED
  REFUND_ISSUED
  BOOKING_CONFIRMED
  BOOKING_NO_SHOW
  ORDER_LOCKED_FIELD_MUTATED
}
```

`onDelete: Restrict` on the actor relation: deleting a user must not silently orphan audit history. Soft-delete users (existing pattern) are unaffected — the FK points at the row, not at active status.

**Service**

`src/modules/audit/audit-log.service.ts`:

```ts
export async function recordAuditLog(
  client: DbClient,
  actorContext: ActorContext,
  input: {
    entityType: AuditEntityType;
    entityId: string;
    action: AuditAction;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    context?: Record<string, unknown>;
  }
): Promise<void> {
  await client.auditLog.create({
    data: {
      actorUserId: actorContext.actorUserId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      before: input.before ?? Prisma.JsonNull,
      after: input.after ?? Prisma.JsonNull,
      context: input.context ?? {},
    },
  });
}
```

No `getAuditLog`, no `updateAuditLog`, no `deleteAuditLog`. Read paths land with the accountant view (O6, deferred).

**Call sites — wire `recordAuditLog` into every action in the action enum**

For each `AuditAction` value, identify the existing transactional code path and add a `recordAuditLog` call inside the same transaction. The implementing agent should produce this mapping as part of the work, but the canonical list is:

- `INVOICE_LOCKED` / `INVOICE_UNLOCKED` — `closeInvoiceIfSettled` (payment.service.ts) and any explicit lock/unlock call sites. `before`/`after`: `{ isLocked, status, closedAt }`.
- `INVOICE_TOTAL_MUTATED` — anywhere `Invoice.totalAmount` is updated post-issue. `before`/`after`: `{ totalAmount }`. (Most paths should not mutate totalAmount post-issue at all; 80b's trigger will enforce this. For this spec, audit any remaining service-level writers.)
- `PAYMENT_RECORDED` — `recordPaymentWithClient` (after the row lock + role guard from 78a/78b). `after`: `{ paymentId, invoiceId, amount, method, direction }`.
- `PAYMENT_REFUNDED` — outbound payment creation path (76a). `after`: `{ paymentId, parentInvoiceId, refundInvoiceId, amount }`.
- `CREDIT_NOTE_ISSUED` — `createCreditNote` / `applyAdjustmentReversalsWithClient` (79a). `after`: `{ creditNoteInvoiceId, targetInvoiceId, lines, managerApprovedReductionByUserId }`.
- `ADJUSTMENT_ISSUED` — `createAdjustmentInvoice`. `after`: `{ adjustmentInvoiceId, parentFinalInvoiceId, lines }`.
- `REFUND_ISSUED` — refund-invoice creation (76a, paired with the outbound payment above).
- `BOOKING_CONFIRMED` / `BOOKING_NO_SHOW` — booking-status transition service. `before`/`after`: `{ status }`.
- `ORDER_LOCKED_FIELD_MUTATED` — any post-lock mutation of order fields that the classifier permits (rare; mostly net-zero swaps). `before`/`after`: changed field map.

For each call site, the `entityType` + `entityId` map to the principal entity of the action (e.g., `INVOICE` + the invoice id, not the order id). Order/financial-case context goes in the `context` JSON column for join-free filtering.

**Backfill — none**

Pre-existing rows are not retroactively audited. The introduction date of `AuditLog` becomes the "audit horizon"; queries that need pre-horizon attribution fall back to `OrderActivity` (narrative) and `Payment.createdAt`/`Invoice.createdAt` (timestamps without actor).

**Integration tests**

`tests/audit/audit-log.test.ts`:

- Test A: record a payment via `recordPayment` with a MANAGER actor → assert exactly one `AuditLog` row with `action = PAYMENT_RECORDED`, `actorUserId = manager.id`, `entityType = INVOICE`, `entityId = invoice.id`, `after.paymentId` set.
- Test B: issue a CREDIT_NOTE via the 79a reversal path → assert one `CREDIT_NOTE_ISSUED` audit row with `after.managerApprovedReductionByUserId` populated.
- Test C: lock a FINAL invoice on full payment (78a auto-lock path) → assert one `INVOICE_LOCKED` audit row.
- Test D: when the encapsulating transaction rolls back (force a downstream error after `recordAuditLog`) → assert zero audit rows. Co-transactionality.
- Test E: attempt to call `recordAuditLog` with `actorContext.actorUserId = ''` (forced via `any`-cast) → throws (FK constraint or input validation; either is acceptable).

### Out of Scope

- DB-level append-only enforcement of `AuditLog` (trigger blocking UPDATE/DELETE) — **80b** stretch, otherwise Sprint 4 cleanup. For now, code discipline.
- `InvoiceLockSnapshot` table — **80b**. (`AuditLog.INVOICE_LOCKED` covers the actor-attribution half; `InvoiceLockSnapshot` covers the field-level state freeze.)
- DB-level locked-invoice immutability trigger — **80b**.
- DB-level over-collection / ADJUSTMENT chain constraints — **80c**.
- Accountant read view / UI for audit history (**O6**) — deferred, depends on this spec but ships later.
- Retroactive audit backfill of historical rows.
- Web API endpoint for audit queries — internal use only until O6.

---

## Implementation Direction

**Risk:** Medium. The schema is straightforward, but the call-site wiring is broad — every financial action gets a co-transactional audit write. The risk is *missing* a call site: a financial action that ships without an audit entry is silently invisible. Grep the action list against the codebase methodically.

**Order of work:**

1. Migration: add `AuditLog`, `AuditEntityType`, `AuditAction`. Run `npx prisma migrate dev`.
2. Implement `recordAuditLog` service. No callers yet. Confirm build green.
3. Wire `PAYMENT_RECORDED` first (highest-traffic, simplest payload). Add Test A. Run nightly reconciliation locally — confirm no perf regression.
4. Wire `INVOICE_LOCKED` / `INVOICE_UNLOCKED` (78a's auto-lock + any explicit paths). Add Test C.
5. Wire `CREDIT_NOTE_ISSUED` + `ADJUSTMENT_ISSUED` + `REFUND_ISSUED`. Add Test B.
6. Wire `BOOKING_CONFIRMED` / `BOOKING_NO_SHOW`. Add specific assertion tests.
7. Wire remaining actions (`INVOICE_TOTAL_MUTATED`, `ORDER_LOCKED_FIELD_MUTATED`). These are rare paths; grep + reason carefully about whether they exist after 79a/79b landed.
8. Add Tests D, E (transactional + actor enforcement).

**Why co-transactional rather than async:** an audit entry that survives a rolled-back action is a lie (the action never happened, but the log claims it did). The co-transactional pattern guarantees correctness; the performance cost (one row insert per audited action, on the same tx) is negligible for our volume.

**Why `entityType` + `entityId` rather than a polymorphic relation:** Prisma's polymorphic story is weak; foreign keys per entity would require ten nullable columns or an ugly union. The `(entityType, entityId)` index gets us the query patterns we need (entity history, actor history, action history) cleanly.

**Why no read service:** the accountant view (O6) is the consumer. Until O6 ships, internal queries can hit the table directly via Prisma. Adding a read API now would freeze its shape before the consumer's needs are known.

**Rollback:** drop the table and the two enums. No data loss outside the new table. Existing flows continue unchanged because `recordAuditLog` is additive — its absence breaks nothing.

---

## Verification

- All five integration tests pass.
- All existing tests pass.
- `npm run build` passes.
- `npm run lint` passes.
- Grep audit: every value in `AuditAction` has at least one call site in `src/modules/`. Build a script or one-off grep loop to confirm.
- Manual: as a MANAGER, record a payment in dev → confirm one `audit_logs` row exists in the DB with `actorUserId = manager.id`.
- Manual: as a MANAGER, issue a CREDIT_NOTE via the 79a reversal path → confirm an `audit_logs` row with `action = CREDIT_NOTE_ISSUED` and `after.targetInvoiceId` set.
- Schema review: confirm `actorUserId` FK uses `onDelete: Restrict`, indices match the spec, no `@updatedAt` (audit rows are immutable).

---

## Post-Implementation

- Update `context/reviews/77-post-verification-hardening-roadmap.md`: mark A1 and S4 as completed; note A1 dependency status for Sprint 4 work that depends on it (O6, commissions, reporting).
- Update `progress-tracker.md`.
- Cross-reference: 80b's `InvoiceLockSnapshot` spec will reference this service for the lock-time audit pairing.
