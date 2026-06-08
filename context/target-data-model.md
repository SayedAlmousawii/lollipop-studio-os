# Target Data Model

Current schema-facing notes for implementation work. This document records non-obvious data-shape contracts; `prisma/schema.prisma` remains the executable source of truth.

## Order Commit Baseline

`OrderCommit` is the persisted committed operational baseline for Unified Order Commit. Each row stores a versioned `snapshotJson` captured from current materialized `Order*` rows, with `sequence` ordered per order and the highest sequence representing the latest committed baseline.

`OrderCommit` is the current post-lock operational commit boundary. Invoices remain immutable financial documents; invoice line items are not an operational ownership source for `OrderCommit` snapshots.

## Order Commit Draft Boundary

`OrderCommitDraft` is the additive pending snapshot boundary for Unified Order Commit. V1 allows one active draft per `Order`, stores `pendingSnapshotJson` as the same V1 `OrderCommit` snapshot contract, and stores `pendingOpsJson` as generic history metadata only.

Spec 121 Task 2 adds lifecycle helpers that load one active draft by order, initialize a missing draft from the latest `OrderCommit` snapshot or current operational `Order*` rows, and discard drafts with expected-version plus owner/manager mutation checks. Draft lifecycle writes do not change POS routing, invoice/payment behavior, operational ownership rows, or domain-specific staging reducers.

Spec 121 Task 3 adds snapshot replacement for an existing draft. Replacement parses `pendingSnapshotJson` as the V1 `OrderCommit` snapshot contract, requires matching `orderId`, `financialCaseId`, schema version, and currency, increments the draft `version` through an expected-version write, and appends generic `SNAPSHOT_REPLACED` pending-operation history. Replacement does not compute business deltas, read invoice line items, or mutate operational, invoice, payment, allocation, document-application, refund, or credit-note rows.

Spec 121 Task 4 adds generic pending-operation history mutation. The helper appends a parsed V1 operation or replaces an existing operation with the same operation id, requires expected-version plus owner/manager mutation checks, increments the draft `version`, and updates `lastTouchedByUserId`. It does not change `pendingSnapshotJson`, interpret operations as business reducers, read catalog/order domain rows for diffs, or mutate operational or financial rows.

Spec 122 Task 1 adds typed staging-change contracts for package, add-on, package-item-upgrade, photo-count, and session-configuration draft staging. These contracts are service input commands only. After a stage request succeeds, the replacement `pendingSnapshotJson` remains the durable draft business truth. `pendingOpsJson` keeps generic `SNAPSHOT_REPLACED` / `NOTE_APPENDED` operations; domain staging history is stored as a typed payload on snapshot-replacement history and must not be replayed as the source for commit preview, commit execution, or draft reconstruction.

## Order Commit Preview Boundary

Spec 123 Phase 3 Task 1 adds the public preview DTO contract for centralized OrderCommit preview/diff work. Preview contracts expose baseline source metadata, draft identity/version, line-level snapshot diffs, operational classification flags, approval reasons, document-plan preview, payment impact, refund impact, and zero-net reasons.

Committed truth remains `OrderCommit.snapshotJson`. Draft truth remains `OrderCommitDraft.pendingSnapshotJson`. `pendingOpsJson` remains history-only and is not part of the preview diff contract. The first-commit baseline selection contract is latest `OrderCommit` snapshot first, then package-only original booking/order operational composition when no commit exists, and explicit empty baseline only when neither committed nor original operational composition exists. Original-baseline included-photo resolution remains catalog-dependent until `OrderPackage` stores a durable original included-photo snapshot.

Spec 123 Phase 3 Task 3 adds pure snapshot diff semantics. Preview diff compares two parsed V1 snapshots by `stableKey` only, requires matching `orderId`, `financialCaseId`, schema version, and currency, returns raw numeric line and net deltas, and reports meaningful zero-net operational changes without reading `pendingOpsJson` or any database-backed operational/financial rows. If a package change produces different stable keys, the diff reports removed and added lines; later classification owns interpreting that as a package swap/change.

Spec 123 Phase 3 Task 4 adds pure preview classification semantics. Classification consumes only the snapshot diff DTO, aggregates operational change flags, and determines the preview `commitKind` for no-op, positive delta, negative delta, and meaningful zero-net changes. It does not read snapshots again, inspect `pendingOpsJson`, query the database, decide approval policy, build document plans, compute payment/refund impact, load drafts, or mutate operational/financial rows.

