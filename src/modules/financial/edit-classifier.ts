import { InvoiceLineType, OrderEntityKind, Prisma } from "@prisma/client";
import type { AdjustmentLineInput } from "@/modules/invoices/invoice.schema";
import type {
  AdditionEvent,
  EditDelta,
  ReductionEvent,
} from "@/modules/orders/order.delta";

const PACKAGE_TIER_UPGRADE_CAUSE_ID = "package-tier-upgrade";

export type CreditNoteRequirement = {
  reason:
    | "REMOVED_ADDON"
    | "REMOVED_UPGRADE"
    | "ADDON_QUANTITY_DECREASE"
    | "REMOVED_EXTRA_PHOTO"
    | "PACKAGE_TIER_DOWNGRADE"
    | "UPGRADE_REPLACEMENT_REDUCTION_SIDE";
  amount: Prisma.Decimal;
  lineSnapshot: { name: string };
};

export type OpenAdjustmentLine = {
  invoiceLineId: string;
  invoiceId: string;
  causeOrderEntityKind: OrderEntityKind;
  causeOrderEntityId: string;
  lineAmount: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
  isPaid: boolean;
  lineSnapshot: { name: string };
};

export type AdjustmentReversal = {
  causingInvoiceLineId: string;
  causingInvoiceId: string;
  causeOrderEntityKind: OrderEntityKind;
  causeOrderEntityId: string;
  amount: Prisma.Decimal;
  requiresRefund: boolean;
  lineSnapshot: { name: string };
};

export type BlockedEditReason = {
  reason: "PRICE_SNAPSHOT_EDIT_ATTEMPT";
  lineSnapshot: { name: string };
};

export type ClassifierResult = {
  netZero: boolean;
  adjustmentLines: AdjustmentLineInput[];
  creditNoteRequired: CreditNoteRequirement[];
  adjustmentReversals: AdjustmentReversal[];
  blocked: BlockedEditReason[];
};

export class BlockedEditError extends Error {
  constructor(public readonly reasons: BlockedEditReason[]) {
    super(
      `Order edit blocked for locked invoice: ${reasons
        .map((reason) => reason.reason)
        .join(", ")}`
    );
    this.name = "BlockedEditError";
  }
}

export class ReductionRequiresCreditNoteError extends Error {
  constructor(public readonly requirements: CreditNoteRequirement[]) {
    super(
      "This locked-invoice edit requires a credit note. Phase 3 credit notes are not available yet, so the order edit was not saved."
    );
    this.name = "ReductionRequiresCreditNoteError";
  }
}

export class PendingCreditNoteApprovalError extends Error {
  constructor(
    public readonly reductions: CreditNoteRequirement[],
    public readonly adjustmentLines: AdjustmentLineInput[]
  ) {
    super("Manager confirmation is required before issuing a credit note.");
    this.name = "PendingCreditNoteApprovalError";
  }
}

export function classifyEditDelta(
  delta: EditDelta,
  openAdjustmentLines: ReadonlyMap<string, readonly OpenAdjustmentLine[]> = new Map()
): ClassifierResult {
  const adjustmentLines: AdjustmentLineInput[] = [];
  const creditNoteRequired: CreditNoteRequirement[] = [];
  const adjustmentReversals: AdjustmentReversal[] = [];
  const blocked: BlockedEditReason[] = [];
  let sawNetZeroSwap = false;

  for (const addition of delta.additions) {
    const adjustmentLine = toAdjustmentLine(addition);
    const residualLine = reduceAdditionByOpenAdjustmentCoverage(
      adjustmentLine,
      openAdjustmentLines
    );
    if (residualLine) {
      adjustmentLines.push(residualLine);
    }
  }

  for (const reduction of delta.reductions) {
    if (reduction.kind === "PRICE_SNAPSHOT_EDIT_ATTEMPT") {
      blocked.push({
        reason: "PRICE_SNAPSHOT_EDIT_ATTEMPT",
        lineSnapshot: { name: reduction.lineSnapshot.name },
      });
      continue;
    }

    routeReduction({
      reduction,
      openAdjustmentLines,
      adjustmentReversals,
      creditNoteRequired,
    });
  }

  for (const swap of delta.swaps) {
    if (swap.removedPriceSnapshot.equals(swap.addedPriceSnapshot)) {
      sawNetZeroSwap = true;
      continue;
    }

    adjustmentLines.push({
      lineType: InvoiceLineType.ADD_ON,
      description: swap.addedLineSnapshot.name,
      quantity: 1,
      unitPrice: swap.addedPriceSnapshot.toNumber(),
      ...(swap.addedOrderPackageItemUpgradeId
        ? {
            causeOrderEntityKind: OrderEntityKind.UPGRADE,
            causeOrderEntityId: swap.addedOrderPackageItemUpgradeId,
          }
        : {}),
    });
    creditNoteRequired.push({
      reason: "UPGRADE_REPLACEMENT_REDUCTION_SIDE",
      amount: swap.removedPriceSnapshot,
      lineSnapshot: { name: swap.removedLineSnapshot.name },
    });
  }

  return {
    netZero:
      sawNetZeroSwap &&
      adjustmentLines.length === 0 &&
      creditNoteRequired.length === 0 &&
      adjustmentReversals.length === 0 &&
      blocked.length === 0,
    adjustmentLines,
    creditNoteRequired,
    adjustmentReversals,
    blocked,
  };
}

