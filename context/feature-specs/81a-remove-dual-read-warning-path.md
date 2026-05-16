## Goal

Delete the `dual-read` path in `src/modules/financial/dual-read.ts`. It was introduced during 74's cutover to compare the legacy and canonical paths and emit `financial.rearch.dual_read.discrepancy` when they diverged. Post-cutover (74e), the classifier is canonical. The dual-read still runs on every locked-edit and emits warnings for *valid* edits, polluting log-based gating signals.

Closes roadmap items **A4** and **D4**.

---

## Read First

- `context/reviews/77-post-verification-hardening-roadmap.md` — §5 A4, §6 D4
- `src/modules/financial/dual-read.ts` — the module to delete
- `src/modules/invoices/invoice.service.ts:21` — `dualRead` import and call site
- Feature 74d / 74e — original dual-read introduction (historical context)

---

## Rules

- Delete `src/modules/financial/dual-read.ts` entirely.
- Every importer of `dualRead` or `LockedInvoiceEditError` from that path must be updated. `LockedInvoiceEditError` (if still in use) moves to `src/modules/financial/edit-classifier.ts` next to the other classifier errors; if no callers, delete it.
- The metric `financial.rearch.dual_read.discrepancy` is removed. No replacement — its purpose was cutover validation, which is complete.
- Behavior change: nothing. The dual-read path was a *comparison* layer; the canonical path it wrapped continues to execute. Tests confirm parity.

---

## Scope

### In Scope

- Delete the module file.
- Update the single importer in `invoice.service.ts`. Inline whatever the canonical branch did, or call it directly.
- Grep audit: `grep -rn "dual.read\|dual_read\|LockedInvoiceEditError" src` returns zero matches after the change (or only matches inside the edit-classifier if `LockedInvoiceEditError` survives).
- Remove any test that exists *only* to assert dual-read parity. Tests that assert canonical-path behavior stay.

### Out of Scope

- The classifier itself — unchanged.
- 79a's adjustment-cause ledger — unchanged.
- Any other observability metric — unchanged.

---

## Implementation Direction

**Risk:** Low. Pure deletion of a comparison layer; the canonical path remains.

**Order of work:**

1. Identify every importer (grep).
2. For each: replace the `dualRead(...)` call with a direct call to whatever it wraps.
3. Delete `src/modules/financial/dual-read.ts`.
4. Run full test suite. Any dual-read-specific test fails — delete it; assertion was about a comparison that no longer exists.
5. Grep audit.

**Rollback:** revert the PR. Dual-read returns, log noise returns.

---

## Verification

- All existing tests pass.
- `npm run build` passes.
- `npm run lint` passes.
- Grep audit: zero matches for `dual_read|dual-read` in `src/`.
- Manual: perform a locked-order edit on dev → confirm no `financial.rearch.dual_read.discrepancy` log entry is emitted.

---

## Post-Implementation

- Update `context/reviews/77-post-verification-hardening-roadmap.md`: mark A4 and D4 as completed.
- Update `progress-tracker.md`.
