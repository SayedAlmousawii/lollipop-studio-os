# Feature 77 Phase F — Concurrency, Security, Failure Recovery Review

Date: 2026-05-15

## Scope

Phase F implemented automated verification for:

- Layer 7 — Transaction & Concurrency Testing
- Layer 8 — Security & Permission Testing
- Layer 9 — Failure Recovery Testing

The suite lives in `tests/financial-phase-f/` and is wired into `npm run test:backend-invariants`.

## Automated Coverage Added

- `F-CON-01` concurrent booking deposit/confirmation: one concurrent deposit wins, the other rejects; exactly one `FinancialCase`, Deposit Invoice, Deposit Payment, and `PaymentAllocation` remain.
- `F-CON-02` simultaneous full Final Invoice payments: exercises double-click settlement and characterizes over-collection if both requests pass the stale balance guard.
- `F-CON-03` concurrent locked-POS additions: verifies two simultaneous add-ons create two sibling ADJUSTMENT invoices against the same locked FINAL.
- `F-CON-04` stale credit-note approval: verifies a stale add-on removal cannot issue a second CREDIT_NOTE after the target add-on was already removed.
- `F-CON-05` simultaneous final 1% settlement: exercises final close race and characterizes over-collection if both closers win.
- `F-CON-06` stale browser payment after invoice close: server rejects a payment submitted against an already settled invoice with no new payment row.
- `F-CON-07` static payment lock check: documents that payment processing still lacks `SELECT ... FOR UPDATE`.
- `F-SEC-01` through `F-SEC-08`: service permission matrix, forbidden transitions, Zod bypass attempts, direct locked-invoice mutation characterization, and hidden mutation path search.
- `F-REC-01` through `F-REC-06`: rollback verification for booking confirmation, check-in, Final Invoice creation/application, payment creation, mixed ADJUSTMENT/CREDIT_NOTE, and REFUND invoice creation.

## Permission-Risk Findings

- `recordPayment()` has no service-level role guard. Server actions and POS order payment paths check permissions first, but direct service callers can record a payment even with an `EDITOR` actor. This is a hidden mutation path and should be closed by requiring a financial actor context or moving the low-level function behind a clearly internal API.
- `assertActorPermission()` in `src/modules/orders/order.service.ts` returns early when `actorRole` is absent. Services that do not separately require actor context can accidentally bypass role checks if called without a role.
- CREDIT_NOTE and REFUND service functions correctly reject receptionist/accountant actors through persisted `User.role` lookup.
- POS payment paths correctly reject editor and photographer actors through `recordPOSPaymentForOrder`.
- Delivery payment override correctly rejects receptionist actors.

## Transactional Weakness Findings

- `src/modules/payments/payment.service.ts` still has no invoice row-level lock around balance read, payment creation, allocation creation, recalculation, and settlement close. This remains the highest-risk corruption vector for double-click payments and simultaneous final settlement.
- Locked invoice immutability remains service-layer only. A direct Prisma `invoice.update` can change `totalAmount` or clear `isLocked`; Phase F rolls this back in-test but confirms the database would accept it.
- Refund capacity is still based on inbound allocation capacity, not true overpayment/credit-note capacity. Phase F keeps this as a rollback-only characterization to avoid writing a bad refund, but the bypass remains live.

## Recovery Findings

- Transaction rollback held for all injected failure cases covered by Phase F.
- After each rollback scenario, `runAllInvariants(db)` returned zero violations.
- Final Invoice creation plus Deposit `DocumentApplication` rolls back atomically when the surrounding transaction fails.
- Mixed ADJUSTMENT and CREDIT_NOTE document creation rolls back atomically when a later failure is injected.
- REFUND invoice creation rolls back cleanly when failure occurs before outbound payment creation.

## Short Review

Phase F raises confidence that existing transaction boundaries roll back cleanly, but it does not close the largest race risk: payment settlement still depends on app-layer balance checks without row-level invoice locking. Permission enforcement is stronger at server-action/POS boundaries than at low-level financial services, so future financial code must not call `recordPayment()` directly without an explicit permission guard.