function toAdjustmentLine(addition: AdditionEvent): AdjustmentLineInput {
  switch (addition.kind) {
    case "NEW_ADDON":
      return {
        lineType: InvoiceLineType.ADD_ON,
        description: addition.nameSnapshot,
        quantity: addition.quantity,
        unitPrice: addition.priceSnapshot.toNumber(),
        causeOrderEntityKind: OrderEntityKind.ADDON,
        causeOrderEntityId: addition.orderAddOnId,
      };
    case "NEW_UPGRADE":
      return {
        lineType: InvoiceLineType.ADD_ON,
        description: addition.nameSnapshot,
        quantity: addition.quantity,
        unitPrice: addition.priceSnapshot.toNumber(),
        causeOrderEntityKind: OrderEntityKind.UPGRADE,
        causeOrderEntityId: addition.orderPackageItemUpgradeId,
      };
    case "ADDON_QUANTITY_INCREASE":
      return {
        lineType: InvoiceLineType.ADD_ON,
        description: addition.lineSnapshot.name,
        quantity: addition.deltaQuantity,
        unitPrice: addition.lineSnapshot.unitPrice.toNumber(),
        causeOrderEntityKind: OrderEntityKind.ADDON,
        causeOrderEntityId: addition.orderAddOnId,
      };
    case "NEW_EXTRA_PHOTO":
      return {
        lineType: InvoiceLineType.EXTRA_PHOTOS,
        description: addition.lineSnapshot.name,
        quantity: addition.quantity,
        unitPrice: addition.priceSnapshot.toNumber(),
        causeOrderEntityKind: OrderEntityKind.EXTRA_PHOTO,
        // TODO(review 79a): replace the display-name key with a stable
        // extra-photo cause id once the order extra-photo delta exposes one.
        causeOrderEntityId: addition.lineSnapshot.name,
      };
    case "PACKAGE_TIER_UPGRADE":
      return {
        lineType: InvoiceLineType.PACKAGE_BASE,
        description: "Package tier upgrade",
        quantity: 1,
        unitPrice: addition.newPriceSnapshot.minus(addition.oldPriceSnapshot).toNumber(),
        causeOrderEntityKind: OrderEntityKind.PACKAGE_TIER_UPGRADE,
        causeOrderEntityId: PACKAGE_TIER_UPGRADE_CAUSE_ID,
      };
  }
}

function reduceAdditionByOpenAdjustmentCoverage(
  line: AdjustmentLineInput,
  openAdjustmentLines: ReadonlyMap<string, readonly OpenAdjustmentLine[]>
): AdjustmentLineInput | null {
  if (!line.causeOrderEntityKind || !line.causeOrderEntityId) return line;

  const existingLines = openAdjustmentLines.get(
    adjustmentCauseKey(line.causeOrderEntityKind, line.causeOrderEntityId)
  );
  if (!existingLines || existingLines.length === 0) return line;

  const currentAmount = new Prisma.Decimal(line.unitPrice).mul(line.quantity);
  const alreadyAdjustedAmount = existingLines.reduce(
    (sum, existingLine) => sum.plus(existingLine.lineAmount),
    new Prisma.Decimal(0)
  );
  const residualAmount = currentAmount.minus(alreadyAdjustedAmount);
  if (residualAmount.lessThanOrEqualTo(0)) return null;

  const unitPrice = new Prisma.Decimal(line.unitPrice);
  const residualQuantity = residualAmount.div(unitPrice);
  if (residualQuantity.isInteger() && residualQuantity.greaterThan(0)) {
    return {
      ...line,
      quantity: residualQuantity.toNumber(),
    };
  }

  return {
    ...line,
    quantity: 1,
    unitPrice: residualAmount.toNumber(),
  };
}

