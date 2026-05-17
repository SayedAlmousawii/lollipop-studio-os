# 83b — POS Components: Handler-Agnostic Refactor

## Goal

Refactor the three POS composition modules (`POSPackageComposition`, `POSPhotoCountCard`, `POSAddOnMarketplace`) into handler-agnostic presentational components that take their mutation entry points as props. The sales page passes the existing commit-through server actions wrapped in the new prop shape; behavior on the sales page is **unchanged**. This phase enables 83c (workspace rewire) by removing the hardcoded coupling between these components and the sales-specific actions — but ships alone, with zero new consumers, to isolate refactor risk.

## Read First

- `context/feature-specs/83a-adjustment-workspace-edit-dsl.md` — sibling phase; this spec assumes 83a's edit DSL but does not depend on it being merged first.
- `src/components/orders/pos-package-composition.tsx` — primary refactor target (~1000 lines, includes `POSPhotoCountCard` and the deliverable upgrade dialog).
- `src/components/orders/pos-add-on-marketplace.tsx` — second refactor target.
- `app/orders/[orderId]/sales/actions.ts` — `updateOrderPackageAction`, `updateOrderSelectedPhotoCountAction`, `upgradeOrderPackageItemAction`, and the marketplace actions — the actions the components currently import directly.
- `src/components/orders/reductive-edit-approval-modal.tsx` — the inline approval modal these components trigger today.

## Rules

- **Zero behavior change on the sales page.** This is a pure refactor. Visual diffs, action payloads, error surfaces, modal triggers — all identical. Manual QA of the unlocked POS surface must show no observable difference.
- Components import **no** server actions directly. Every mutation routes through a `handlers` prop.
- The reductive-edit approval modal stays available but becomes opt-in via the handlers contract. On the sales page, opt-in stays on. (Opt-out is what 83c uses for the workspace, where approval consolidates at finalize — but no opt-out consumer exists in this phase.)
- No new consumers added in this phase. The workspace page is **not** rewired here.
- The handlers contract must be reusable beyond just the workspace (in principle), but don't over-engineer it. Shape it for the two known call sites: sales (commit-through) and adjustment workspace (staged).

## Scope

### In Scope

- Extract a `handlers` prop on each of:
  - `POSPackageComposition` (and its internal `PackageUpgradeDialog`, `DeliverableCard`)
  - `POSPhotoCountCard` / `POSPhotoLineForm`
  - `POSAddOnMarketplace`
- Define typed handler contracts in `src/modules/orders/order.types.ts` (or a new neighboring `pos-handlers.types.ts`):
  - `POSCompositionHandlers` — package tier change, deliverable upgrade, selected-photo-count change.
  - `POSAddOnHandlers` — marketplace add/remove/qty.
  - Each handler returns a `HandlerResult` discriminated union: `{ ok: true } | { ok: false, errors: Record<string, string[]> }`.
  - Include a `shouldPromptInlineApproval: boolean` flag (or a per-handler predicate) so the consumer decides whether to open `ReductiveEditApprovalModal` on reductive edits. Default `true` to match current sales behavior.
- Wrap the existing `updateOrder*Action` server actions in thin adapters on the sales page and pass them via `handlers`. Each adapter shape-maps `FormData` ↔ typed payload and translates the action state into `HandlerResult`.
- Update the sales page (`app/orders/[orderId]/sales/page.tsx`) to construct and pass the handlers.
- Type tests / snapshot tests confirming the refactored components render the same DOM for the same inputs.

### Out of Scope

