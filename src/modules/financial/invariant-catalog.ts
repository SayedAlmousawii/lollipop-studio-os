import {
  FINANCIAL_RUNTIME_INVARIANTS,
  type InvariantCheck,
  type InvariantContext,
  type InvariantViolation,
} from "@/modules/financial/invariants";
import {
  RECONCILIATION_INVARIANTS,
  type ReconciliationInvariantDefinition,
  type ReconciliationQueryRow,
  type ReconciliationRunContext,
  type ReconciliationTx,
} from "@/modules/financial/reconciliation-invariants";

export type CatalogedInvariantScope = "global" | "order" | "invoice";

type BaseCatalogedInvariant = {
  id: string;
  name: string;
  phase: string;
  scope: CatalogedInvariantScope;
  description: string;
};

export type RuntimeCatalogedInvariant = BaseCatalogedInvariant & {
  kind: "runtime";
  run: (
    context: InvariantContext,
    scopeArgs?: { financialCaseId?: string }
  ) => Promise<InvariantViolation[]>;
};

export type ReconciliationCatalogedInvariant = BaseCatalogedInvariant & {
  kind: "reconciliation";
  reconciliation: {
    severity: ReconciliationInvariantDefinition["severity"];
    affectedEntityType: ReconciliationInvariantDefinition["affectedEntityType"];
    expected: ReconciliationInvariantDefinition["expected"];
    queryContext: ReconciliationInvariantDefinition["queryContext"];
  };
  run: (
    tx: ReconciliationTx,
    context: ReconciliationRunContext
  ) => Promise<ReconciliationQueryRow[]>;
};

export type CatalogedInvariant =
  | RuntimeCatalogedInvariant
  | ReconciliationCatalogedInvariant;

type RuntimeInvariantMetadata = {
  id: string;
  phase: string;
  scope?: CatalogedInvariantScope;
  description: string;
};

const RUNTIME_INVARIANT_METADATA: Record<string, RuntimeInvariantMetadata> = {
  "payment-has-exactly-one-allocation": {
    id: "runtime-payment-has-exactly-one-allocation",
    phase: "Phase C",
    description: "Every payment has exactly one allocation.",
  },
  "allocation-sum-equals-payment-amount": {
    id: "runtime-allocation-sum-equals-payment-amount",
    phase: "Phase C",
    description: "Payment allocation totals equal the payment amount.",
  },
  "financial-case-net-balance-non-negative": {
    id: "runtime-financial-case-net-balance-non-negative",
    phase: "Phase C",
    description: "Financial case net balance cannot go below zero.",
  },
  "document-application-not-over-source": {
    id: "runtime-document-application-not-over-source",
    phase: "Phase C",
    description: "Document applications cannot exceed their source capacity.",
  },
  "deposit-final-pair-has-document-application": {
    id: "runtime-deposit-final-pair-has-document-application",
    phase: "Phase C",
    description: "Each paid deposit and final invoice pair has one document application.",
  },
  "no-payment-without-allocation": {
    id: "runtime-no-payment-without-allocation",
    phase: "Phase C",
    description: "No payment may exist without an allocation.",
  },
  "adjustment-parent-is-final": {
    id: "runtime-adjustment-parent-is-final",
    phase: "Phase D",
    scope: "invoice",
    description: "Adjustment invoices must point to a final invoice parent.",
  },
  "adjustment-same-financial-case-as-parent": {
    id: "runtime-adjustment-same-financial-case-as-parent",
    phase: "Phase D",
    scope: "invoice",
    description: "Adjustment invoices must stay in the same financial case as their parent.",
  },
  "adjustment-never-chains": {
    id: "runtime-adjustment-never-chains",
    phase: "Phase D",
    scope: "invoice",
    description: "Adjustment invoices cannot chain to adjustment parents.",
  },
  "locked-invoice-frozen-fields-match-snapshot": {
    id: "INV-LOCK-SNAPSHOT",
    phase: "Sprint 3 (80b)",
    scope: "invoice",
    description: "Locked invoice frozen fields must match the latest lock snapshot.",
  },
  "adjustment-has-no-document-application": {
    id: "runtime-adjustment-has-no-document-application",
    phase: "Phase D",
    description: "Adjustment invoices cannot receive document applications except line-targeted reversals.",
  },
  "no-adjustment-without-classifier-source": {
    id: "runtime-no-adjustment-without-classifier-source",
    phase: "Sprint 1 (75b)",
    scope: "invoice",
    description: "Automatic adjustment invoices must have a classifier source activity.",
  },
  "out-payment-targets-refund-invoice": {
    id: "runtime-out-payment-targets-refund-invoice",
    phase: "Phase F",
    scope: "invoice",
    description: "Outbound payments must target refund invoices.",
  },
  "refund-amount-not-over-source": {
    id: "runtime-refund-amount-not-over-source",
    phase: "Phase F",
    scope: "invoice",
    description: "Refund totals cannot exceed the inbound amount on their source invoice.",
  },
  "refund-trace-points-to-inbound-payment": {
    id: "runtime-refund-trace-points-to-inbound-payment",
    phase: "Phase F",
    description: "Refund traces must point back to inbound payments.",
  },
  "refund-source-is-final-or-adjustment": {
    id: "runtime-refund-source-is-final-or-adjustment",
    phase: "Phase F",
    scope: "invoice",
    description: "Refund invoice parents must be final or adjustment invoices.",
  },
  "credit-note-targets-final": {
    id: "runtime-credit-note-targets-final",
    phase: "Phase F",
    scope: "invoice",
    description: "Credit notes must target final invoices or line-targeted adjustment reversals.",
  },
  "credit-note-has-document-application": {
    id: "runtime-credit-note-has-document-application",
    phase: "Phase F",
    scope: "invoice",
    description: "Credit notes must have the expected document application.",
  },
  "paid-adjustment-line-removal-must-have-reversal": {
    id: "runtime-paid-adjustment-line-removal-must-have-reversal",
    phase: "Sprint 2 (79a)",
    scope: "order",
    description: "Paid adjustment lines removed from an order must have a credit-note reversal.",
  },
  "credit-note-amount-not-over-final": {
    id: "runtime-credit-note-amount-not-over-final",
    phase: "Phase F",
    scope: "invoice",
    description: "Credit note totals cannot exceed the final invoice total.",
  },
  "credit-note-is-locked-on-issuance": {
    id: "runtime-credit-note-is-locked-on-issuance",
    phase: "Phase F",
    scope: "invoice",
    description: "Credit notes are closed and locked when issued.",
  },
  "final-invoice-fully-paid-must-be-locked": {
    id: "runtime-final-invoice-fully-paid-must-be-locked",
    phase: "Sprint 1 (78a)",
    scope: "invoice",
    description: "Fully paid final invoices must be closed and locked.",
  },
  "classifier-reductions-have-matching-credit-note": {
    id: "runtime-classifier-reductions-have-matching-credit-note",
    phase: "Sprint 1 (75c)",
    scope: "order",
    description: "Classifier reductions must have matching credit notes and source activity.",
  },
};