function routeReduction({
  reduction,
  openAdjustmentLines,
  adjustmentReversals,
  creditNoteRequired,
}: {
  reduction: Exclude<ReductionEvent, { kind: "PRICE_SNAPSHOT_EDIT_ATTEMPT" }>;
  openAdjustmentLines: ReadonlyMap<string, readonly OpenAdjustmentLine[]>;
  adjustmentReversals: AdjustmentReversal[];
  creditNoteRequired: CreditNoteRequirement[];
}) {
  const requirement = toCreditRequirement(reduction);
  const cause = "adjustmentCause" in reduction ? reduction.adjustmentCause : undefined;
  if (!cause) {
    creditNoteRequired.push(requirement);
    return;
  }

  const adjustmentLines = openAdjustmentLines.get(
    adjustmentCauseKey(cause.causeOrderEntityKind, cause.causeOrderEntityId)
  );
  if (!adjustmentLines || adjustmentLines.length === 0) {
    creditNoteRequired.push(requirement);
    return;
  }

  let remainingReduction = requirement.amount;
  for (const adjustmentLine of adjustmentLines) {
    if (remainingReduction.lessThanOrEqualTo(0)) break;
    if (adjustmentLine.remainingAmount.lessThanOrEqualTo(0)) continue;

    const reversalAmount = remainingReduction.lessThan(adjustmentLine.remainingAmount)
      ? remainingReduction
      : adjustmentLine.remainingAmount;
    if (reversalAmount.lessThanOrEqualTo(0)) continue;

    adjustmentReversals.push({
      causingInvoiceLineId: adjustmentLine.invoiceLineId,
      causingInvoiceId: adjustmentLine.invoiceId,
      causeOrderEntityKind: adjustmentLine.causeOrderEntityKind,
      causeOrderEntityId: adjustmentLine.causeOrderEntityId,
      amount: reversalAmount,
      requiresRefund: adjustmentLine.isPaid,
      lineSnapshot: { name: requirement.lineSnapshot.name },
    });
    remainingReduction = remainingReduction.minus(reversalAmount);
  }

  if (remainingReduction.greaterThan(0)) {
    creditNoteRequired.push({
      ...requirement,
      amount: remainingReduction,
    });
  }
}

function toCreditRequirement(reduction: Exclude<ReductionEvent, { kind: "PRICE_SNAPSHOT_EDIT_ATTEMPT" }>): CreditNoteRequirement {
  switch (reduction.kind) {
    case "REMOVED_ADDON":
      return {
        reason: "REMOVED_ADDON",
        amount: reduction.amountOverride ?? reduction.lineSnapshot.totalValue,
        lineSnapshot: { name: reduction.lineSnapshot.name },
      };
    case "REMOVED_UPGRADE":
      return {
        reason: "REMOVED_UPGRADE",
        amount: reduction.amountOverride ?? reduction.lineSnapshot.totalValue,
        lineSnapshot: { name: reduction.lineSnapshot.name },
      };
    case "ADDON_QUANTITY_DECREASE":
      return {
        reason: "ADDON_QUANTITY_DECREASE",
        amount:
          reduction.amountOverride ??
          reduction.lineSnapshot.unitPrice.mul(reduction.deltaQuantity),
        lineSnapshot: { name: reduction.lineSnapshot.name },
      };
    case "REMOVED_EXTRA_PHOTO":
      return {
        reason: "REMOVED_EXTRA_PHOTO",
        amount: reduction.amountOverride ?? reduction.lineSnapshot.totalValue,
        lineSnapshot: { name: reduction.lineSnapshot.name },
      };
    case "PACKAGE_TIER_DOWNGRADE":
      return {
        reason: "PACKAGE_TIER_DOWNGRADE",
        amount:
          reduction.amountOverride ??
          reduction.oldPriceSnapshot.minus(reduction.newPriceSnapshot),
        lineSnapshot: { name: "Package tier downgrade" },
      };
  }
}

export function adjustmentCauseKey(
  kind: OrderEntityKind,
  id: string
): string {
  return `${kind}:${id}`;
}
