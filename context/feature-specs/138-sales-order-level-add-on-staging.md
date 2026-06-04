## Goal

Unblock standalone add-ons on the unified Sales surface by making the `ADD_ON` staging domain support **order-level** add-ons — add-ons attached to the order with no parent package — which is how the Add-On Marketplace has always worked. The investigation established this conclusively: the live marketplace quick-add path creates `OrderAddOn` rows with `orderPackageId = null`, the marketplace projection renders add-ons as one flat order-scoped list, and `OrderAddOn.orderPackageId` is populated only by session-configuration linked products (Category D) and by optional Adjustment Workspace scoping — never by the marketplace. The OrderCommit `ADD_ON` reducer, however, requires a package parent (modelled around the linked-product case and over-applied to true add-ons), so the Sales adapter's `addAddOn` / `removeAddOn` return `unsupportedHandlerResult`.

This spec makes `parentPackageTarget` **optional** on the `ADD_ON` staging change, teaches the reducer to stage order-level add-on lines (`parentOrderPackageId = null`), and wires the marketplace `addAddOn` / `removeAddOn` handlers through staging. It does **not** force marketplace add-ons to become package-scoped, and it keeps linked-product (D) add-ons strictly separate. As a bonus, it closes an existing gap: order-level add-ons are already *captured* into baseline snapshots (nullable `parentOrderPackageId`) but currently **cannot be removed via staging** because the reducer demands a package parent.

This is the only spec in the domain-completion set that changes the staging schema and a reducer; it is sequenced **after** Spec 137 so that linked-product (D) staging lands first and de-risks the shared `OrderAddOn` table.

## Read First