Spec 123 Phase 3 Task 5 adds pure approval and financial-document preview semantics. Approval/document preview consumes the operational classification, explicit baseline source, and a loader-provided raw payment state; it does not query the database, inspect `pendingOpsJson`, or create invoices, payments, credit notes, refunds, allocations, applications, commits, or operational rows. Positive first-commit deltas with `ORIGINAL_ORDER_COMPOSITION` or `EMPTY` preview a base invoice, positive latest-commit deltas preview an adjustment invoice, reductions require approval and preview either credit-note or refund-needed outcomes based on current remaining balance, zero-net meaningful changes preview an audit commit, and no-op changes preview no financial document.

Spec 123 Phase 3 Task 6 adds the read-only `getOrderCommitPreview({ orderId })` loader. The loader reads the active `OrderCommitDraft.pendingSnapshotJson`, resolves the preview baseline, compares snapshot to snapshot, classifies operational changes, and passes loader-provided payment state into the approval/document preview builder. The only financial read boundary is `getFinancialCaseSummary({ orderId })`; active summaries map `effectivePaid`, `remaining`, `creditNoteCapacity`, and `overpaymentCapacity` into preview payment state. Booking-stage summaries are treated explicitly as pre-final-invoice preview state: `alreadyPaidAmount = depositInvoice?.paidAmount ?? 0`, `currentRemainingAmount = 0`, `creditNoteCapacity = 0`, and `overpaymentCapacity = 0`. The loader does not inspect `pendingOpsJson` as business truth and does not mutate drafts, operational rows, invoices, payments, allocations, applications, credit notes, refunds, or commits.

Spec 123 Phase 3 Task 7 completes regression guards for the preview boundary. Guarded semantics are: committed baseline truth comes from the latest `OrderCommit.snapshotJson`; draft preview truth comes from the active `OrderCommitDraft.pendingSnapshotJson`; first-commit previews use only original booked package composition when no commit exists; explicit empty baselines are allowed only when no committed or original operational composition exists; unsafe partial original composition blocks preview; and `pendingOpsJson` remains history-only. Preview tests also guard that package-only original baselines do not fall back to current package identity, current package price, current selected/extra photo counts, dependent operational rows, invoice lines, or mutation services.

## Order Commit Execution Schema Boundary

Spec 124 Phase 4 Task 1 adds the execution schema guard for Unified Order Commit. `OrderCommit.committedFromDraftVersion` records the draft version that produced a commit once execution is wired, and the `(orderId, committedFromDraftVersion)` unique constraint is the database-level double-submit guard. Existing Phase 1 bootstrap commits can keep this field null.

`OrderCommitDocument` is the commit-to-financial-document link model. It links an `OrderCommit` to emitted invoices only, with role values `BASE_INVOICE`, `ADJUSTMENT_INVOICE`, and `CREDIT_NOTE`. It does not link payments, refunds, audit rows, or existing locked deposit invoices.

Spec 124 Phase 4 Task 6 adds `commitOrderChanges` as the public commit execution entry point. Commit execution runs in a serializable transaction, locks the order/draft/latest commit/parent final invoice when applicable, recomputes preview from the persisted draft and baseline state, materializes `OrderCommitDraft.pendingSnapshotJson` into `Order*` rows, delegates document emission to the mapper-driven emission helper, creates the new `OrderCommit`, writes invoice-only `OrderCommitDocument` links, records audit/activity, checks financial invariants, and deletes the draft only after those steps succeed. `committedFromDraftVersion` is populated from the observed draft version, and conflicts on `(orderId, committedFromDraftVersion)` surface as concurrent commit errors. `REFUND_NEEDED` commits set `Order.refundPending` through the emission helper and do not issue refund payments.

`InvoiceLineItem` rows on `FINAL`, `ADJUSTMENT`, `CREDIT_NOTE`, and `REFUND` invoices are financial-document snapshots only. They preserve what was charged, credited, or refunded, but they are not a source for current operational composition. Locked composition projections read current `Order*` rows through the composition read layer.

## Document Application Kind And Credit-Note Pool

Spec 153 F1 adds `DocumentApplication.kind` as the explicit discriminator for credit movement shape: `DEPOSIT`, `CAUSE_REVERSAL`, `CREDIT_TO_FINAL`, and forward-only `SETTLEMENT`. Existing production paths continue to emit only deposit applications, line-targeted credit-note cause reversals, and credit-note-to-final applications; `SETTLEMENT` is foundation-only until the settlement emission unit.

Credit notes are write-once financial documents after issuance: `totalAmount`, identity fields, and invoice rows remain locked, while available credit is derived on demand as `totalAmount - sum(DocumentApplication.amountApplied from the credit note)`. `Invoice.remainingAmount` remains stored for existing register compatibility, but it is not the source of truth for drawable credit-note availability and is not synchronized by the append-only draw helper.

Spec 149 removes the retired post-lock workspace tables and the `OrderCommit*` legacy workspace back-reference columns. `OrderCommit` and `OrderCommitDraft` now carry no schema link to the retired workspace path.
