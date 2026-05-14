## Goal

Cut over from the old virtual-deposit-credit calculation to the new allocations + applications calculation. Remove `getDepositCreditAmountForFinancialCase`. Remove the dual-read feature flag. Ship the nightly reconciliation job as Phase 1's permanent prod safety net.

This is the final Phase 1 sub-spec. After this ships, the rearchitecture's structural pivot is complete and every later phase builds on the new primitives.

Depends on 73b (reconciliation harness) and on 74d having completed a successful verification window (zero `financial.rearch.dual_read.discrepancy` WARN logs across one full release cycle).

---

## Read First

- `context/Financial reviews/financial-rearchitecture-master-plan.md` — "Reconciliation job (prod safety net)" section
- `src/modules/invoices/invoice.service.ts:1179-1196` — `getDepositCreditAmountForFinancialCase` (to be deleted)
- `src/modules/invoices/invoice.service.ts:630-634` — current `recalculateInvoiceStatus` dual-read wrapper (the old path inside is what gets removed)
- `tests/financial-invariants.test.ts` from 74d (to be expanded)

---

## Rules

- Cutover gate: zero `financial.rearch.dual_read.discrepancy` WARN logs across the verification window from 74d. Confirm with an explicit metrics check before merging
- Removal must be surgical — only the old calculation path and the flag are removed; everything else added in 74a–d stays
- Reconciliation job lands in the same release as the cutover so the safety net is in place when the old code disappears
- After this spec, the new calculation is authoritative AND the only calculation in code

---

## Scope

### In Scope

**Pre-cutover verification (do first, document in PR)**
- Pull the `financial.rearch.dual_read.discrepancy` counter for the verification window — must be 0
- Run `tests/financial-invariants.test.ts` against a prod-shaped staging dataset — must pass
- If either fails, this spec does not ship; root-cause and revisit 74d

**Flip the flag — then remove it**
1. Switch `FINANCIAL_REARCH_PHASE_1_DUAL_READ` semantics: when ON, the NEW path is now authoritative (one-line change in `recalculateInvoiceStatus`)
2. Ship to prod, observe for 24h — no balance regressions in customer reports
3. In a follow-up commit (same release, after the 24h soak): remove the flag, the old path, the dual-read wrapper, and `getDepositCreditAmountForFinancialCase`

The 24h soak between step 2 and step 3 is intentional — if anything goes wrong after authoritative-flip, we can flip back without a code rollback.

**Code removal checklist**
- Delete `getDepositCreditAmountForFinancialCase` function
- Delete every call site of that function
- Delete the dual-read wrapper in `recalculateInvoiceStatus`; inline the new calculator function call directly
- Delete the `FINANCIAL_REARCH_PHASE_1_DUAL_READ` flag definition
- Delete the discrepancy logger + metric emission (no longer relevant)
- Update any tests that mocked the old function

**Schedule the reconciliation job**

The reconciliation harness `scripts/financial-reconciliation.ts` was established in 73b — it already calls `runAllInvariants` against the live DB and posts violations to Slack (configurable via env vars).

This spec adds the cron/schedule entry to run it nightly at 02:00 studio-local time. Use whatever scheduling mechanism the project already uses. Verify env vars `FINANCIAL_RECON_SLACK_WEBHOOK` and `FINANCIAL_RECON_SLACK_CHANNEL` are set in the prod environment before merging.

**Final invariant registrations for Phase 1**

Register the remaining Phase 1 invariants into the 73b registry (74c and 74d already registered the others):

```ts
registerInvariant({
  name: 'deposit-final-pair-has-document-application',
  scope: 'global',
  run: /* every FinancialCase with both closed DEPOSIT (paidAmount>0) and FINAL has exactly one DocumentApplication binding them */,
});

registerInvariant({
  name: 'no-payment-without-allocation',
  scope: 'global',
  run: /* every Payment has at least one PaymentAllocation */,
});
```

These appear automatically in both the CI test and the nightly reconciliation job — no edits to the test runner or the reconciliation script needed.

### Out of Scope

- Activity-log entries for DocumentApplication / PaymentAllocation events (separate small follow-up or rolled into Phase 2)
- Any new financial primitive (Phase 2+)
- ADJUSTMENT, REFUND, CREDIT_NOTE invoice flows

---

## Implementation Direction

**Phased commit plan within this spec:**
1. Commit A: flip flag semantics (new path authoritative when flag ON)
2. Ship, observe for 24h
3. Commit B: remove old path + flag + dual-read wrapper + `getDepositCreditAmountForFinancialCase`
4. Commit C: add reconciliation job

Commits A and B can be in the same PR with explicit "merge A first, observe, then merge B" instructions, OR separate PRs. Match project release process.

**Risk:** The 24h soak between A and B is the last chance to catch a discrepancy the verification window missed. If anything looks off, revert A (`git revert`) — straightforward because B hasn't shipped yet.

**Rollback after B ships:** Code-level rollback requires restoring the old function from git history. The reconciliation job will catch any silent corruption that escapes; on a violation, the rollback path is to manually restore the old function, redeploy, and investigate. This is acceptable because (i) the verification window from 74d already proved the new path matches, (ii) the invariant suite catches violations within 24h, (iii) the DB state from 74b is preserved — no destructive data changes happen in this spec.

---

## Verification

- `getDepositCreditAmountForFinancialCase` no longer exists in `src/` (verify with grep)
- `FINANCIAL_REARCH_PHASE_1_DUAL_READ` flag no longer exists
- `recalculateInvoiceStatus` directly calls the new allocations + applications calculator
- `tests/financial-invariants.test.ts` passes with the full Phase 1 invariant set
- Nightly reconciliation job runs successfully against staging — zero violations expected
- All existing user-facing flows produce the same balances, statuses, and remaining amounts as before Phase 1
- One full release cycle after merging Commit B: reconciliation job reports zero violations daily
