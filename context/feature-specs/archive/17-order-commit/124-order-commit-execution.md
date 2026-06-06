## Goal

Add Phase 4 commit execution for Unified Order Commit. A new `commitOrderChanges` service atomically materializes pending draft state into `Order*` rows, emits immutable financial documents from a centralized snapshot-diff → financial-line mapping, links those documents to the new `OrderCommit` through a new `OrderCommitDocument` model, and clears the draft. This spec is foundation + execution only: it does not change POS routing, employee-facing UI copy, or Adjustment Workspace finalization, and it does not auto-issue refund payments.

## Read First

- `context/reviews/unified-order-commit-live-pos-roadmap.md` — approved Phase 4 scope and cross-phase rules.
- `context/reviews/unified-order-commit-architecture-plan.md` — `OrderCommit` public naming, commit-atomicity rules, and snapshot boundary semantics.
- `context/feature-specs/120-order-commit-snapshot-foundation.md` — committed snapshot shape and invoice-line independence.
- `context/feature-specs/121-order-commit-draft-foundation.md` — draft lifecycle, snapshot replacement, generic pending-operation history.
- `context/feature-specs/122-order-commit-draft-staging-reducers.md` — staging reducers and the `pendingSnapshotJson` truth boundary.
- `context/feature-specs/123-order-commit-preview-diff-engine.md` — baseline resolution, snapshot-to-snapshot diff, preview classification, approval/document-plan preview.
- `context/target-data-model.md` — current `OrderCommit`, `OrderCommitDraft`, materialized `Order*`, and invoice-line ownership contracts.
- `prisma/schema.prisma` — `OrderCommit`, `OrderCommitDraft`, `Invoice`, `InvoiceLineItem`, `DocumentApplication`, `Payment`, `PaymentAllocation`.
- `src/modules/order-commits/` — existing snapshot, draft, staging, reducer, preview, and normalizer surfaces.
- `src/modules/invoices/invoice.service.ts` — existing `createInvoiceForOrderWithClient`, `createAdjustmentInvoiceWithClient`, `createCreditNoteWithClient`, `applyAdjustmentReversalsWithClient`, `buildOpenAdjustmentLineMap`, `computeCreditNoteCapacityForFinal`, `recalculateInvoiceStatus`, `generateInvoiceNumber`.
- `src/modules/invoices/invoice-lock.service.ts` — `recordInvoiceLockSnapshot`.
- `src/modules/refunds/refund.service.ts` — reference only; no refund issuance in V1.
- `src/modules/financial/edit-classifier.ts` — reversal routing reference; `adjustmentCauseKey()` shape.
- `src/modules/financial/invariants.ts` — `assertFinancialCaseInvariants`.
- `src/modules/audit/audit-log.service.ts` and `src/modules/orders/order-activity.service.ts`.
- `src/modules/adjustment-workspace/adjustment-workspace.service.ts` — reference only for materializer behavior (`materializePackageTierChangeEdits`, `materializeAddOnEdits`, `materializeItemUpgradeEdits`, `materializePhotoCountEdits`, `finalizeSessionConfigurationSelectionEdits`).

## Rules

- Phase 4 is foundation + execution. Do not change `/orders/[orderId]/sales`, POS action routing, visible UI copy, employee-facing routes, or Adjustment Workspace finalization.
- Public names must use `OrderCommit` / `OrderCommitDraft` / `OrderCommitDocument`. No public service, DTO, route, metric, audit code, or test name may expose Adjustment Workspace terminology.
- Commit execution is atomic. Locked invoices are never mutated. Failures roll back operational, financial, document-link, and audit writes.
- Materialization is snapshot-driven. The materializer writes `Order*` rows from `OrderCommitDraft.pendingSnapshotJson`. It does not consume `pendingOpsJson` and does not call Adjustment Workspace finalize logic.
- Financial documents are emitted from `Order*` rows after materialization (BASE invoice path) or from the snapshot-diff financial-line mapper (ADJUSTMENT and CREDIT_NOTE paths).
- `documentPlan.kind` from the Spec 123 preview is informational only. Commit execution emits whichever set of documents the mapper actually produces, possibly more than one document per commit.
- `REFUND_NEEDED` does not auto-issue a refund payment in V1. The credit-note residual is still emitted and `Order.refundPending` is set; refund issuance remains the existing manual flow.
- Zero-net commits and no-op commits create an `OrderCommit` row but no `OrderCommitDocument` rows.
- `OrderCommitDocument` links invoices only. No payment, refund record, or audit row is linked through it.
- `OrderCommit.committedByUserId` records the actor performing the commit. When manager approval is required, the approver's id is captured in commit metadata, but `committedByUserId` is the staff actor.
- Existing locked deposit invoices are not retroactively linked to the first `OrderCommit` in V1.
- After a successful commit, the `OrderCommitDraft` row is deleted.
- `pendingOpsJson` remains history-only. The mapper, materializer, emission, and document writer must not consume it.
- The financial-line mapper is pure: no DB, no service imports, no `Prisma.Decimal` in its signature, no imports from `@/modules/invoices`, `@/modules/refunds`, `@/modules/payments`, or `@/modules/financial/edit-classifier`.
- Existing financial services (`createInvoiceForOrderWithClient`, `createAdjustmentInvoiceWithClient`, `createCreditNoteWithClient`, `applyAdjustmentReversalsWithClient`, `recalculateInvoiceStatus`, `recordInvoiceLockSnapshot`, `assertFinancialCaseInvariants`, `computeCreditNoteCapacityForFinal`) are reused. Do not duplicate their logic.
- Reversal routing is canonical-cause-id only at the mapper layer. Translation from legacy AW cause-id formats (`"package-tier-upgrade"` literal, extra-photo display-name) to canonical Phase-4 cause ids happens inside the `buildOpenAdjustmentLineMap` extension and is marked as a temporary fallback removable in Phase 7.
- Reductions that would exceed `computeCreditNoteCapacityForFinal` are pre-checked in Task 4 and fail with `OrderCommitCreditCapacityExhaustedError` before any document is written.
- All money in `order-commit-execution` and `order-commit-financial-emission` modules is `number`, rounded to three decimals; conversion to `Prisma.Decimal` happens only at the DB boundary inside the reused services.

## Scope

### In Scope

- Add Prisma model `OrderCommitDocument` mapped to `order_commit_documents`.
- Add column `committedFromDraftVersion Int?` on `OrderCommit` plus `@@unique([orderId, committedFromDraftVersion])` to guard double-submit at the database level.
- Add module files under `src/modules/order-commits/`:
  - `order-commit-materialization.service.ts`
  - `order-commit-financial-emission.service.ts`
  - `order-commit-document.service.ts`
  - `order-commit-execution.service.ts`
- Add constants/types/schemas for the new module surface:
  - `ORDER_COMMIT_DOCUMENT_ROLE`
  - `ORDER_COMMIT_CREDIT_NOTE_REASON`
  - `OrderCommitFinancialEmission`, `OrderCommitAdjustmentReversal`, `OrderCommitOpenAdjustmentLine`, `OrderCommitCreditNoteReason`, `OrderCommitDocumentRole`, `OrderCommitExecutionResult`
- Add public service entry points:
  - `commitOrderChanges({ orderId, expectedDraftVersion, approvalActorUserId?, actorContext })`
  - `mapOrderCommitDiffToFinancialLines(...)` (pure)
  - `materializeOrderCommitDraftIntoOrderRows(...)`
  - `createOrderCommitDocumentLinks(...)`
- Extend and export `buildOpenAdjustmentLineMap` from `@/modules/invoices/invoice.service`. The extension accepts `(financialCaseId, orderId, client)`, re-keys legacy AW cause ids (`"package-tier-upgrade"` and extra-photo display-names) to canonical Phase-4 cause ids before returning, and emits open lines in chronological order (`invoiceSeq`, then `sortOrder`, then `id`). The fallback branches are marked as removable in Phase 7.
- Add `OrderCommitCreditCapacityExhaustedError`, `OrderCommitStaleDraftError`, `OrderCommitApprovalRequiredError`, and `OrderCommitConcurrentCommitError` typed errors in the execution module.
- Add focused tests under `tests/order-commits/` covering schema, materialization, mapper purity, emission integration, document writer, and full-commit transactional behavior.
- Wire the new tests into `scripts/run-centralization-tests.ts`.
- Update `context/target-data-model.md` with the `OrderCommitDocument` model and Phase 4 commit semantics.

