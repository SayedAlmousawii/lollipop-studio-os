## Goal

Introduce `AdjustmentWorkspace.operationalStateAppliedAt` as the idempotency primitive that future materialization specs will set when a workspace's edits are written back into operational rows. In this spec the column is added, wired into the finalize transaction (always set to `null` for now), and consulted by the invoice-line replay path so future materializing workspaces can opt out of replay cleanly. No materialization happens yet; this is the load-bearing flag landed before it's needed.

## Read First

- `prisma/schema.prisma` — `AdjustmentWorkspace`
- `src/modules/adjustment-workspace/adjustment-workspace.service.ts` — `markWorkspaceFinalized`, `getEffectiveCompositionForInvoice`, `applySignedInvoiceLines`
- Previous spec `112-ops1-order-package-identity-schema.md`

## Rules

- The flag is set inside the same transaction as `markWorkspaceFinalized`. No background job, no second write.
- A workspace with `operationalStateAppliedAt != null` is treated as fully materialized: every adjustment invoice line item it produced is skipped by composition replay.
- This spec does not materialize anything. Every finalize call still sets the flag to `null`. The skip path is reachable only via tests that construct a workspace with the flag manually set.
- The existing per-cause skip for `SESSION_CONFIGURATION_SELECTION` stays in place. It is the only per-cause skip until the projection is collapsed in the final spec.

## Scope

### In Scope

- Schema: add `AdjustmentWorkspace.operationalStateAppliedAt DateTime?` and a matching `@map` column name. Add an index if `getEffectiveCompositionForInvoice` would benefit from it; otherwise none.
- `markWorkspaceFinalized`: accept an optional `operationalStateAppliedAt` argument (default `null`); write it to the column.
- `getEffectiveCompositionForInvoice`: when iterating finalized workspaces, skip applying any workspace whose `operationalStateAppliedAt` is non-null. Already-materialized workspaces contribute zero composition deltas.
- Tests: a workspace row constructed with `operationalStateAppliedAt` set and a non-empty finalized adjustment invoice produces the same composition as `captureCurrentOrderComposition` alone.

### Out of Scope

- Any materialization of workspace edits into `OrderPackage`, `OrderAddOn`, or `OrderPackageItemUpgrade`.
- New `OrderActivity` event emissions.
- Removal of `applySignedInvoiceLines` or its per-cause `SESSION_CONFIGURATION_SELECTION` skip.

## Implementation Direction

The new column is nullable and defaults to `null`. The Prisma migration is small and non-destructive. Update the `markWorkspaceFinalized` helper signature to accept an `operationalStateAppliedAt: Date | null = null` parameter and pass it into the `update` data alongside `status`, `finalizedAdjustmentInvoiceId`, and `version`. Every existing caller passes nothing; the default keeps current behavior identical.

In `getEffectiveCompositionForInvoice`, the loop over `finalizedWorkspaceInvoices` is the right place to add the new skip. The query select must include `operationalStateAppliedAt` on the workspace level. If the flag is set, skip the entire workspace's invoice lines — do not call `applySignedInvoiceLines` for that workspace at all. The per-line `SESSION_CONFIGURATION_SELECTION` skip inside `applySignedInvoiceLines` remains untouched for workspaces that are still pre-materialization.

The intent is: when the next specs start setting the flag on finalize, those workspaces produce financial-only adjustment invoices and operational rows simultaneously, and the composition replay self-mutes for them. Test that contract here by writing a workspace row directly with the flag set.

## Post-Implementation

- Update `context/progress-tracker.md` Now / Key State.

## Acceptance Criteria

- `AdjustmentWorkspace.operationalStateAppliedAt` exists, is nullable, and defaults to `null`.
- Every existing finalize path still produces a workspace with `operationalStateAppliedAt = null`. Existing adjustment behavior is observably unchanged.
- A test that constructs a `FINALIZED` workspace with `operationalStateAppliedAt = new Date()` and a non-empty adjustment invoice with arbitrary line items proves `getEffectiveCompositionForInvoice` returns the same snapshot as `captureCurrentOrderComposition` for that order.
- Existing adjustment workspace integration tests pass without modification (the flag stays null on finalize).
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector (`modules/financial-cases/projections/` for FinancialCase-bound surfaces) instead of re-deriving in pages or components. Money is read from raw projector fields and formatted via `src/lib/formatting/money.ts`. No `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run build` passes.
- `npm run lint` passes.