- The adjustment workspace consuming these components (that's 83c).
- New stage actions for the workspace (that's 83c).
- Any change to `updateOrder*Action` behavior or signatures.
- Splitting `POSPackageComposition` into multiple files. If a smaller split falls out naturally, fine — but it's not a goal.
- Migrating the components off `useActionState` if the handlers contract is expressible inside `useActionState`. (It should be — adapters can wrap `useActionState` calls.)

## Implementation Direction

### 1. Handler contracts

In `src/modules/orders/pos-handlers.types.ts` (new file):

```ts
export type HandlerResult<T = void> =
  | { ok: true; value?: T }
  | { ok: false; errors: Record<string, string[]> };

export type POSCompositionHandlers = {
  changePackageTier: (input: {
    orderPackageId: string;
    toPackageRefId: string;
  }) => Promise<HandlerResult>;
  upgradePackageItem: (input: {
    orderPackageId: string;
    packageItemId: string;
    toProductId: string;
    quantity: number;
  }) => Promise<HandlerResult>;
  changeSelectedPhotoCount: (input: {
    orderPackageId: string;
    selectedPhotoCount: number;
    extraDigitalCount: number;
    extraPrintCount: number;
  }) => Promise<HandlerResult>;
  shouldPromptInlineApproval: boolean;
};

export type POSAddOnHandlers = {
  addAddOn: (input: { productId: string; quantity: number }) => Promise<HandlerResult>;
  removeAddOn: (input: { addOnId: string }) => Promise<HandlerResult>;
  changeAddOnQuantity: (input: { addOnId: string; quantity: number }) => Promise<HandlerResult>;
};
```

These shapes are deliberately payload-typed (not `FormData`) so the adapters on each call site translate to/from their preferred submission style.

### 2. Component refactor

Each component gains a `handlers` prop and removes its direct `*-action` imports. Patterns:

- Replace `useActionState(boundAction, {})` with a hook that wraps the handler call and surfaces the same `state` / `pending` / `error` shape the JSX already consumes. A small helper `useHandlerAction<T>(handler, mapErrors?)` is acceptable; keep it co-located with the components for now.
- Form submissions become handler invocations. The `<form action={…}>` pattern can stay if the adapter on the call site builds the `formAction` from the handler, but a `<form onSubmit>` route is fine if it simplifies the diff.
- `ReductiveEditApprovalModal` continues to render; its trigger now consults `handlers.shouldPromptInlineApproval`.

### 3. Sales page rewiring (adapters)

In `app/orders/[orderId]/sales/page.tsx`, construct typed handler objects whose methods invoke the existing server actions:

```ts
const compositionHandlers: POSCompositionHandlers = {
  changePackageTier: (input) =>
    callServerAction(updateOrderPackageAction, orderId, input),
  upgradePackageItem: (input) =>
    callServerAction(upgradePackageItemAction, orderId, input),
  changeSelectedPhotoCount: (input) =>
    callServerAction(updateOrderSelectedPhotoCountAction, orderId, input),
  shouldPromptInlineApproval: true,
};
```

`callServerAction` is a small helper that builds the `FormData` the actions expect and normalizes their return into `HandlerResult`.

### 4. Verification

- Manual: open the unlocked sales page, exercise every composition action — package tier change, deliverable upgrade, selected photo count change (no-extras, digital, print, split modes), reductive edit triggering the approval modal, add-on add/remove. Confirm identical UX vs. pre-refactor.
- Automated: where existing tests cover these components, they should still pass without modification (component public API has changed — `handlers` is now required — but rendered output for equivalent inputs has not). Add a snapshot test asserting identical DOM for a fixed `POSWorkspace` fixture.

### 5. Implementation order

1. Define the handler contracts and `callServerAction` helper.
2. Refactor `POSAddOnMarketplace` first — smallest, simplest. Ship/QA.
3. Refactor `POSPhotoCountCard` next — moderate complexity, isolated state.
4. Refactor `POSPackageComposition` last — largest, includes the modal trigger logic.
5. After all three: full QA pass on the sales page before merging.

## Observability Checklist

### Dashboards / Metrics

- No new metrics. This phase produces no observable change in production behavior.

### Rollback Plan

- Code: revert the refactor. No data or schema implications.
- Risk surface: pure UI/component refactor; rollback is safe even mid-workspace-session.

### Customer-Visible Surface

- None expected. Any observable difference on the unlocked sales page is a regression and must be fixed before merging.

## Post-Implementation

- Add a memory entry recording the handler-prop pattern as the canonical way to share UI between commit-through and staged surfaces.
- Update `context/code-standards-summary.md` if a project-wide pattern emerges from this (e.g., "components that may be mounted in multiple persistence contexts take a handlers prop").

## Acceptance Criteria

- `POSPackageComposition`, `POSPhotoCountCard`, and `POSAddOnMarketplace` no longer import server actions directly.
- Each component requires a typed `handlers` prop.
- The unlocked sales page renders identically (visually and behaviorally) to pre-refactor. Manual QA passes the action list in §4.
- The reductive-edit approval modal continues to fire on reductive edits on the sales page.
- No new consumers of the refactored components exist yet (workspace is rewired in 83c).
- `npm run build` passes.
- `npm run lint` passes.
