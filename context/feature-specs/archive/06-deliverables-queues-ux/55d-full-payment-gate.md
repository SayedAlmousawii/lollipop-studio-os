## Goal

Enforce the business rule: no order moves to editing unless the invoice is fully paid. Block editor assignment when there is an outstanding balance, and surface the amount owed clearly so staff knows what to collect first.

---

## Background

**Business rule:** An order cannot enter editing until its full invoice balance is settled. This applies whether the balance is from a base payment, a package upgrade, or add-ons.

**Current state:** `canAssignEditor` in `mapOrderEditingWorkflow` only checks `editingStatus !== COMPLETED`. It has no payment check. A separate `basePaymentVerified` warning exists in the form but does not block assignment.

**Target state:** `canAssignEditor = false` when `remainingAmount > 0`. The editing tab should show a clear, actionable message stating how much is owed and where to record payment.

---

## Rules

- No schema changes
- Business rule enforcement lives in the service, not the form
- The form may surface a warning based on service-provided data, but the disable flag comes from the service

---

## Service Changes

**Location:** `src/modules/orders/order.service.ts` — `mapOrderEditingWorkflow`

Read the function's current signature and what data is already available before editing.

1. Confirm that `invoiceSummary.remainingAmount` (a `Prisma.Decimal`) is accessible inside `mapOrderEditingWorkflow` — check what parameters the function receives. If `remainingAmount` is not currently passed in, trace where `mapOrderEditingWorkflow` is called and pass it through.

2. Update `canAssignEditor`:

```ts
canAssignEditor:
  editingStatus !== OrderEditingStatus.COMPLETED &&
  remainingAmount.lte(0),
```

3. Add a new field `outstandingBalanceLabel: string | null` — return the formatted balance when `remainingAmount > 0`, otherwise null:

```ts
outstandingBalanceLabel: remainingAmount.gt(0)
  ? formatMoney(remainingAmount)
  : null,
```

Add `outstandingBalanceLabel` to the `OrderEditingWorkflow` type in `order.types.ts`.

---

## Form Changes

**Location:** `src/components/orders/editing-workflow-form.tsx`

The form already shows a `basePaymentVerified` warning. Replace or extend it with a more specific outstanding balance message.

When `editing.outstandingBalanceLabel` is set, show:

```tsx
<p className="rounded-md bg-warning-soft px-4 py-3 text-sm text-warning">
  Outstanding balance of {editing.outstandingBalanceLabel} must be paid before editing can be assigned.
  Record payment on the invoice page.
</p>
```

Remove or demote the existing `basePaymentVerified` warning — the outstanding balance message supersedes it. Keep `basePaymentVerified` only if it still provides distinct information (e.g., base payment absent while overall balance is somehow 0 — unlikely but check before deleting).

The "Assign" button is already disabled when `!editing.canAssignEditor` — no button change is needed.

---

## Post-Implementation

**`context/progress-tracker.md`**
- Update Now section: Feature 55d complete; next is 55e
- Add to Feature History: "Feature 55d: Full payment gate for editing assignment — blocks assignment when invoice balance > 0, surfaces outstanding amount."

---

## Acceptance Criteria

1. The "Assign" button is disabled when the invoice has an outstanding balance
2. A clear warning message shows the exact outstanding amount when `outstandingBalanceLabel` is set
3. When the balance is fully paid, the button is enabled and the warning is gone
4. The gate applies regardless of whether the balance is from base, upgrade, or add-ons
5. TypeScript passes
6. `npm run build` passes
7. `npm run lint` passes
8. Update `context/progress-tracker.md`