### Out of Scope

- No POS server-action rewiring (Phase 5).
- No UI changes (Phase 6).
- No automatic refund-payment issuance. `REFUND_NEEDED` sets `Order.refundPending=true` only.
- No retroactive `OrderCommitDocument` linking for Phase 1 bootstrap commits.
- No removal of Adjustment Workspace finalize, route, or services (Phase 7).
- No new schema fields on `Invoice`, `InvoiceLineItem`, `DocumentApplication`, `Payment`, `PaymentAllocation`, or `Order` (except the additive `committedFromDraftVersion` on `OrderCommit`).
- No `lineType` extensions to `InvoiceLineType` and no `OrderEntityKind` extensions.
- No localization. All descriptions are English (matches AW).
- No mixed-sign behavior change to the preview DTO beyond the Spec 123 amendment in §11.
- No multi-package add or remove inside a single commit. Diffs producing `PACKAGE / ADDED` or `PACKAGE / REMOVED` are rejected by the mapper.

## Implementation Direction

Implement Spec 124 as six small tasks. Each task lands in its own PR and stops once its acceptance checks pass. Sequencing:

- Tasks 1, 2, and 3 may proceed in parallel after Task 1's schema lands.
- Task 4 depends on Tasks 2 + 3.
- Task 5 depends on Tasks 1 + 4.
- Task 6 depends on all prior tasks.
- Explicit review gates after Task 3 (highest correctness risk) and after Task 4 (first transaction that emits documents).

### Task 1 — Schema: OrderCommitDocument and execution guard

Add `OrderCommitDocument` to Prisma, mapped to `order_commit_documents`:

- `id` — cuid PK.
- `orderCommitId` — FK to `OrderCommit`, `onDelete: Cascade`.
- `invoiceId` — FK to `Invoice`, `onDelete: Restrict`.
- `role` — string column. Values are `OrderCommitDocumentRole`: `BASE_INVOICE`, `ADJUSTMENT_INVOICE`, `CREDIT_NOTE`.
- `createdAt` — `DateTime @default(now())`.

Constraints:

- `@@unique([orderCommitId, invoiceId, role])` — no duplicate links per commit.
- `@@index([orderCommitId])`.
- `@@index([invoiceId])`.

Add relations from `OrderCommit` and `Invoice` to `OrderCommitDocument`. Keep both relations explicit and named.

Also amend `OrderCommit`:

- Add nullable `committedFromDraftVersion Int?`.
- Add `@@unique([orderId, committedFromDraftVersion])`. The constraint allows multiple rows where the field is null (Phase 1 bootstrap commits) but rejects two non-null rows sharing the same `orderId + version`. This is the database-level guard against double-submit racing past `expectedDraftVersion`.

