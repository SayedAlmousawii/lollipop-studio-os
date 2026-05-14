import { InvoiceLineType, Prisma } from "@prisma/client";
import type { AdjustmentLineInput } from "@/modules/invoices/invoice.schema";
import type {
  AdditionEvent,
  EditDelta,
  ReductionEvent,
} from "@/modules/orders/order.delta";

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

export type BlockedEditReason = {
  reason: "PRICE_SNAPSHOT_EDIT_ATTEMPT";
  lineSnapshot: { name: string };
};

export type ClassifierResult = {
  netZero: boolean;
  adjustmentLines: AdjustmentLineInput[];
  creditNoteRequired: CreditNoteRequirement[];
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

export function classifyEditDelta(delta: EditDelta): ClassifierResult {
  const adjustmentLines: AdjustmentLineInput[] = [];
  const creditNoteRequired: CreditNoteRequirement[] = [];
  const blocked: BlockedEditReason[] = [];
  let sawNetZeroSwap = false;

  for (const addition of delta.additions) {
    adjustmentLines.push(toAdjustmentLine(addition));
  }

  for (const reduction of delta.reductions) {
    if (reduction.kind === "PRICE_SNAPSHOT_EDIT_ATTEMPT") {
      blocked.push({
        reason: "PRICE_SNAPSHOT_EDIT_ATTEMPT",
        lineSnapshot: { name: reduction.lineSnapshot.name },
      });
      continue;
    }

    creditNoteRequired.push(toCreditRequirement(reduction));
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
      blocked.length === 0,
    adjustmentLines,
    creditNoteRequired,
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
      };
    case "NEW_UPGRADE":
      return {
        lineType: InvoiceLineType.ADD_ON,
        description: addition.nameSnapshot,
        quantity: addition.quantity,
        unitPrice: addition.priceSnapshot.toNumber(),
      };
    case "ADDON_QUANTITY_INCREASE":
      return {
        lineType: InvoiceLineType.ADD_ON,
        description: addition.lineSnapshot.name,
        quantity: addition.deltaQuantity,
        unitPrice: addition.lineSnapshot.unitPrice.toNumber(),
      };
    case "NEW_EXTRA_PHOTO":
      return {
        lineType: InvoiceLineType.EXTRA_PHOTOS,
        description: addition.lineSnapshot.name,
        quantity: addition.quantity,
        unitPrice: addition.priceSnapshot.toNumber(),
      };
    case "PACKAGE_TIER_UPGRADE":
      return {
        lineType: InvoiceLineType.PACKAGE_BASE,
        description: "Package tier upgrade",
        quantity: 1,
        unitPrice: addition.newPriceSnapshot.minus(addition.oldPriceSnapshot).toNumber(),
      };
  }
}

function toCreditRequirement(reduction: Exclude<ReductionEvent, { kind: "PRICE_SNAPSHOT_EDIT_ATTEMPT" }>): CreditNoteRequirement {
  switch (reduction.kind) {
    case "REMOVED_ADDON":
      return {
        reason: "REMOVED_ADDON",
        amount: reduction.lineSnapshot.totalValue,
        lineSnapshot: { name: reduction.lineSnapshot.name },
      };
    case "REMOVED_UPGRADE":
      return {
        reason: "REMOVED_UPGRADE",
        amount: reduction.lineSnapshot.totalValue,
        lineSnapshot: { name: reduction.lineSnapshot.name },
      };
    case "ADDON_QUANTITY_DECREASE":
      return {
        reason: "ADDON_QUANTITY_DECREASE",
        amount: reduction.lineSnapshot.unitPrice.mul(reduction.deltaQuantity),
        lineSnapshot: { name: reduction.lineSnapshot.name },
      };
    case "REMOVED_EXTRA_PHOTO":
      return {
        reason: "REMOVED_EXTRA_PHOTO",
        amount: reduction.lineSnapshot.totalValue,
        lineSnapshot: { name: reduction.lineSnapshot.name },
      };
    case "PACKAGE_TIER_DOWNGRADE":
      return {
        reason: "PACKAGE_TIER_DOWNGRADE",
        amount: reduction.oldPriceSnapshot.minus(reduction.newPriceSnapshot),
        lineSnapshot: { name: "Package tier downgrade" },
      };
  }
}