- `/tmp/pos-domain-blocked-workflows-investigation.md` — §1 (#1/#2/#3), §3 (the full add-on-model evidence and the order-level conclusion), §5 (Spec 138), §6 (sequenced after 137). Source of truth.
- `context/reviews/unified-order-commit-live-pos-roadmap.md` — Phase 5 canonical-source / projector rules.
- `context/feature-specs/122-order-commit-draft-staging-reducers.md` — `ADD_ON` reducer contract and the linked-product separation invariant.
- `context/feature-specs/137-sales-session-configuration-staging-unification.md` — linked-product (D) staging that must already be landed; this spec must not regress it.
- `src/modules/order-commits/order-commit-add-on-reducer.ts` — `reduceOrderCommitDraftAddOn`; `resolveParentPackageLine:205` (requires a package line — the core constraint to relax); `addCatalogAddOn:55` (existing-line match by `parentOrderPackageId === parentPackage.orderEntityId`); `resolveMutableAddOnLine:221` (package-scope assertion + linked-product rejection).
- `src/modules/order-commits/order-commit-draft.schema.ts:76` — `orderCommitDraftAddOnStagingChangeSchema` (`parentPackageTarget` currently required); `:142` `superRefine` (ADD requires productId/quantity; update/remove require target; linked-product protections).
- `src/modules/order-commits/order-commit.service.ts:1269` — `ADD_ON` staging-service case; `resolveStagedAddOnProduct:1384` resolves product price.
- `src/modules/order-commits/order-commit.service.ts:2039` — `addOnLine` capture (`parentOrderPackageId: addOn.orderPackageId`, nullable) — proof order-level add-ons are already captured.
- `src/modules/order-commits/order-commit-materialization.service.ts:576` — `createAddOn`; `:601` `addOnCreateData` already connects the package only when `line.parentOrderPackageId` is set (order-level path already supported in materialization).
- `src/modules/order-commits/sales-staging-handler-adapter.ts:84` — `createOrderCommitSalesAddOnHandlers` with the blocked `addAddOn` / `removeAddOn` stubs to replace.
- `src/modules/orders/pos-handlers.types.ts:44` — `POSAddOnHandlers` (`addAddOn({productId, quantity})`, `removeAddOn({addOnId})`, optional `changeAddOnQuantity`).
- `src/components/orders/pos-add-on-marketplace.tsx` — marketplace UI; `addAddOn`/`removeAddOn` form inputs (order-level; no package selector).
- `src/modules/orders/composition/projections/to-pos-add-on-marketplace.ts` — flat, order-level marketplace projection (no package grouping).
- `prisma/schema.prisma:812` — `OrderAddOn` (`orderPackageId String?`).

## Rules

- Implementation-only after approval. The change spans: the `ADD_ON` staging schema (make `parentPackageTarget` optional), the `ADD_ON` reducer (support null parent), the Sales add-on handler adapter, and tests. No materializer change (it already supports null parent). No UI component change beyond confirming the existing marketplace event maps cleanly.
- **Order-level is the default and only required model for marketplace add-ons.** Do not require a package selector, do not migrate existing null-package add-ons, and do not invent package-scoped marketplace behavior.
- **Package-scoped capability stays available** (some callers may pass `parentPackageTarget`), but the marketplace path passes none. Keep the reducer able to stage both; only relax the *requirement*.
- **Linked-product (D) add-ons remain untouched.** The reducer must still reject mutation of `LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON` lines via the add-on reducer (`resolveMutableAddOnLine`), and the schema must still reject a `draft:` `orderAddOnId` on linked products. Order-level true add-ons (`ADD_ON` line kind) are a distinct concern.
- Identity for order-level lines: a staged order-level add-on uses a service-assigned `draftOrderAddOnId` (as today) and `parentOrderPackageId = null`. Existing-line merge for ADD matches by (`parentOrderPackageId === null`, `catalogEntityId === productId`). Update/remove resolves the target line by id without requiring a package-parent match, after asserting the line is a true `ADD_ON` (not linked).
- The adapter is a thin mapper: `addAddOn({productId, quantity})` → `ADD_ON` ADD with no `parentPackageTarget`; `removeAddOn({addOnId})` → `ADD_ON` REMOVE with `target` = the add-on id. Exact `expectedVersion` forwarding, like the package/photo handlers.
- No business logic, pricing, or approval in the adapter. The staging service prices the product.
- No `@/lib/db` imports in the adapter. No Adjustment Workspace naming.

## Scope

### In Scope

- **Schema:** make `parentPackageTarget` optional in `orderCommitDraftAddOnStagingChangeSchema`. Preserve all existing `superRefine` rules (ADD requires productId + quantity; update/remove require target; linked-product `orderAddOnId` must not be `draft:`). Add a rule only if needed to keep linked-product changes well-formed; do not add a rule forcing a parent.
- **Reducer (`order-commit-add-on-reducer.ts`):**
  - Relax `resolveParentPackageLine` to return `null` when no `parentPackageTarget` is supplied (rename/adjust to an optional resolver), and have `addCatalogAddOn` set `parentOrderPackageId` from the resolved package or `null`.
  - Update the existing-line match in `addCatalogAddOn` to match order-level lines by (`parentOrderPackageId === null`, `catalogEntityId === productId`) and package-scoped lines by the package id as today.
  - Update `resolveMutableAddOnLine` so that, with no `parentPackageTarget`, it resolves the target line by id and asserts it is a true `ADD_ON` line (still rejecting `LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON`), without the package-scope equality check; with a `parentPackageTarget`, keep the existing package-scope assertion.
  - Preserve normalization, stored unit-price preservation on quantity updates, and zero-quantity removal behavior.
- **Adapter (`sales-staging-handler-adapter.ts`):** replace the blocked `addAddOn` / `removeAddOn` stubs in `createOrderCommitSalesAddOnHandlers` with real mappings to `ADD_ON` ADD / REMOVE changes (no `parentPackageTarget`), forwarding through an injected `stageSalesChangeAction` with exact `expectedVersion`. Wire `stageSalesChangeAction` and `expectedVersion` into `createOrderCommitSalesAddOnHandlers` (it currently takes no args); update the Sales page mount accordingly.
- **Bonus fix coverage:** an already-committed order-level add-on (null parent, captured in baseline) can now be staged for removal.
- Tests under `tests/order-commits/` and `tests/order-commits/sales-page-surface/`:
  - Reducer: order-level ADD creates a line with `parentOrderPackageId = null`; repeated ADD of the same product increments the same order-level line; UPDATE_QUANTITY and REMOVE resolve an order-level line by id; package-scoped ADD still works; linked-product lines are still rejected by the add-on reducer.
  - Schema: an `ADD_ON` change without `parentPackageTarget` validates; linked-product `draft:` `orderAddOnId` still rejected.
  - Adapter: `addAddOn` forwards an order-level ADD with exact `expectedVersion`; `removeAddOn` forwards a REMOVE targeting the add-on id; error/blocked states map to non-ok `HandlerResult`.
  - Integration: stage an order-level add-on, preview shows it, commit materializes an `OrderAddOn` with `orderPackageId = null`; remove a previously committed order-level add-on through staging.
- Wire new tests into `scripts/run-centralization-tests.ts`.
- Update `context/progress-tracker.md`.

### Out of Scope

- No materializer change (already supports null parent).
- No data migration. Existing null-package add-ons already match the order-level model.
- No package selector in the marketplace UI; no package-scoped marketplace behavior.
- No change to linked-product (D) staging shipped in Spec 137, the session-configuration reducer, or the selection service.
- No change to package-item upgrade (Spec 136) or the hotfix (Spec 135).
- No `changeAddOnQuantity` UI control (none exists today). If wiring the optional handler is trivial and a control is added, it may be included; otherwise defer (see Open Questions).
- No new financial behavior. Add-on deltas flow through the existing preview/commit engine.

## Implementation Direction

### Task 1 — Schema: optional parent

In `orderCommitDraftAddOnStagingChangeSchema`, change `parentPackageTarget: orderCommitDraftLineTargetSchema` to `.optional()`. Re-verify the `superRefine`: ADD still requires `productId` + `quantity`; update/remove still require `target`; linked-product `orderAddOnId` still must not start with `draft:`. No new "parent required" rule.

### Task 2 — Reducer: order-level support

- Replace `resolveParentPackageLine` with an optional resolver: if `change.parentPackageTarget` is present, resolve and assert it is a `PACKAGE` line (as today); else return `null`.
- `addCatalogAddOn`: set the new line's `parentOrderPackageId` to the resolved package's `orderEntityId` or `null`. Match existing lines by (`parentOrderPackageId`, `catalogEntityId`) where `parentOrderPackageId` may be `null`.
- `resolveMutableAddOnLine`: resolve the target line by id; reject linked-product lines; if a `parentPackageTarget` was supplied, keep the package-scope equality assertion; otherwise skip it. Keep the "not a true add-on line" guard.
- Keep `multiplyMoney`, normalization, and zero-quantity removal unchanged.

### Task 3 — Adapter: wire the marketplace handlers

Change `createOrderCommitSalesAddOnHandlers` to accept `{ orderId, expectedVersion, stageSalesChangeAction }` (matching `createOrderCommitSalesCompositionHandlers`). Implement:

```
async function addAddOn(input: { productId: string; quantity: number }) {
  "use server";
  return handlerResultFromActionState(
    await stageSalesChangeAction(orderId, expectedVersion, {
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
      action: "ADD",
      productId: input.productId,
      quantity: input.quantity,
      // no parentPackageTarget → order-level
    })
  );
}

async function removeAddOn(input: { addOnId: string }) {
  "use server";
  return handlerResultFromActionState(
    await stageSalesChangeAction(orderId, expectedVersion, {
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
      action: "REMOVE",
      target: addOnTarget(input.addOnId),
    })
  );
}
```

`addOnTarget` builds an `OrderCommitDraftLineTarget` resolving the committed add-on by id (use `orderEntityId`/`stableKey` consistent with how `addOnLine` capture sets `stableKey: order-add-on:{id}`). Update `app/orders/[orderId]/sales/page.tsx` to pass `orderId`, `expectedVersion`, and `stageSalesChangeAction` into `createOrderCommitSalesAddOnHandlers`.

### Task 4 — Tests + tracker

Add the reducer, schema, adapter, and integration tests in Scope; wire into the centralization runner; update the tracker.

## Observability Checklist

### Dashboards / Metrics

- None added. Order-level add-ons flow through the same staging/commit path as other domains.

### Rollback Plan

- Schema change is to a JSON-validated Zod schema (`parentPackageTarget` optional), not a DB migration — making a field optional is backward-compatible with existing staged changes that supplied it. Reducer change is additive (null-parent branch). Rollback = revert schema + reducer + adapter; no data migration, no non-recoverable state. Drafts staged during the window remain valid (order-level lines already match how the materializer and capture treat null parents).

### Customer-Visible Surface

- Staff can add/remove standalone add-ons (Album, Canvas, Prints, Digital) on the Sales surface; they appear in the staged-changes rail and commit with the order. Previously these controls produced an "add-on staging needs parent package scope" block. Already-committed order-level add-ons become removable through staging.

## Post-Implementation

- `context/progress-tracker.md` — "Now" line: order-level add-on add/remove now stages through OrderCommit on the Sales surface; all five staging domains (package, photo, add-on, package-item upgrade, session-configuration) are now wired end-to-end. Add a Key State note: marketplace add-ons are order-level (`orderPackageId = null`); `OrderAddOn.orderPackageId` is reserved for linked-product session configurations.
- Roadmap Phase 5.5 block — mark `ADD_ON` wired end-to-end and the domain-completion set finished; note Phase 6 (AW retirement) is now unblocked on domain coverage.

## Acceptance Criteria

- `parentPackageTarget` is optional in the `ADD_ON` staging change; an add-on can be staged with no package parent.
- The reducer stages order-level add-on lines (`parentOrderPackageId = null`), merges repeated ADDs of the same product into one order-level line, and resolves update/remove targets by id without a package-parent match.
- Package-scoped add-on staging still works; linked-product (D) add-ons are still rejected by the add-on reducer and the `draft:` `orderAddOnId` rule still holds.
- The marketplace `addAddOn` / `removeAddOn` handlers stage through OrderCommit with exact `expectedVersion`; they no longer return unsupported.
- A previously committed order-level add-on can be removed through staging.
- Committing a staged order-level add-on materializes an `OrderAddOn` with `orderPackageId = null`.
- No materializer, linked-product, session-configuration, or financial behavior changed; no data migration.
- New tests wired into `test:centralization`.
- `npm run test:centralization` passes.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.

## Open Questions (resolve before implementation)

1. **"Remove One" with quantity > 1:** The marketplace "Add Another" increments a single order-level line's quantity; "Remove One" currently maps to the add-on id. Should `removeAddOn` decrement (UPDATE_QUANTITY to qty−1) or delete the whole line (REMOVE)? Match current legacy behavior; if legacy deletes the row, REMOVE is correct, otherwise wire UPDATE_QUANTITY. Confirm against `removeOrderAddOn` semantics before implementation.
2. **`changeAddOnQuantity`:** No UI control exists today. Confirm it stays deferred, or add a minimal quantity control + wire the optional handler (`UPDATE_QUANTITY`) in this spec.
3. **Target shape for remove:** Confirm the canonical target field for resolving a committed order-level add-on (`stableKey: order-add-on:{id}` vs `orderEntityId`) so the adapter builds a target the resolver accepts on the first try.