`OrderCommitDocumentRole` is a TypeScript-constant-backed string column (matches Spec 120's `OrderCommit.kind`/`status`). Validate via Zod before each write.

No service consumers yet. Task 5 will use this model. Task 6 will populate `committedFromDraftVersion` on commit insert.

### Task 2 — Snapshot-driven materializer

File: `src/modules/order-commits/order-commit-materialization.service.ts`.

Public entry point:

```ts
export async function materializeOrderCommitDraftIntoOrderRows(input: {
  orderId: string;
  pendingSnapshot: OrderCommitSnapshotV1;
  actorContext: ActorContext;
  client: Prisma.TransactionClient;     // always called inside the commit transaction
}): Promise<{
  draftToOrderEntityMap: ReadonlyMap<string, string>;
}>;
```

Behavior:

- Reads current `Order*` rows for the order, scoped to the transaction client.
- Treats the pending snapshot as the desired end state. Computes the delta against current `Order*` rows and writes the difference. The snapshot is the source of truth for membership; rows present in `Order*` but not represented in the snapshot are deleted.
- Removed lines (present in baseline but absent from the pending snapshot) intentionally leave their *deleted* `Order*` row ids referenceable in the diff as `baseline.orderEntityId`. Task 3 uses those ids as cause-id keys for reversal routing; the materializer must not invent surrogate ids for deleted rows.

Column mapping for `OrderPackage` rows (`PACKAGE` lines):

| Snapshot field | `OrderPackage` column |
|---|---|
| `pending.catalogEntityId` | `currentPackageId` |
| `pending.label` | `currentPackageNameSnapshot` |
| `pending.unitPrice` | `finalPackagePriceSnapshot` |
| `pending.metadata.selectedPhotoCount` | `selectedPhotoCount` |
| `pending.metadata.extraDigitalCount` | `extraDigitalCount` |
| `pending.metadata.extraPrintCount` | `extraPrintCount` |
| `pending.metadata.sessionTypeId` | `sessionTypeId` (only if changed by package reducer; otherwise leave untouched) |

`originalPackageId`, `originalPackageNameSnapshot`, `originalPackagePriceSnapshot`, and `bookingPackageId` are immutable post-booking. The materializer must never write them. Tests must assert this.

Per-line-kind write rules:

- `ADD_ON` (non-linked) → upsert `OrderAddOn`. New lines carry snapshot ids prefixed `draft:`; the materializer creates the row, then registers `draft:<id> → OrderAddOn.id` in the returned map. Existing lines update `quantity`, `nameSnapshot`, `priceSnapshot` from snapshot fields.
- `PACKAGE_ITEM_UPGRADE` → upsert `OrderPackageItemUpgrade`. Same `draft:* → id` mapping rules. Quantity and price snapshots come from the snapshot line.
- `SELECTED_PHOTO_EXTRA` → not a standalone row write. The selected/extra counts live on the parent `OrderPackage` (see column mapping above). These snapshot lines exist for diffing only; the materializer derives nothing new from them beyond the parent package's `metadata.*Count` fields.
- `SESSION_CONFIGURATION` → upsert `OrderPackageSessionConfigurationSelection`. Preserve zero-value operational selections. Newly staged selections carry `draft:*` ids; register `draft:<selectionId> → OrderPackageSessionConfigurationSelection.id`.
- `LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON` → upsert the linked `OrderAddOn`. Newly staged linked products carry their own `draft:*` id distinct from the selection's draft id; the materializer must register **both** mappings: `draft:<selectionId> → selection.id` and `draft:<linkedAddOnId> → linkedOrderAddOn.id`. The pairing invariant from Spec 122 must hold after every write.

`Order.selectedPhotoCount` resync formula (matches AW's `materializePhotoCountEdits`):

```
Order.selectedPhotoCount = sum over OrderPackage in this order of OrderPackage.selectedPhotoCount
```

The resync runs once at the end of the materializer, after every `OrderPackage.selectedPhotoCount` write. No other order-level cache is touched.

Write order (must be followed to avoid FK violations and orphaned linked add-ons):

1. **Pre-null linked-product FKs.** For every `OrderPackageSessionConfigurationSelection` that is present in the baseline but absent from the pending snapshot AND that has a non-null `orderAddOnId`, set `selection.orderAddOnId = null`. This breaks the FK before the linked `OrderAddOn` is deleted in step 3.
2. **Delete absent selections.** Delete every `OrderPackageSessionConfigurationSelection` not represented in the pending snapshot.
3. **Delete orphaned linked `OrderAddOn` rows.** For every linked `OrderAddOn` whose owning selection was just deleted, delete the `OrderAddOn` row.
4. **Delete absent `OrderPackageItemUpgrade` rows.**
5. **Delete absent non-linked `OrderAddOn` rows.**
6. **Update existing `OrderPackage` rows** per the column mapping table above.
7. **Insert new non-linked `OrderAddOn` rows** (snapshot lines with `draft:*` ids and `lineKind = ADD_ON`). Register each `draft:* → id` mapping.
8. **Insert new `OrderPackageItemUpgrade` rows.** Register mappings.
9. **Insert new `OrderPackageSessionConfigurationSelection` rows** with `orderAddOnId = null`. Register mappings.
10. **Insert new linked `OrderAddOn` rows** for `LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON` snapshot lines. Register mappings.
11. **Wire linked-product FKs.** Update each newly inserted selection's `orderAddOnId` to point at its paired linked `OrderAddOn`.
12. **Resync `Order.selectedPhotoCount`** using the formula above.

Idempotency note:
- The materializer must produce the same final row state on retry of the *whole transaction* (Task 6's `withRetry`). It is not safe to call the materializer twice within a single transaction with the same pending snapshot argument — draft-id resolution would re-allocate. Callers must invoke it exactly once per commit attempt.

Returned `draftToOrderEntityMap`:
- Contains every `draft:*` id that appears in the pending snapshot — including both selection draft ids and linked-product draft ids when both are present.
- Does **not** include real `Order*` row ids that appear in the snapshot unchanged. The mapper does not need them resolved.

Reuse rules:

- Reference the AW materializers (`materializePackageTierChangeEdits`, `materializeAddOnEdits`, `materializeItemUpgradeEdits`, `materializePhotoCountEdits`, `finalizeSessionConfigurationSelectionEdits`) for per-table write logic and invariants. Do not import them. The new materializer is snapshot-driven, not edit-op-driven.
- Reuse `priceSelections` from `@/modules/session-configurations/session-configuration-pricing` only if needed for normalization; the snapshot already carries locked prices, so resolving catalog prices is usually unnecessary.

Disallowed:

- No reads from `InvoiceLineItem`.
- No reads from `OrderCommitDraft.pendingOpsJson`.
- No writes to invoices, payments, allocations, applications, refunds, or credit notes.
- No call into `adjustment-workspace.service.ts`.

Acceptance tests:

- Materializer applied to a pending snapshot equal to baseline produces zero row changes.
- Each diff kind (package upgrade/downgrade/swap, add-on add/remove/quantity, package-item upgrade add/remove/quantity, photo add/decrease per media, session-config add/remove, linked-product add/remove) produces the expected `Order*` row state.
- Retry-safe: aborting a transaction mid-materializer and re-running the whole transaction produces the same final row state.
- `draftToOrderEntityMap` covers every `draft:*` id in the snapshot, including both selection and linked-product draft ids when a paired linked-product is newly staged.
- Removing a session-configuration selection that owns a linked `OrderAddOn` succeeds without FK violations and deletes both rows per the write order.
- Original-package fields (`originalPackageId`, `originalPackageNameSnapshot`, `originalPackagePriceSnapshot`, `bookingPackageId`) are never written by the materializer.
- `Order.selectedPhotoCount` after materialization equals the sum of per-package `selectedPhotoCount`.
- No `InvoiceLineItem` read in the materializer source.

### Task 3 — Diff to financial-line mapper (pure)

File: `src/modules/order-commits/order-commit-financial-emission.service.ts`.

Public exports:

- `mapOrderCommitDiffToFinancialLines(input): OrderCommitFinancialEmission`
- `ORDER_COMMIT_CREDIT_NOTE_REASON` constants
- Types: `OrderCommitFinancialEmission`, `OrderCommitAdjustmentReversal`, `OrderCommitOpenAdjustmentLine`, `OrderCommitCreditNoteReason`, `MapOrderCommitDiffToFinancialLinesInput`

Module constraints:

- Pure function. No `@/lib/db` import. No `prisma` import.
- No imports from `@/modules/invoices`, `@/modules/refunds`, `@/modules/payments`, or `@/modules/financial/edit-classifier`.
- All money in the signature is JavaScript `number`, rounded by `Number(value.toFixed(3))`.
- Idempotent.

Signature:

```ts
export type MapOrderCommitDiffToFinancialLinesInput = {
  diff: OrderCommitSnapshotDiff;
  baselineSource: OrderCommitPreviewBaselineSource;
  draftToOrderEntityMap: ReadonlyMap<string, string>;
  openAdjustmentLinesByCause: ReadonlyMap<string, readonly OrderCommitOpenAdjustmentLine[]>;
};

export type OrderCommitOpenAdjustmentLine = {
  invoiceLineId: string;
  invoiceId: string;
  causeOrderEntityKind: OrderEntityKind;
  causeOrderEntityId: string;
  remainingAmount: number;
  isPaid: boolean;
  lineSnapshot: { name: string };
};

export type OrderCommitAdjustmentReversal = {
  reason: OrderCommitCreditNoteReason;
  parentAdjustmentInvoiceId: string;
  targetInvoiceLineId: string;
  causeOrderEntityKind: OrderEntityKind;
  causeOrderEntityId: string;
  amount: number;
  description: string;
};

export type OrderCommitFinancialEmission = {
  adjustmentLines: AdjustmentLineInput[];
  creditNoteFinalLines: Array<{
    line: CreditNoteLineInput;
    reason: OrderCommitCreditNoteReason;
  }>;
  adjustmentReversals: OrderCommitAdjustmentReversal[];
  totals: {
    positiveTotal: number;
    negativeTotal: number;
    netDelta: number;
    reversalTotal: number;
    creditNoteFinalTotal: number;
  };
};
```

Reason codes (locked):

```ts
export const ORDER_COMMIT_CREDIT_NOTE_REASON = {
  REMOVED_ADDON:                          "REMOVED_ADDON",
  ADDON_QUANTITY_DECREASE:                "ADDON_QUANTITY_DECREASE",
  REMOVED_PACKAGE_ITEM_UPGRADE:           "REMOVED_PACKAGE_ITEM_UPGRADE",
  PACKAGE_ITEM_UPGRADE_QUANTITY_DECREASE: "PACKAGE_ITEM_UPGRADE_QUANTITY_DECREASE",
  REMOVED_EXTRA_PHOTO:                    "REMOVED_EXTRA_PHOTO",
  EXTRA_PHOTO_QUANTITY_DECREASE:          "EXTRA_PHOTO_QUANTITY_DECREASE",
  PACKAGE_TIER_DOWNGRADE:                 "PACKAGE_TIER_DOWNGRADE",
  REMOVED_SESSION_CONFIGURATION:          "REMOVED_SESSION_CONFIGURATION",
  REMOVED_LINKED_PRODUCT_ADD_ON:          "REMOVED_LINKED_PRODUCT_ADD_ON",
} as const;
```

Per-diff-kind rules (apply exactly one rule per `lineDiff`):

- **PACKAGE `PACKAGE_CHANGED` positive delta** → one adjustment line: `lineType=PACKAGE_UPGRADE`, `quantity=1`, `unitPrice=moneyDelta`, cause `PACKAGE_TIER_UPGRADE` + `pending.orderEntityId`. Description: `Package upgrade: ${baseline.label} → ${pending.label}`.
- **PACKAGE `PACKAGE_CHANGED` negative delta** → credit-note candidate: `lineType=MANUAL_DISCOUNT`, `quantity=1`, `unitPrice=abs(moneyDelta)`, cause `PACKAGE_TIER_UPGRADE` + `pending.orderEntityId`. Description: `Package downgrade: ${baseline.label} → ${pending.label}`. Reason: `PACKAGE_TIER_DOWNGRADE`. Routed through reversal algorithm.
- **PACKAGE `PACKAGE_CHANGED` zero delta** → no output.
- **PACKAGE `PRICE_CHANGED` / `QUANTITY_CHANGED` / `ADDED` / `REMOVED`** → reject `ORDER_COMMIT_FINANCIAL_EMISSION_INVALID_PACKAGE_DIFF`.
- **ADD_ON `ADDED`** → adjustment line: `lineType=ADD_ON`, `quantity=pending.quantity`, `unitPrice=pending.unitPrice`, cause `ADDON` + resolved entity id. Description: `pending.label`.
- **ADD_ON `REMOVED`** → credit-note candidate: `lineType=MANUAL_DISCOUNT`, `quantity=baseline.quantity`, `unitPrice=baseline.unitPrice`, cause `ADDON` + `baseline.orderEntityId`. Description: `Removed: ${baseline.label}`. Reason: `REMOVED_ADDON`.
- **ADD_ON `QUANTITY_CHANGED` positive delta** → adjustment line: `lineType=ADD_ON`, `quantity=quantityDelta`, `unitPrice=pending.unitPrice`, cause `ADDON` + `pending.orderEntityId`. Description: `pending.label`.
- **ADD_ON `QUANTITY_CHANGED` negative delta** → credit-note candidate: `lineType=MANUAL_DISCOUNT`, `quantity=abs(quantityDelta)`, `unitPrice=baseline.unitPrice`, cause `ADDON` + `baseline.orderEntityId`. Description: `Decreased: ${baseline.label}`. Reason: `ADDON_QUANTITY_DECREASE`.
- **ADD_ON `PRICE_CHANGED`** → reject `ORDER_COMMIT_FINANCIAL_EMISSION_PRICE_CHANGE_FORBIDDEN`.
- **PACKAGE_ITEM_UPGRADE** → same shape as ADD_ON with `causeOrderEntityKind=UPGRADE`. Adjustment `lineType` is `ADD_ON`. Reasons: removed → `REMOVED_PACKAGE_ITEM_UPGRADE`, qty decrease → `PACKAGE_ITEM_UPGRADE_QUANTITY_DECREASE`.
- **SELECTED_PHOTO_EXTRA `ADDED`** → adjustment line: `lineType=EXTRA_PHOTOS`, `quantity=pending.quantity`, `unitPrice=pending.unitPrice`, cause `EXTRA_PHOTO` + `${pending.parentOrderPackageId}:${pending.metadata.mediaType}`.
- **SELECTED_PHOTO_EXTRA `QUANTITY_CHANGED` positive delta** → adjustment line: `lineType=EXTRA_PHOTOS`, `quantity=quantityDelta`, `unitPrice=pending.unitPrice`, same cause id rule.
- **SELECTED_PHOTO_EXTRA `REMOVED`** → credit-note candidate: reason `REMOVED_EXTRA_PHOTO`. Cause id derived from `baseline.parentOrderPackageId` + `baseline.metadata.mediaType`.
- **SELECTED_PHOTO_EXTRA `QUANTITY_CHANGED` negative delta** → credit-note candidate: reason `EXTRA_PHOTO_QUANTITY_DECREASE`, `quantity=abs(quantityDelta)`, `unitPrice=baseline.unitPrice`.
- **SELECTED_PHOTO_EXTRA `PRICE_CHANGED`** → reject `ORDER_COMMIT_FINANCIAL_EMISSION_PRICE_CHANGE_FORBIDDEN`.
- **SESSION_CONFIGURATION zero-value** (`baseline.unitPrice = 0` AND `pending.unitPrice = 0`) → no financial line regardless of change kind.
- **SESSION_CONFIGURATION financial `ADDED`** → adjustment line: `lineType=SESSION_CONFIGURATION`, `quantity=1`, `unitPrice=pending.unitPrice`, cause `SESSION_CONFIGURATION_SELECTION` + resolved selection id. Description: `pending.label`.
- **SESSION_CONFIGURATION financial `REMOVED`** → credit-note candidate: reason `REMOVED_SESSION_CONFIGURATION`, `unitPrice=baseline.unitPrice`. Description: `Removed: ${baseline.label}`.
- **SESSION_CONFIGURATION `PRICE_CHANGED`** → reject `ORDER_COMMIT_FINANCIAL_EMISSION_PRICE_CHANGE_FORBIDDEN`. Spec 122's session-configuration reducer must decompose price changes into REMOVED + ADDED snapshot lines (see §11).
- **SESSION_CONFIGURATION `QUANTITY_CHANGED`** → reject `ORDER_COMMIT_FINANCIAL_EMISSION_INVALID_QUANTITY`. Selections have quantity 1.
- **LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON** → mirror ADD_ON behavior with `causeOrderEntityKind=ADDON`. Reasons: removed → `REMOVED_LINKED_PRODUCT_ADD_ON`; quantity decrease that fully removes the line → `REMOVED_LINKED_PRODUCT_ADD_ON`; quantity decrease that leaves a positive quantity → `ADDON_QUANTITY_DECREASE`.
- **LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON `METADATA_CHANGED`** → no output. (Snapshot-only refresh, e.g. label normalization.)
- **LINKED_PRODUCT pairing invariant** — if a selection line and its linked-product add-on line are both present in the diff with `changeKind != UNCHANGED`, both must be on the same side (both `ADDED`, both `REMOVED`, or both `QUANTITY_CHANGED` with matching sign). Asymmetric pairs (e.g., selection `UNCHANGED` while linked-product `QUANTITY_CHANGED`, or selection `REMOVED` while linked-product `QUANTITY_CHANGED`) throw `ORDER_COMMIT_LINKED_PRODUCT_PAIR_BROKEN`. Pricing/numeric/option/counter-pricing changes that would alter `unitPrice` or quantity must be decomposed into REMOVED + ADDED at the reducer layer per the Spec 122 amendment in §11.

ADJ-reversal routing algorithm (every credit-note candidate above runs through this):

```
function route(candidate):
  primaryKey = `${candidate.causeOrderEntityKind}:${candidate.causeOrderEntityId}`
  openLines  = workingMap.get(primaryKey) ?? []
  remaining  = round3(candidate.unitPrice * candidate.quantity)

  for each openLine in openLines, sorted by (invoiceSeq asc, sortOrder asc, invoiceLineId asc):
    if remaining < 0.001: break
    if openLine.remainingAmount < 0.001: continue

    reversalAmount = round3(min(remaining, openLine.remainingAmount))
    emit adjustmentReversal {
      reason:                    candidate.reason,
      parentAdjustmentInvoiceId: openLine.invoiceId,
      targetInvoiceLineId:       openLine.invoiceLineId,
      causeOrderEntityKind:      candidate.causeOrderEntityKind,
      causeOrderEntityId:        candidate.causeOrderEntityId,
      amount:                    reversalAmount,
      description:               candidate.description,
    }
    remaining = round3(remaining - reversalAmount)
    openLine.remainingAmount = round3(openLine.remainingAmount - reversalAmount)

  if remaining >= 0.001:
    emit creditNoteFinalLines entry with the candidate's lineType, description, cause, reason,
    quantity = 1, unitPrice = remaining.
  // else: sub-fils residual; drop silently.
```

Routing rules:

- The mapper clones `openAdjustmentLinesByCause` and each `openLine` on entry. The caller's map is never mutated.
- Within one invocation, later candidates see decremented `remainingAmount` from earlier candidates that shared a cause key.
- Open-ADJ lines are consumed in **chronological** order: `Invoice.invoiceSeq asc`, then `InvoiceLineItem.sortOrder asc`, then `InvoiceLineItem.id asc`. cuid lexicographic ordering is **not** sufficient because cuids are only loosely time-monotonic. Task 4 (`buildOpenAdjustmentLineMap` extension) is responsible for emitting open lines in this order so the mapper can iterate without re-sorting.
- The mapper looks up exactly one canonical key per candidate. Legacy AW cause-id formats (e.g., `"package-tier-upgrade"`, `"Extra digital photos"`) are **not** the mapper's concern. Task 4's `buildOpenAdjustmentLineMap` extension is responsible for re-keying legacy AW open ADJ entries to their canonical Phase-4 keys before passing the map to the mapper. See Task 4 for the legacy-cause-id fallback rules.
- `openLine.isPaid` is not propagated. `Order.refundPending` is derived by Task 4 from the preview's `documentPlan.kind` plus payment state.
- Capacity (`computeCreditNoteCapacityForFinal`) is not checked here; Task 4 enforces a pre-check before calling `createCreditNoteWithClient`, and `createCreditNoteWithClient` itself enforces it again at the DB boundary.
- Reversal and residual descriptions are identical. Distinguishing the two is the consumer's job via the output array.

Determinism and ordering:

- `diff.lineDiffs` is already sorted by stableKey (Spec 123). The mapper preserves input order.
- `adjustmentLines` and `creditNoteFinalLines` ordering follows stableKey of producing diffs.
- `adjustmentReversals` ordering: producing diff stableKey, then `Invoice.invoiceSeq asc`, then `InvoiceLineItem.sortOrder asc`, then `InvoiceLineItem.id asc`.
- Multiple outputs from a single diff appear consecutively in their respective arrays.

Totals invariants (both must hold after iteration, both checked with one-fils tolerance):

- `totals.negativeTotal == totals.reversalTotal + totals.creditNoteFinalTotal`
- `totals.positiveTotal - totals.negativeTotal == round3(diff.netDelta)`

Both fields `reversalTotal` and `creditNoteFinalTotal` are positive magnitudes (the sum of the `amount` field across reversals and `unitPrice * quantity` across `creditNoteFinalLines`, respectively).

Rejection codes:

- `ORDER_COMMIT_FINANCIAL_EMISSION_INVALID_PACKAGE_DIFF`
- `ORDER_COMMIT_FINANCIAL_EMISSION_PRICE_CHANGE_FORBIDDEN`
- `ORDER_COMMIT_FINANCIAL_EMISSION_UNRESOLVED_DRAFT_ID`
- `ORDER_COMMIT_FINANCIAL_EMISSION_INVALID_QUANTITY`
- `ORDER_COMMIT_FINANCIAL_EMISSION_INVALID_UNIT_PRICE`
- `ORDER_COMMIT_FINANCIAL_EMISSION_BASELINE_LINE_MISSING`
- `ORDER_COMMIT_FINANCIAL_EMISSION_PENDING_LINE_MISSING`
- `ORDER_COMMIT_LINKED_PRODUCT_PAIR_BROKEN`
- `ORDER_COMMIT_FINANCIAL_EMISSION_TOTAL_MISMATCH` — either totals invariant above fails the one-fils tolerance.

Money discipline:

- Use `round3(x) = Number(x.toFixed(3))`.
- Apply once per emitted line value and after each subtraction in the routing algorithm.
- One-fils floor (`< 0.001`) is the canonical "zero" threshold for residuals and totals tolerance.
- Quantities are always positive integers.

What the mapper does not do:

- No DB access. No service imports. No mutation of caller state.
- Does not decide `CREDIT_NOTE` vs `REFUND_NEEDED` document plan.
- Does not look at `OrderCommitPreview.documentPlan.kind`, `Order.refundPending`, `pendingOpsJson`, or `InvoiceLineItem`.
- Does not emit `OrderCommitDocument` rows.
- Does not enforce manager-approval policy.
- Does not consult `creditNoteCapacityForFinal`.

Required tests (pure unit tests, wired into `test:centralization`):

- Positive-only cases: single add-on add; add-on qty increase; package upgrade; package-item upgrade add; extra-photo add (per media); session-config financial add; linked-product add.
- Negative-only cases, no open ADJ exposure: add-on remove; add-on qty decrease; package-item upgrade remove; extra-photo remove; package downgrade; session-config financial remove; linked-product remove.
- Reversal routing: full coverage; half coverage with residual; two open ADJ lines on same cause split correctly; two negative diffs sharing a cause consume sequentially; caller map not mutated (deep-equal pre/post); sub-fils residual dropped; open-ADJ lines consumed in `invoiceSeq` order, not cuid lex order.
- Decomposed session-configuration changes: a synthetic REMOVED + ADDED pair representing a price/numeric/option/pricing-mode/counter-pricing/financial-behavior change produces exactly one credit-note candidate at the old price plus one adjustment line at the new price, totals invariant holds.
- Linked-product paired changes: paired ADDED + ADDED → ADJ line for the linked add-on only; paired REMOVED + REMOVED → credit-note candidate for the linked add-on only; paired QUANTITY_CHANGED with matching sign → one ADJ or one credit-note line; LINKED_PRODUCT `METADATA_CHANGED` → no output.
- Mixed-sign: upgrade + add-on remove with no ADJ exposure → one ADJ + one credit-final; upgrade + ADJ-covered remove → one ADJ + one reversal + zero credit-final; net-zero meaningful swap totals invariant holds.
- Validation: PACKAGE PRICE_CHANGED rejected; ADD_ON PRICE_CHANGED rejected; SESSION_CONFIGURATION PRICE_CHANGED rejected (verifies reducer-decomposition assumption); LINKED_PRODUCT PRICE_CHANGED rejected; unresolved `draft:*` id rejected; broken linked-product pair (asymmetric sides) rejected; totals-mismatch rejected (both invariants); reversalTotal mismatch rejected.
- Determinism: same input → deep-equal output; output order matches input stableKey order.
- Source guard: no `@/lib/db`, `@/modules/invoices`, `@/modules/refunds`, `@/modules/payments`, or `@/modules/financial/edit-classifier` import.

### Task 4 — Invoice emission orchestrator

Inside `src/modules/order-commits/order-commit-execution.service.ts`, add a private orchestrator that runs after Task 2 materialization and Task 3 mapping, inside the same transaction.

Behavior:

- Resolve the parent FINAL invoice for the FinancialCase. There must be exactly one locked FINAL invoice for additive/reductive commits. For first commits (no FINAL exists yet), the parent invoice resolution is skipped because the commit emits the BASE invoice itself.
- Build `openAdjustmentLinesByCause` by calling an extended `buildOpenAdjustmentLineMap(financialCaseId, orderId, client)` (Task 4 must export this helper from `@/modules/invoices/invoice.service` so the orchestrator imports it cleanly). The extension is responsible for the legacy AW cause-id fallback (see below).
- Build `draftToOrderEntityMap` from the Task 2 materializer output. The map must contain every `draft:*` id that appears in the pending snapshot — both selection draft ids and linked-product draft ids when a paired linked-product is newly staged. Real `Order*` ids that pre-date the commit are passed through unmapped.
- Call `mapOrderCommitDiffToFinancialLines(...)` once and inspect its output.
- Pre-check credit capacity. Before invoking `createCreditNoteWithClient` for any FINAL-targeted residual, compute `expectedFinalCreditTotal = sum(creditNoteFinalLines.unitPrice * quantity)` and `currentCapacity = computeCreditNoteCapacityForFinal(parentFinalInvoiceId, client)`. If `expectedFinalCreditTotal > currentCapacity + 0.001`, throw `OrderCommitCreditCapacityExhaustedError` with a structured payload (`orderId`, `expectedFinalCreditTotal`, `currentCapacity`). The error must be raised before any invoice write so no partial document emission is left in the transaction.

Legacy AW cause-id fallback (temporary, removable in Phase 7):

The extended `buildOpenAdjustmentLineMap` must re-key legacy AW-emitted open ADJ lines to their canonical Phase-4 cause ids before returning the map. Legacy AW used:

- Package-tier upgrade: `causeOrderEntityKind = PACKAGE_TIER_UPGRADE`, `causeOrderEntityId = "package-tier-upgrade"` (literal).
- Extra photo: `causeOrderEntityKind = EXTRA_PHOTO`, `causeOrderEntityId = <display-name>` (e.g., `"Extra digital photos"`).

Spec 124 Phase-4 canonical cause ids:

- Package-tier upgrade: `causeOrderEntityId = OrderPackage.id`.
- Extra photo: `causeOrderEntityId = ${OrderPackage.id}:${mediaType}` where `mediaType ∈ { DIGITAL, PRINT }`.

Fallback algorithm (run while building the map, before keying):

1. For every open ADJ line with `causeOrderEntityKind = PACKAGE_TIER_UPGRADE` and `causeOrderEntityId = "package-tier-upgrade"`, re-key it under each `OrderPackage.id` belonging to the order. Open ADJ lines for package-tier-upgrade are scoped to one order; if the order has multiple packages, the legacy line maps to every package id and the mapper consumes whichever runs first via the chronological order. This is acceptable because legacy AW data is bounded (no real production history yet per `project_dev_data_reset`) and Phase 7 removes the fallback.
2. For every open ADJ line with `causeOrderEntityKind = EXTRA_PHOTO` and a legacy display-name cause id, parse the display name for `"digital"` / `"print"` (case-insensitive) and re-key under `${packageId}:DIGITAL` or `${packageId}:PRINT` for each `OrderPackage` in the order with a non-zero `extraDigitalCount` / `extraPrintCount` at the time the map is built. Same multi-package note as above.
3. Open ADJ lines whose `causeOrderEntityKind` is `ADDON`, `UPGRADE`, or `SESSION_CONFIGURATION_SELECTION` already use real id-based cause ids; no transformation is needed.
4. After re-keying, the map is keyed exclusively by canonical Phase-4 cause keys. The mapper looks up canonical keys only.

Mark the legacy-fallback branches with `// LEGACY-AW-FALLBACK — remove in Phase 7` comments and add a `tests/order-commits/legacy-cause-id-fallback.test.ts` covering both transformation paths.

Document emission:

- **`baselineSource = ORIGINAL_ORDER_COMPOSITION` or `EMPTY`** (first commit): emit BASE invoice via `createInvoiceForOrderWithClient(client, orderId, actorContext)`. The mapper output for first commits should be empty on the credit side because the baseline is original-package-only and a first-commit reduction is not legal; assert this invariantly. Record emission `{ invoice, role: BASE_INVOICE }`.
- **`baselineSource = LATEST_ORDER_COMMIT`** (later commit):
  - If `adjustmentLines` is non-empty: call `createAdjustmentInvoiceWithClient({ parentFinalInvoiceId, lines: adjustmentLines, createdByUserId: actorContext.actorUserId, notes }, client)`. Record emission `{ invoice, role: ADJUSTMENT_INVOICE }`.
  - If `adjustmentReversals` is non-empty: group by `parentAdjustmentInvoiceId`. For each group, call `createCreditNoteWithClient({ targetAdjustmentInvoiceId, lines, reason, createdByUserId: approvalActorUserId ?? actorContext.actorUserId, notes }, client)` with line-targeted entries (`targetInvoiceId` + `targetInvoiceLineId`). Each call produces one `CREDIT_NOTE` invoice. Record emission `{ invoice, role: CREDIT_NOTE }` per group.
  - If `creditNoteFinalLines` is non-empty: call `createCreditNoteWithClient({ targetFinalInvoiceId: parentFinalInvoiceId, lines, reason, createdByUserId: approvalActorUserId ?? actorContext.actorUserId, notes }, client)`. Record emission `{ invoice, role: CREDIT_NOTE }`.
- If `documentPlan.kind === REFUND_NEEDED`: after credit notes emit, set `Order.refundPending = true` via `client.order.update`. Do not issue a refund payment in V1.
- If `documentPlan.kind === ZERO_NET_AUDIT_COMMIT` or `NO_OP`: the mapper output is empty; no invoice work runs.

Reuse and never duplicate:

- `createInvoiceForOrderWithClient`, `createAdjustmentInvoiceWithClient`, `createCreditNoteWithClient` — the orchestrator passes the transaction `client` to each.
- `recalculateInvoiceStatus` is called by the reused services; do not call again.
- `assertFinancialCaseInvariants(financialCaseId, client)` is called once at the end of the orchestrator (after document linking in Task 5).

Manager approval:

- The orchestrator validates approval requirement against the recomputed preview's `requiresApproval`. If `true` and `approvalActorUserId` is missing or not a manager/admin, throw a typed `OrderCommitApprovalRequiredError`. The manager id is stored in `OrderCommit.metadataJson.approvalActorUserId`. `OrderCommit.committedByUserId` is the staff `actorContext.actorUserId`.

Returns to Task 6:

```ts
type OrderCommitEmissionResult = {
  emissions: Array<{ invoice: Invoice; role: OrderCommitDocumentRole }>;
};
```

Acceptance tests (integration; reuse existing test harness patterns from `tests/financial/*`):

- First commit on a fresh order with no `OrderCommit` and a draft staging a package emits one BASE invoice, sets up document for linking, and respects deposit application.
- Later commit with a single add-on add emits one ADJUSTMENT invoice.
- Later commit with a single add-on remove against open ADJ exposure emits one CREDIT_NOTE targeting that ADJ (line-targeted).
- Later commit with a single add-on remove against no open ADJ exposure emits one CREDIT_NOTE targeting FINAL.
- Mixed-sign commit (upgrade + remove with no ADJ exposure) emits ADJUSTMENT + CREDIT_NOTE both.
- `REFUND_NEEDED` document plan: CREDIT_NOTE emits and `Order.refundPending = true`; no payment row is created.
- Zero-net audit commit: no invoice writes, no `OrderCommitDocument` writes (asserted via Task 5).
- Locked-invoice immutability: prior FINAL and prior ADJ row frozen-field checks unchanged.
- `assertFinancialCaseInvariants` passes after every successful run.

### Task 5 — OrderCommitDocument writer

File: `src/modules/order-commits/order-commit-document.service.ts`.

Public entry point:

```ts
export async function createOrderCommitDocumentLinks(input: {
  orderCommitId: string;
  emissions: Array<{ invoice: { id: string }; role: OrderCommitDocumentRole }>;
  client: Prisma.TransactionClient;
}): Promise<{ created: number }>;
```

Behavior:

- For each emission, insert one `OrderCommitDocument` row with `orderCommitId`, `invoiceId = emission.invoice.id`, `role = emission.role`.
- `BASE_INVOICE`, `ADJUSTMENT_INVOICE`, and `CREDIT_NOTE` (whether targeting FINAL or ADJ) all map to the matching `OrderCommitDocumentRole`.
- Zero-net and no-op commits produce zero emissions and therefore zero rows.
- The uniqueness constraint `@@unique([orderCommitId, invoiceId, role])` prevents duplicate links. The writer relies on the constraint; it does not pre-check.
- The writer does not link payments, refund records, or audit rows. `OrderCommitDocument` is invoice-only in V1.

Acceptance tests:

- Each Task 4 emission produces exactly one `OrderCommitDocument` row with the correct role.
- Zero-net commits produce zero `OrderCommitDocument` rows.
- Duplicate insertion attempts surface as Prisma unique-constraint errors.

### Task 6 — `commitOrderChanges` orchestrator

Public entry point in `src/modules/order-commits/order-commit-execution.service.ts`:

```ts
export async function commitOrderChanges(input: {
  orderId: string;
  expectedDraftVersion: number;
  approvalActorUserId?: string;
  actorContext: ActorContext;
  client?: PrismaClient;
}): Promise<OrderCommitExecutionResult>;

export type OrderCommitExecutionResult = {
  orderCommit: { id: string; sequence: number };
  emittedDocuments: Array<{
    orderCommitDocumentId: string;
    invoiceId: string;
    role: OrderCommitDocumentRole;
  }>;
};
```

Transaction:

- Isolation: `Prisma.TransactionIsolationLevel.Serializable`.
- Retry: `withRetry` on `P2034` and on unique-constraint conflicts for `(orderId, sequence)` and `(orderId, committedFromDraftVersion)`.
- Lock order: `Order` → `OrderCommitDraft` → latest `OrderCommit` → parent locked `Invoice` (if any).

Steps inside the transaction:

1. Load and lock the `Order` row.
2. Load the active `OrderCommitDraft` by `orderId`. Assert `draft.version === expectedDraftVersion`; otherwise throw `OrderCommitStaleDraftError`.
3. Load the latest `OrderCommit` for the order.
4. Resolve the baseline via `resolveOrderCommitPreviewBaseline({ orderId, client })`.
5. Compute the preview by calling the existing pipeline (`diffOrderCommitSnapshots` → `classifyOrderCommitPreview` → `buildOrderCommitApprovalAndDocumentPreview`) inside the transaction. Re-running the pipeline is required because Order rows and open-ADJ exposure may have changed since the UI fetched the preview.
6. Validate approval: if `preview.requiresApproval` is true, verify `approvalActorUserId` belongs to an ADMIN or MANAGER; otherwise throw `OrderCommitApprovalRequiredError`.
7. Call `materializeOrderCommitDraftIntoOrderRows({ orderId, pendingSnapshot, actorContext, client })`. Receive `draftToOrderEntityMap`.
8. If the document plan implies any financial emission (i.e., not `ZERO_NET_AUDIT_COMMIT` or `NO_OP`):
   - Resolve the parent FINAL invoice id for the financial case (single locked FINAL).
   - Build `openAdjustmentLinesByCause` via `buildOpenAdjustmentLineMap(financialCaseId, client)`.
   - Call `mapOrderCommitDiffToFinancialLines({ diff, baselineSource, draftToOrderEntityMap, openAdjustmentLinesByCause, parentFinalInvoiceId })`.
   - Invoke Task 4 emission orchestrator; receive `emissions`.
9. Create the new `OrderCommit` row:
   - `sequence = latestCommit.sequence + 1`, or `1` if none.
   - `previousCommitId = latestCommit?.id ?? null`.
   - `kind = ORDER_COMMIT_KIND.<chosen>` — Phase 4 adds two kinds: `ADJUSTMENT` (covers ADJUSTMENT_INVOICE, CREDIT_NOTE, REFUND_NEEDED emissions and any combination of these) and `AUDIT` (covers ZERO_NET_AUDIT_COMMIT and NO_OP). The existing `BASELINE` kind is used for first commits emitting BASE_INVOICE.
   - `status = ORDER_COMMIT_STATUS.COMMITTED`.
   - `snapshotVersion = ORDER_COMMIT_SNAPSHOT_VERSION`.
   - `snapshotJson = pendingSnapshot` (the draft's pending snapshot becomes the new committed truth).
   - `metadataJson = { commitKind: preview.commitKind, documentPlanKind: preview.documentPlan.kind, approvalActorUserId: approvalActorUserId ?? null, netDelta: preview.netDelta }`.
   - `committedByUserId = actorContext.actorUserId` (Decision 8).
   - `committedFromDraftVersion = draft.version` (the version observed under the lock; idempotency guard).
   - `legacyAdjustmentWorkspaceId = null` for new commits.
10. Call `createOrderCommitDocumentLinks({ orderCommitId, emissions, client })` if there are any emissions.
11. Record audit log via `recordAuditLog(client, actorContext, { entityType: ORDER_COMMIT, entityId: orderCommit.id, action: ORDER_COMMIT_CREATED, after: { ... }, context: { financialCaseId, orderId } })`. Add a new `AuditEntityType.ORDER_COMMIT` and `AuditAction.ORDER_COMMIT_CREATED` to the Prisma enums in Task 1 alongside the schema additions.
12. Record order activity via `recordOrderActivity(client, { orderId, userId: actorContext.actorUserId, type: ORDER_COMMITTED, title, description, metadata })`. Add `OrderActivityType.ORDER_COMMITTED` to Prisma in Task 1.
13. Delete the `OrderCommitDraft` row.
14. Call `assertFinancialCaseInvariants(financialCaseId, client)`.
15. Return `OrderCommitExecutionResult`.

Failure semantics:

- Any thrown error rolls back all writes including materialization, emissions, document links, the new `OrderCommit` row, audit, activity, and draft deletion.
- The `(orderId, committedFromDraftVersion)` unique constraint is the last-line defense against double-submit beyond `expectedDraftVersion`. A racing second commit observing the same version will fail on insert; `withRetry` will not retry this conflict — surface it as `OrderCommitConcurrentCommitError`.
- Locked invoices are never mutated; recovery from a bad commit is "issue a counter-commit" and is out of scope for Spec 124.

Acceptance tests (full end-to-end):

- First commit creates one `BASELINE` `OrderCommit`, one BASE_INVOICE `OrderCommitDocument`, deletes the draft, leaves `Order*` matching the pending snapshot.
- Later additive commit creates one `ADJUSTMENT` `OrderCommit`, one ADJUSTMENT_INVOICE document, deletes the draft.
- Later reduction with no open ADJ exposure creates one `ADJUSTMENT` `OrderCommit`, one CREDIT_NOTE document linked to FINAL.
- Later reduction with open ADJ exposure creates one `ADJUSTMENT` `OrderCommit`, one CREDIT_NOTE document with line-targeted application against the ADJ; FINAL is untouched.
- Mixed-sign commit creates one `ADJUSTMENT` `OrderCommit` with both ADJUSTMENT_INVOICE and CREDIT_NOTE documents.
- `REFUND_NEEDED` commit creates the CREDIT_NOTE document and sets `Order.refundPending = true`; no `Payment` row is inserted.
- Zero-net meaningful swap creates one `AUDIT` `OrderCommit` and zero `OrderCommitDocument` rows.
- Stale-draft commit attempt throws `OrderCommitStaleDraftError`; no rows are written.
- Reduction without manager approval throws `OrderCommitApprovalRequiredError`; no rows are written.
- Failed commit (forced via a mid-transaction throw) rolls back the draft (still present), `Order*` (unchanged), and any partial invoice/document/audit/activity rows.
- Double-submit race: two concurrent commits on the same `expectedDraftVersion` — one wins, the other fails with `OrderCommitConcurrentCommitError`.
- Legacy cause-id fallback: a commit reducing an item whose original ADJ was issued by AW with a legacy cause id (`"package-tier-upgrade"` or `"Extra digital photos"`) routes the reversal to the matching legacy open ADJ line via the canonical Phase-4 key produced by the `buildOpenAdjustmentLineMap` extension. FINAL credit residual is zero.
- Paid-ADJ reversal: a commit that reverses a fully-paid open ADJ line, with `currentRemainingAmount = 0` before commit, produces `documentPlan.kind === REFUND_NEEDED` from the preview, emits the CREDIT_NOTE document, sets `Order.refundPending = true`, and does **not** insert a `Payment` row.
- Credit-capacity precheck: a synthetic reduction whose FINAL-residual total exceeds `computeCreditNoteCapacityForFinal` throws `OrderCommitCreditCapacityExhaustedError` before any invoice write; the transaction rolls back; no `OrderCommit`, `OrderCommitDocument`, `Invoice`, audit, or activity row is created; the draft is untouched.
- FK delete order: a commit that removes a session-configuration selection owning a linked `OrderAddOn` succeeds with no FK violation; both rows are deleted; `Order.selectedPhotoCount` resync remains correct.
- Linked-product draft pair: a commit that newly stages a paired selection + linked add-on produces a `draftToOrderEntityMap` containing both draft ids resolved to their real `Order*` ids; the emitted ADJUSTMENT invoice's linked-product line uses the resolved `OrderAddOn.id` as `causeOrderEntityId`.
- Locked-invoice immutability tests from `tests/backend-invariants/` continue to pass.
- `npm run test:backend-invariants` and `npm run test:financial-invariants` pass.

## Dependent Spec Amendments

Two upstream specs need narrow clarifications. Apply them as part of Spec 124 implementation (Task 1 PR is the safest landing place for the doc edits because it is the earliest task that introduces Phase 4 conventions).

### Spec 122 amendment — session-configuration reducer decomposition

Add to `context/feature-specs/122-order-commit-draft-staging-reducers.md` under Task 8:

> **Decomposition of price-affecting or quantity-affecting session-configuration changes.** Any session-configuration change that would alter the snapshot `unitPrice` on a selection line, or the snapshot `quantity` or `unitPrice` on its paired `LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON` line, must decompose into a REMOVED of the baseline pair plus an ADDED of the pending pair. The reducer must not emit a `PRICE_CHANGED` snapshot line on either side, and must not emit a `QUANTITY_CHANGED` snapshot line on the linked-product side when the change derives from a selection edit. This keeps `pendingSnapshotJson` line identity stable, preserves the paired-ownership invariant, and lets the Spec 124 financial-line mapper remain pure.
>
> The decomposition rule covers every change shape that produces a unit-price or linked-quantity shift, including but not limited to:
>
> - Catalog price restage (`snapshotPriceDelta` shift).
> - `snapshotFinancialBehavior` shift between `OPERATIONAL` and `FINANCIAL`.
> - `snapshotPricingMode` shift between `FLAT` and `PER_UNIT` (or any other mode introduction).
> - `snapshotCounterPricingMode` shift on counter-priced selections.
> - `numericValue` change on a `PER_UNIT`-priced selection (changes both `unitPrice` and linked add-on quantity).
> - `optionId` change that resolves to a different option price.
> - `snapshotOptionLabel` change that derives from a different option (where the label is the catalog key for pricing).
>
> Pure label normalization that does **not** alter `unitPrice` or linked quantity (e.g., catalog label rename for an unchanged option/value) may continue to produce a `METADATA_CHANGED` snapshot line. Spec 124's mapper produces no output for such METADATA_CHANGED lines.
>
> Operational-only selections (`snapshotFinancialBehavior = OPERATIONAL` with `unitPrice = 0`) are not subject to the decomposition rule because changes to them do not shift `unitPrice`; they may continue to update in place. If an OPERATIONAL selection transitions to FINANCIAL (or vice versa), that transition crosses the `unitPrice` boundary and is covered by the decomposition rule above.
>
> Spec 124's mapper continues to reject `PRICE_CHANGED` and `QUANTITY_CHANGED` on `SESSION_CONFIGURATION` and `LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON` lines. The rejection serves as the structural guard that this amendment is honored.

### Spec 123 amendment — informational `documentPlan.kind`

Add to `context/feature-specs/123-order-commit-preview-diff-engine.md` under Task 5:

> `documentPlan.kind` is informational. When `diff.netDelta > 0` and `diff` also contains negative-delta lines (a mixed-sign commit), the preview returns `documentPlan.kind = ADJUSTMENT_INVOICE` chosen by net sign. Spec 124 commit execution emits whichever documents the financial-line mapper actually produces, possibly an `ADJUSTMENT` and a `CREDIT_NOTE` in the same commit. The DTO's `documentPlan.kind` must not be used as a routing gate. Approval requirement, payment impact, and refund impact remain driven by net sign + payment state.

## Observability Checklist

### Dashboards / Metrics

- No production dashboard is required in Spec 124.
- Structured logs (optional) may use `order_commit.committed`, `order_commit.materialized`, `order_commit.emission_failed`, `order_commit.concurrent_conflict`. Names must use `order_commit.*` and must not expose Adjustment Workspace terminology.
- Errors thrown by the orchestrator (`OrderCommitStaleDraftError`, `OrderCommitApprovalRequiredError`, `OrderCommitConcurrentCommitError`, `ORDER_COMMIT_FINANCIAL_EMISSION_*`) must include `orderId` and, where available, `draftId`, `draftVersion`, `commitKind`, and `documentPlanKind`. Do not expose raw Prisma errors to users.

### Rollback Plan

- Schema rollback: drop `OrderCommitDocument`, drop `OrderCommit.committedFromDraftVersion`, drop the new `AuditEntityType.ORDER_COMMIT`, `AuditAction.ORDER_COMMIT_CREATED`, and `OrderActivityType.ORDER_COMMITTED` enum values. PostgreSQL enum rollback is awkward; if migration friction is significant, follow Spec 120's precedent and prefer string columns plus TypeScript/Zod constants for the new enum values.
- Code rollback: remove the four new module files (`order-commit-execution.service.ts`, `order-commit-materialization.service.ts`, `order-commit-financial-emission.service.ts`, `order-commit-document.service.ts`) and revert the index export additions.
- Data rollback: deleting `OrderCommitDocument` rows is safe. Deleting Phase 4 `OrderCommit` rows requires also reverting `Order*` materialization — recovery is to issue a counter-commit, not to mutate Phase 4 rows.
- Locked invoices remain immutable; rollback never mutates them.

### Customer-Visible Surface

- None. Staff should see no route, copy, payment, invoice, POS control, or Adjustment Workspace behavior change after Spec 124 implementation. Phase 5 introduces POS routing through OrderCommit; Phase 6 introduces UI changes.
- `Order.refundPending = true` on `REFUND_NEEDED` commits surfaces in the existing refund-pending UI just as it does for AW-finalized refund-needed cases.

## Post-Implementation

- Update `context/progress-tracker.md` Now / Key State and Feature History after code lands.
- Update `context/target-data-model.md` with:
  - `OrderCommitDocument` as the commit → financial-document link model.
  - `OrderCommit.committedFromDraftVersion` as the database-level concurrency guard.
  - Commit execution semantics: snapshot-driven materialization, snapshot-diff financial-line mapping, multi-document emission, draft deletion.
- Add the Spec 122 and Spec 123 amendments listed in §11.
- Leave `context/reviews/unified-order-commit-live-pos-roadmap.md` and `context/reviews/unified-order-commit-architecture-plan.md` unchanged unless implementation discovers approved-roadmap drift.

## Acceptance Criteria

- `OrderCommitDocument` exists with `id`, `orderCommitId`, `invoiceId`, `role`, `createdAt`, the `@@unique([orderCommitId, invoiceId, role])` constraint, and the documented indexes.
- `OrderCommit.committedFromDraftVersion` exists with the `@@unique([orderId, committedFromDraftVersion])` constraint.
- `commitOrderChanges` exists under `src/modules/order-commits/` and is the single public commit entry point.
- `mapOrderCommitDiffToFinancialLines` exists as a pure function with no DB, no service, and no `Prisma.Decimal` import dependencies.
- `materializeOrderCommitDraftIntoOrderRows` writes `Order*` rows from `OrderCommitDraft.pendingSnapshotJson` and produces a `draftToOrderEntityMap`. No `InvoiceLineItem` reads.
- `createOrderCommitDocumentLinks` writes one `OrderCommitDocument` row per Task 4 emission and zero rows for zero-net or no-op commits.
- Commit execution is atomic at `Serializable` isolation with `withRetry` for P2034 and unique-conflict retries.
- The `(orderId, committedFromDraftVersion)` unique constraint blocks double-submit beyond `expectedDraftVersion`.
- Locked invoices remain immutable; no Spec 124 code path mutates a locked invoice.
- Reductions emit one CREDIT_NOTE per parent ADJ (line-targeted) plus at most one CREDIT_NOTE against FINAL (residual).
- Reversal routing consumes open ADJ lines in chronological order (`Invoice.invoiceSeq`, then `InvoiceLineItem.sortOrder`, then `InvoiceLineItem.id`), not cuid lexicographic order.
- Legacy AW cause-id formats are re-keyed to canonical Phase-4 cause ids inside `buildOpenAdjustmentLineMap`; the mapper never sees legacy keys. Fallback branches are marked as removable in Phase 7.
- Reductions exceeding `computeCreditNoteCapacityForFinal` fail fast with `OrderCommitCreditCapacityExhaustedError`; no partial document is emitted.
- The materializer never writes to `originalPackageId`, `originalPackageNameSnapshot`, `originalPackagePriceSnapshot`, or `bookingPackageId`.
- `Order.selectedPhotoCount` after materialization equals the sum of per-package `selectedPhotoCount`.
- `REFUND_NEEDED` commits emit the credit residual and set `Order.refundPending = true` without issuing a refund payment.
- Zero-net audit commits create an `OrderCommit` row and zero `OrderCommitDocument` rows.
- The financial-line mapper is covered by all 32 numbered tests from Task 3.
- The full commit orchestrator is covered by all numbered tests from Task 6.
- New tests are wired into `scripts/run-centralization-tests.ts`.
- Existing POS, deposit, payment, refund, credit-note, adjustment, and Adjustment Workspace behavior is unchanged.
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector (`modules/financial-cases/projections/` for FinancialCase-bound surfaces) instead of re-deriving in pages or components. Money is read from raw projector fields and formatted via `src/lib/formatting/money.ts`. No `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run test:centralization` passes.
- `npm run test:backend-invariants` passes.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.

## Assumptions and Defaults

- Phase 4 introduces two new `OrderCommit.kind` values: `ADJUSTMENT` and `AUDIT`. The existing `BASELINE` kind is reused for first commits.
- Parent FINAL invoice resolution requires exactly one locked `InvoiceType.FINAL` invoice for the FinancialCase. Implementation asserts this loudly; multi-FINAL is treated as a data-integrity error.
- The materializer assumes Spec 122's `draft:*` prefix convention for newly staged entity ids.
- The financial-line mapper assumes Spec 122's session-configuration reducer decomposes price changes into REMOVED + ADDED snapshot lines (see §11).
- Description strings are English. Localization is a follow-up out of scope for Spec 124.
- Reversal and residual credit-note lines share descriptions. Distinguishing the two is the consumer's job via the emission output array.
- One-fils (`< 0.001`) is the canonical zero threshold for money rounding, residual emission, and totals tolerance.
- Audit and activity entity/action enum additions are folded into the Task 1 schema PR alongside the new model.