const runtimeCatalog = FINANCIAL_RUNTIME_INVARIANTS.map((invariant) =>
  catalogRuntimeInvariant(invariant)
);

const reconciliationCatalog = RECONCILIATION_INVARIANTS.map((invariant) =>
  catalogReconciliationInvariant(invariant)
);

export const INVARIANT_CATALOG: readonly CatalogedInvariant[] = [
  ...runtimeCatalog,
  ...reconciliationCatalog,
];

function catalogRuntimeInvariant(invariant: InvariantCheck): RuntimeCatalogedInvariant {
  const metadata = RUNTIME_INVARIANT_METADATA[invariant.name];

  return {
    kind: "runtime",
    id: metadata?.id ?? `runtime-${invariant.name}`,
    name: invariant.name,
    phase: metadata?.phase ?? "Runtime",
    scope: metadata?.scope ?? normalizeRuntimeScope(invariant.scope),
    description: metadata?.description ?? invariant.name,
    run: (context, scopeArgs) => invariant.run(context, scopeArgs),
  };
}

function catalogReconciliationInvariant(
  invariant: ReconciliationInvariantDefinition
): ReconciliationCatalogedInvariant {
  return {
    kind: "reconciliation",
    id: invariant.invariantId,
    name: invariant.name,
    phase: "Phase G",
    scope: normalizeReconciliationScope(invariant.affectedEntityType),
    description: invariant.description,
    reconciliation: {
      severity: invariant.severity,
      affectedEntityType: invariant.affectedEntityType,
      expected: invariant.expected,
      queryContext: invariant.queryContext,
    },
    run: (tx, context) => invariant.run(tx, context),
  };
}

function normalizeRuntimeScope(scope: InvariantCheck["scope"]): CatalogedInvariantScope {
  if (scope === "order") return "order";
  return "global";
}

function normalizeReconciliationScope(entityType: string): CatalogedInvariantScope {
  if (entityType === "Order") return "order";
  if (entityType === "Invoice") return "invoice";
  return "global";
}
