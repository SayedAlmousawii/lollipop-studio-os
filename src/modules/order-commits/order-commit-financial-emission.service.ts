import { InvoiceLineType, OrderEntityKind } from "@prisma/client";
import {
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
} from "./order-commit.constants";
import {
  ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND,
} from "./order-commit-preview.constants";
import type {
  OrderCommitPreviewBaselineSource,
  OrderCommitPreviewLineDiff,
  OrderCommitPreviewLineSummary,
  OrderCommitSnapshotDiff,
} from "./order-commit-preview.types";

export const ORDER_COMMIT_CREDIT_NOTE_REASON = {
  REMOVED_ADDON: "REMOVED_ADDON",
  ADDON_QUANTITY_DECREASE: "ADDON_QUANTITY_DECREASE",
  REMOVED_PACKAGE_ITEM_UPGRADE: "REMOVED_PACKAGE_ITEM_UPGRADE",
  PACKAGE_ITEM_UPGRADE_QUANTITY_DECREASE:
    "PACKAGE_ITEM_UPGRADE_QUANTITY_DECREASE",
  REMOVED_EXTRA_PHOTO: "REMOVED_EXTRA_PHOTO",
  EXTRA_PHOTO_QUANTITY_DECREASE: "EXTRA_PHOTO_QUANTITY_DECREASE",
  PACKAGE_TIER_DOWNGRADE: "PACKAGE_TIER_DOWNGRADE",
  REMOVED_SESSION_CONFIGURATION: "REMOVED_SESSION_CONFIGURATION",
  REMOVED_LINKED_PRODUCT_ADD_ON: "REMOVED_LINKED_PRODUCT_ADD_ON",
} as const;

export type OrderCommitCreditNoteReason =
  (typeof ORDER_COMMIT_CREDIT_NOTE_REASON)[keyof typeof ORDER_COMMIT_CREDIT_NOTE_REASON];

export type OrderCommitFinancialEmissionErrorCode =
  | "ORDER_COMMIT_FINANCIAL_EMISSION_INVALID_PACKAGE_DIFF"
  | "ORDER_COMMIT_FINANCIAL_EMISSION_PRICE_CHANGE_FORBIDDEN"
  | "ORDER_COMMIT_FINANCIAL_EMISSION_UNRESOLVED_DRAFT_ID"
  | "ORDER_COMMIT_FINANCIAL_EMISSION_INVALID_QUANTITY"
  | "ORDER_COMMIT_FINANCIAL_EMISSION_INVALID_UNIT_PRICE"
  | "ORDER_COMMIT_FINANCIAL_EMISSION_BASELINE_LINE_MISSING"
  | "ORDER_COMMIT_FINANCIAL_EMISSION_PENDING_LINE_MISSING"
  | "ORDER_COMMIT_LINKED_PRODUCT_PAIR_BROKEN"
  | "ORDER_COMMIT_FINANCIAL_EMISSION_TOTAL_MISMATCH";

export class OrderCommitFinancialEmissionError extends Error {
  constructor(
    public readonly code: OrderCommitFinancialEmissionErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OrderCommitFinancialEmissionError";
  }
}

export type OrderCommitAdjustmentLineInput = {
  lineType: InvoiceLineType;
  description: string;
  quantity: number;
  unitPrice: number;
  causeOrderEntityKind?: OrderEntityKind;
  causeOrderEntityId?: string;
};

export type OrderCommitCreditNoteLineInput = {
  description: string;
  quantity: number;
  unitPrice: number;
  lineType?: InvoiceLineType;
  causeOrderEntityKind?: OrderEntityKind;
  causeOrderEntityId?: string;
  targetInvoiceId?: string;
  targetInvoiceLineId?: string;
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
  requiresRefund: boolean;
};

export type OrderCommitFinancialEmission = {
  adjustmentLines: OrderCommitAdjustmentLineInput[];
  creditNoteFinalLines: Array<{
    line: OrderCommitCreditNoteLineInput;
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

export type MapOrderCommitDiffToFinancialLinesInput = {
  diff: OrderCommitSnapshotDiff;
  baselineSource: OrderCommitPreviewBaselineSource;
  draftToOrderEntityMap: ReadonlyMap<string, string>;
  openAdjustmentLinesByCause: ReadonlyMap<
    string,
    readonly OrderCommitOpenAdjustmentLine[]
  >;
};

type CreditNoteCandidate = {
  kind: "credit";
  line: OrderCommitCreditNoteLineInput;
  reason: OrderCommitCreditNoteReason;
  causeOrderEntityKind: OrderEntityKind;
  causeOrderEntityId: string;
};

const ONE_FILS = 0.001;

export function mapOrderCommitDiffToFinancialLines(
  input: MapOrderCommitDiffToFinancialLinesInput
): OrderCommitFinancialEmission {
  assertLinkedProductPairs(input.diff.lineDiffs);

  const workingOpenLines = cloneOpenAdjustmentLines(
    input.openAdjustmentLinesByCause
  );
  const adjustmentLines: OrderCommitAdjustmentLineInput[] = [];
  const creditNoteFinalLines: OrderCommitFinancialEmission["creditNoteFinalLines"] =
    [];
  const adjustmentReversals: OrderCommitAdjustmentReversal[] = [];
  let negativeTotal = 0;

  for (const lineDiff of input.diff.lineDiffs) {
    const mapped = mapLineDiff(lineDiff, input.draftToOrderEntityMap);
    if (!mapped) continue;

    if (mapped.kind === "adjustment") {
      adjustmentLines.push(mapped.line);
      continue;
    }

    negativeTotal = round3(
      negativeTotal + mapped.line.quantity * mapped.line.unitPrice
    );
    routeCreditNoteCandidate({
      candidate: mapped,
      workingOpenLines,
      creditNoteFinalLines,
      adjustmentReversals,
    });
  }

  const positiveTotal = round3(totalLines(adjustmentLines));
  const reversalTotal = round3(
    adjustmentReversals.reduce((sum, reversal) => sum + reversal.amount, 0)
  );
  const creditNoteFinalTotal = round3(
    creditNoteFinalLines.reduce(
      (sum, entry) => sum + entry.line.quantity * entry.line.unitPrice,
      0
    )
  );
  const totals = {
    positiveTotal,
    negativeTotal: round3(negativeTotal),
    netDelta: round3(positiveTotal - negativeTotal),
    reversalTotal,
    creditNoteFinalTotal,
  };

  assertTotalsMatch(totals, input.diff.netDelta);

  return {
    adjustmentLines,
    creditNoteFinalLines,
    adjustmentReversals,
    totals,
  };
}

function mapLineDiff(
  lineDiff: OrderCommitPreviewLineDiff,
  draftToOrderEntityMap: ReadonlyMap<string, string>
): { kind: "adjustment"; line: OrderCommitAdjustmentLineInput } | CreditNoteCandidate | null {
  switch (lineDiff.changeKind) {
    case ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.UNCHANGED:
    case ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.METADATA_CHANGED:
      return null;
    case ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.PRICE_CHANGED:
      throwEmissionError(
        "ORDER_COMMIT_FINANCIAL_EMISSION_PRICE_CHANGE_FORBIDDEN",
        `OrderCommit financial emission rejected price change for ${lineDiff.stableKey}.`
      );
  }

  switch (lineDiff.lineKind) {
    case ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE:
      return mapPackageDiff(lineDiff);
    case ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON:
      return mapAddOnLikeDiff({
        lineDiff,
        draftToOrderEntityMap,
        entityKind: OrderEntityKind.ADDON,
        adjustmentLineType: InvoiceLineType.ADD_ON,
        removedReason: ORDER_COMMIT_CREDIT_NOTE_REASON.REMOVED_ADDON,
        decreasedReason:
          ORDER_COMMIT_CREDIT_NOTE_REASON.ADDON_QUANTITY_DECREASE,
      });
    case ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE:
      return mapAddOnLikeDiff({
        lineDiff,
        draftToOrderEntityMap,
        entityKind: OrderEntityKind.UPGRADE,
        adjustmentLineType: InvoiceLineType.ADD_ON,
        removedReason:
          ORDER_COMMIT_CREDIT_NOTE_REASON.REMOVED_PACKAGE_ITEM_UPGRADE,
        decreasedReason:
          ORDER_COMMIT_CREDIT_NOTE_REASON
            .PACKAGE_ITEM_UPGRADE_QUANTITY_DECREASE,
      });
    case ORDER_COMMIT_SNAPSHOT_LINE_KIND.SELECTED_PHOTO_EXTRA:
      return mapPhotoDiff(lineDiff);
    case ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION:
      return mapSessionConfigurationDiff(lineDiff, draftToOrderEntityMap);
    case ORDER_COMMIT_SNAPSHOT_LINE_KIND
      .LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON:
      return mapLinkedProductDiff(lineDiff, draftToOrderEntityMap);
  }
  return null;
}

function mapPackageDiff(
  lineDiff: OrderCommitPreviewLineDiff
): { kind: "adjustment"; line: OrderCommitAdjustmentLineInput } | CreditNoteCandidate | null {
  if (
    lineDiff.changeKind !==
    ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.PACKAGE_CHANGED
  ) {
    throwEmissionError(
      "ORDER_COMMIT_FINANCIAL_EMISSION_INVALID_PACKAGE_DIFF",
      `OrderCommit financial emission rejected package ${lineDiff.changeKind} for ${lineDiff.stableKey}.`
    );
  }

  const baselineLine = requiredBaselineLine(lineDiff);
  const pendingLine = requiredPendingLine(lineDiff);
  if (lineDiff.moneyDelta === 0) return null;

  if (lineDiff.moneyDelta > 0) {
    const line = adjustmentLine({
      lineType: InvoiceLineType.PACKAGE_UPGRADE,
      description: `Package upgrade: ${baselineLine.label} -> ${pendingLine.label}`,
      quantity: 1,
      unitPrice: lineDiff.moneyDelta,
      causeOrderEntityKind: OrderEntityKind.PACKAGE_TIER_UPGRADE,
      causeOrderEntityId: pendingLine.orderEntityId,
    });
    return { kind: "adjustment", line };
  }

  return creditNoteCandidate({
    line: creditNoteLine({
      lineType: InvoiceLineType.MANUAL_DISCOUNT,
      description: `Package downgrade: ${baselineLine.label} -> ${pendingLine.label}`,
      quantity: 1,
      unitPrice: Math.abs(lineDiff.moneyDelta),
      causeOrderEntityKind: OrderEntityKind.PACKAGE_TIER_UPGRADE,
      causeOrderEntityId: pendingLine.orderEntityId,
    }),
    reason: ORDER_COMMIT_CREDIT_NOTE_REASON.PACKAGE_TIER_DOWNGRADE,
    causeOrderEntityKind: OrderEntityKind.PACKAGE_TIER_UPGRADE,
    causeOrderEntityId: pendingLine.orderEntityId,
  });
}

function mapAddOnLikeDiff(input: {
  lineDiff: OrderCommitPreviewLineDiff;
  draftToOrderEntityMap: ReadonlyMap<string, string>;
  entityKind: OrderEntityKind;
  adjustmentLineType: InvoiceLineType;
  removedReason: OrderCommitCreditNoteReason;
  decreasedReason: OrderCommitCreditNoteReason;
}): { kind: "adjustment"; line: OrderCommitAdjustmentLineInput } | CreditNoteCandidate | null {
  switch (input.lineDiff.changeKind) {
    case ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.ADDED: {
      const pendingLine = requiredPendingLine(input.lineDiff);
      return {
        kind: "adjustment",
        line: adjustmentLine({
          lineType: input.adjustmentLineType,
          description: pendingLine.label,
          quantity: pendingLine.quantity,
          unitPrice: pendingLine.unitPrice,
          causeOrderEntityKind: input.entityKind,
          causeOrderEntityId: resolveOrderEntityId(
            pendingLine.orderEntityId,
            input.draftToOrderEntityMap
          ),
        }),
      };
    }
    case ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.REMOVED: {
      const baselineLine = requiredBaselineLine(input.lineDiff);
      return creditNoteCandidate({
        line: creditNoteLine({
          lineType: InvoiceLineType.MANUAL_DISCOUNT,
          description: `Removed: ${baselineLine.label}`,
          quantity: baselineLine.quantity,
          unitPrice: baselineLine.unitPrice,
          causeOrderEntityKind: input.entityKind,
          causeOrderEntityId: baselineLine.orderEntityId,
        }),
        reason: input.removedReason,
        causeOrderEntityKind: input.entityKind,
        causeOrderEntityId: baselineLine.orderEntityId,
      });
    }
    case ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.QUANTITY_CHANGED: {
      const baselineLine = requiredBaselineLine(input.lineDiff);
      const pendingLine = requiredPendingLine(input.lineDiff);
      if (input.lineDiff.quantityDelta > 0) {
        return {
          kind: "adjustment",
          line: adjustmentLine({
            lineType: input.adjustmentLineType,
            description: pendingLine.label,
            quantity: input.lineDiff.quantityDelta,
            unitPrice: pendingLine.unitPrice,
            causeOrderEntityKind: input.entityKind,
            causeOrderEntityId: pendingLine.orderEntityId,
          }),
        };
      }
      if (input.lineDiff.quantityDelta < 0) {
        return creditNoteCandidate({
          line: creditNoteLine({
            lineType: InvoiceLineType.MANUAL_DISCOUNT,
            description: `Decreased: ${baselineLine.label}`,
            quantity: Math.abs(input.lineDiff.quantityDelta),
            unitPrice: baselineLine.unitPrice,
            causeOrderEntityKind: input.entityKind,
            causeOrderEntityId: baselineLine.orderEntityId,
          }),
          reason: input.decreasedReason,
          causeOrderEntityKind: input.entityKind,
          causeOrderEntityId: baselineLine.orderEntityId,
        });
      }
      return null;
    }
    default:
      return null;
  }
}

function mapPhotoDiff(
  lineDiff: OrderCommitPreviewLineDiff
): { kind: "adjustment"; line: OrderCommitAdjustmentLineInput } | CreditNoteCandidate | null {
  switch (lineDiff.changeKind) {
    case ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.ADDED: {
      const pendingLine = requiredPendingLine(lineDiff);
      return {
        kind: "adjustment",
        line: adjustmentLine({
          lineType: InvoiceLineType.EXTRA_PHOTOS,
          description: pendingLine.label,
          quantity: pendingLine.quantity,
          unitPrice: pendingLine.unitPrice,
          causeOrderEntityKind: OrderEntityKind.EXTRA_PHOTO,
          causeOrderEntityId: extraPhotoCauseId(pendingLine),
        }),
      };
    }
    case ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.REMOVED: {
      const baselineLine = requiredBaselineLine(lineDiff);
      return creditNoteCandidate({
        line: creditNoteLine({
          lineType: InvoiceLineType.MANUAL_DISCOUNT,
          description: `Removed: ${baselineLine.label}`,
          quantity: baselineLine.quantity,
          unitPrice: baselineLine.unitPrice,
          causeOrderEntityKind: OrderEntityKind.EXTRA_PHOTO,
          causeOrderEntityId: extraPhotoCauseId(baselineLine),
        }),
        reason: ORDER_COMMIT_CREDIT_NOTE_REASON.REMOVED_EXTRA_PHOTO,
        causeOrderEntityKind: OrderEntityKind.EXTRA_PHOTO,
        causeOrderEntityId: extraPhotoCauseId(baselineLine),
      });
    }
    case ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.QUANTITY_CHANGED: {
      const baselineLine = requiredBaselineLine(lineDiff);
      const pendingLine = requiredPendingLine(lineDiff);
      if (lineDiff.quantityDelta > 0) {
        return {
          kind: "adjustment",
          line: adjustmentLine({
            lineType: InvoiceLineType.EXTRA_PHOTOS,
            description: pendingLine.label,
            quantity: lineDiff.quantityDelta,
            unitPrice: pendingLine.unitPrice,
            causeOrderEntityKind: OrderEntityKind.EXTRA_PHOTO,
            causeOrderEntityId: extraPhotoCauseId(pendingLine),
          }),
        };
      }
      if (lineDiff.quantityDelta < 0) {
        return creditNoteCandidate({
          line: creditNoteLine({
            lineType: InvoiceLineType.MANUAL_DISCOUNT,
            description: `Decreased: ${baselineLine.label}`,
            quantity: Math.abs(lineDiff.quantityDelta),
            unitPrice: baselineLine.unitPrice,
            causeOrderEntityKind: OrderEntityKind.EXTRA_PHOTO,
            causeOrderEntityId: extraPhotoCauseId(baselineLine),
          }),
          reason:
            ORDER_COMMIT_CREDIT_NOTE_REASON.EXTRA_PHOTO_QUANTITY_DECREASE,
          causeOrderEntityKind: OrderEntityKind.EXTRA_PHOTO,
          causeOrderEntityId: extraPhotoCauseId(baselineLine),
        });
      }
      return null;
    }
    default:
      return null;
  }
}

function mapSessionConfigurationDiff(
  lineDiff: OrderCommitPreviewLineDiff,
  draftToOrderEntityMap: ReadonlyMap<string, string>
): { kind: "adjustment"; line: OrderCommitAdjustmentLineInput } | CreditNoteCandidate | null {
  if (
    (lineDiff.baselineLine?.unitPrice ?? 0) === 0 &&
    (lineDiff.pendingLine?.unitPrice ?? 0) === 0
  ) {
    return null;
  }

  switch (lineDiff.changeKind) {
    case ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.ADDED: {
      const pendingLine = requiredPendingLine(lineDiff);
      return {
        kind: "adjustment",
        line: adjustmentLine({
          lineType: InvoiceLineType.SESSION_CONFIGURATION,
          description: pendingLine.label,
          quantity: 1,
          unitPrice: pendingLine.unitPrice,
          causeOrderEntityKind:
            OrderEntityKind.SESSION_CONFIGURATION_SELECTION,
          causeOrderEntityId: resolveOrderEntityId(
            pendingLine.orderEntityId,
            draftToOrderEntityMap
          ),
        }),
      };
    }
    case ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.REMOVED: {
      const baselineLine = requiredBaselineLine(lineDiff);
      return creditNoteCandidate({
        line: creditNoteLine({
          lineType: InvoiceLineType.MANUAL_DISCOUNT,
          description: `Removed: ${baselineLine.label}`,
          quantity: 1,
          unitPrice: baselineLine.unitPrice,
          causeOrderEntityKind:
            OrderEntityKind.SESSION_CONFIGURATION_SELECTION,
          causeOrderEntityId: baselineLine.orderEntityId,
        }),
        reason:
          ORDER_COMMIT_CREDIT_NOTE_REASON.REMOVED_SESSION_CONFIGURATION,
        causeOrderEntityKind:
          OrderEntityKind.SESSION_CONFIGURATION_SELECTION,
        causeOrderEntityId: baselineLine.orderEntityId,
      });
    }
    case ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.QUANTITY_CHANGED:
      throwEmissionError(
        "ORDER_COMMIT_FINANCIAL_EMISSION_INVALID_QUANTITY",
        `OrderCommit financial emission rejected selection quantity change for ${lineDiff.stableKey}.`
      );
  }
  return null;
}

function mapLinkedProductDiff(
  lineDiff: OrderCommitPreviewLineDiff,
  draftToOrderEntityMap: ReadonlyMap<string, string>
): { kind: "adjustment"; line: OrderCommitAdjustmentLineInput } | CreditNoteCandidate | null {
  switch (lineDiff.changeKind) {
    case ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.ADDED: {
      const pendingLine = requiredPendingLine(lineDiff);
      return {
        kind: "adjustment",
        line: adjustmentLine({
          lineType: InvoiceLineType.ADD_ON,
          description: pendingLine.label,
          quantity: pendingLine.quantity,
          unitPrice: pendingLine.unitPrice,
          causeOrderEntityKind: OrderEntityKind.ADDON,
          causeOrderEntityId: resolveOrderEntityId(
            linkedProductOrderAddOnId(pendingLine),
            draftToOrderEntityMap
          ),
        }),
      };
    }
    case ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.REMOVED: {
      const baselineLine = requiredBaselineLine(lineDiff);
      const baselineOrderAddOnId = linkedProductOrderAddOnId(baselineLine);
      return creditNoteCandidate({
        line: creditNoteLine({
          lineType: InvoiceLineType.MANUAL_DISCOUNT,
          description: `Removed: ${baselineLine.label}`,
          quantity: baselineLine.quantity,
          unitPrice: baselineLine.unitPrice,
          causeOrderEntityKind: OrderEntityKind.ADDON,
          causeOrderEntityId: baselineOrderAddOnId,
        }),
        reason:
          ORDER_COMMIT_CREDIT_NOTE_REASON.REMOVED_LINKED_PRODUCT_ADD_ON,
        causeOrderEntityKind: OrderEntityKind.ADDON,
        causeOrderEntityId: baselineOrderAddOnId,
      });
    }
    case ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.QUANTITY_CHANGED: {
      const baselineLine = requiredBaselineLine(lineDiff);
      const pendingLine = requiredPendingLine(lineDiff);
      if (lineDiff.quantityDelta > 0) {
        return {
          kind: "adjustment",
          line: adjustmentLine({
            lineType: InvoiceLineType.ADD_ON,
            description: pendingLine.label,
            quantity: lineDiff.quantityDelta,
          unitPrice: pendingLine.unitPrice,
          causeOrderEntityKind: OrderEntityKind.ADDON,
          causeOrderEntityId: resolveOrderEntityId(
            linkedProductOrderAddOnId(pendingLine),
            draftToOrderEntityMap
          ),
        }),
      };
      }
      if (lineDiff.quantityDelta < 0) {
        const baselineOrderAddOnId = linkedProductOrderAddOnId(baselineLine);
        return creditNoteCandidate({
          line: creditNoteLine({
            lineType: InvoiceLineType.MANUAL_DISCOUNT,
            description:
              pendingLine.quantity === 0
                ? `Removed: ${baselineLine.label}`
                : `Decreased: ${baselineLine.label}`,
            quantity: Math.abs(lineDiff.quantityDelta),
            unitPrice: baselineLine.unitPrice,
            causeOrderEntityKind: OrderEntityKind.ADDON,
            causeOrderEntityId: baselineOrderAddOnId,
          }),
          reason:
            pendingLine.quantity === 0
              ? ORDER_COMMIT_CREDIT_NOTE_REASON
                  .REMOVED_LINKED_PRODUCT_ADD_ON
              : ORDER_COMMIT_CREDIT_NOTE_REASON.ADDON_QUANTITY_DECREASE,
          causeOrderEntityKind: OrderEntityKind.ADDON,
          causeOrderEntityId: baselineOrderAddOnId,
        });
      }
      return null;
    }
    default:
      return null;
  }
}

function routeCreditNoteCandidate(input: {
  candidate: CreditNoteCandidate;
  workingOpenLines: Map<string, OrderCommitOpenAdjustmentLine[]>;
  creditNoteFinalLines: OrderCommitFinancialEmission["creditNoteFinalLines"];
  adjustmentReversals: OrderCommitAdjustmentReversal[];
}): void {
  const candidate = input.candidate;
  const key = adjustmentCauseKey(
    candidate.causeOrderEntityKind,
    candidate.causeOrderEntityId
  );
  const openLines = input.workingOpenLines.get(key) ?? [];
  let remaining = round3(candidate.line.unitPrice * candidate.line.quantity);

  for (const openLine of openLines) {
    if (remaining < ONE_FILS) break;
    if (openLine.remainingAmount < ONE_FILS) continue;

    const reversalAmount = round3(
      Math.min(remaining, openLine.remainingAmount)
    );
    input.adjustmentReversals.push({
      reason: candidate.reason,
      parentAdjustmentInvoiceId: openLine.invoiceId,
      targetInvoiceLineId: openLine.invoiceLineId,
      causeOrderEntityKind: candidate.causeOrderEntityKind,
      causeOrderEntityId: candidate.causeOrderEntityId,
      amount: reversalAmount,
      description: candidate.line.description,
      requiresRefund: openLine.isPaid,
    });
    remaining = round3(remaining - reversalAmount);
    openLine.remainingAmount = round3(
      openLine.remainingAmount - reversalAmount
    );
  }

  if (remaining >= ONE_FILS) {
    input.creditNoteFinalLines.push({
      line: {
        ...candidate.line,
        quantity: 1,
        unitPrice: remaining,
      },
      reason: candidate.reason,
    });
  }
}

function assertLinkedProductPairs(
  lineDiffs: readonly OrderCommitPreviewLineDiff[]
): void {
  const selectionDiffs = new Map<string, OrderCommitPreviewLineDiff>();
  const linkedDiffs = new Map<string, OrderCommitPreviewLineDiff>();

  for (const lineDiff of lineDiffs) {
    if (
      lineDiff.lineKind ===
      ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION
    ) {
      selectionDiffs.set(lineDiff.lineId ?? lineDiff.stableKey, lineDiff);
      const selectionId =
        lineDiff.pendingLine?.orderEntityId ??
        lineDiff.baselineLine?.orderEntityId;
      if (selectionId) selectionDiffs.set(selectionId, lineDiff);
    }
    if (
      lineDiff.lineKind ===
      ORDER_COMMIT_SNAPSHOT_LINE_KIND
        .LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON
    ) {
      const selectionId =
        lineDiff.pendingLine?.orderEntityId ??
        lineDiff.baselineLine?.orderEntityId;
      if (selectionId) linkedDiffs.set(selectionId, lineDiff);
    }
  }

  for (const [selectionId, linkedDiff] of linkedDiffs.entries()) {
    const selectionDiff = selectionDiffs.get(selectionId);
    if (!requiresPairCheck(linkedDiff) && !requiresPairCheck(selectionDiff)) {
      continue;
    }
    if (!selectionDiff || !sameLinkedProductSide(selectionDiff, linkedDiff)) {
      throwEmissionError(
        "ORDER_COMMIT_LINKED_PRODUCT_PAIR_BROKEN",
        `OrderCommit financial emission rejected broken linked-product pair for ${selectionId}.`
      );
    }
  }
}

function sameLinkedProductSide(
  selectionDiff: OrderCommitPreviewLineDiff,
  linkedDiff: OrderCommitPreviewLineDiff
): boolean {
  if (selectionDiff.changeKind !== linkedDiff.changeKind) return false;
  if (
    selectionDiff.changeKind ===
    ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.QUANTITY_CHANGED
  ) {
    return (
      Math.sign(selectionDiff.quantityDelta) ===
      Math.sign(linkedDiff.quantityDelta)
    );
  }
  return (
    selectionDiff.changeKind === ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.ADDED ||
    selectionDiff.changeKind === ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.REMOVED
  );
}

function requiresPairCheck(
  lineDiff: OrderCommitPreviewLineDiff | undefined
): boolean {
  if (!lineDiff) return false;
  return (
    lineDiff.changeKind === ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.ADDED ||
    lineDiff.changeKind === ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.REMOVED ||
    lineDiff.changeKind ===
      ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.QUANTITY_CHANGED
  );
}

function adjustmentLine(
  input: OrderCommitAdjustmentLineInput
): OrderCommitAdjustmentLineInput {
  return {
    ...input,
    quantity: positiveQuantity(input.quantity),
    unitPrice: positiveUnitPrice(input.unitPrice),
  };
}

function creditNoteCandidate(
  input: Omit<CreditNoteCandidate, "kind">
): CreditNoteCandidate {
  return {
    ...input,
    kind: "credit",
    line: creditNoteLine(input.line),
  };
}

function creditNoteLine(
  input: OrderCommitCreditNoteLineInput
): OrderCommitCreditNoteLineInput {
  return {
    ...input,
    quantity: positiveQuantity(input.quantity),
    unitPrice: positiveUnitPrice(input.unitPrice),
  };
}

function positiveQuantity(quantity: number): number {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throwEmissionError(
      "ORDER_COMMIT_FINANCIAL_EMISSION_INVALID_QUANTITY",
      `OrderCommit financial emission rejected invalid quantity ${quantity}.`
    );
  }
  return quantity;
}

function positiveUnitPrice(unitPrice: number): number {
  const rounded = round3(unitPrice);
  if (!Number.isFinite(rounded) || rounded <= 0) {
    throwEmissionError(
      "ORDER_COMMIT_FINANCIAL_EMISSION_INVALID_UNIT_PRICE",
      `OrderCommit financial emission rejected invalid unit price ${unitPrice}.`
    );
  }
  return rounded;
}

function requiredBaselineLine(
  lineDiff: OrderCommitPreviewLineDiff
): OrderCommitPreviewLineSummary {
  if (!lineDiff.baselineLine) {
    throwEmissionError(
      "ORDER_COMMIT_FINANCIAL_EMISSION_BASELINE_LINE_MISSING",
      `OrderCommit financial emission expected baseline line for ${lineDiff.stableKey}.`
    );
  }
  return lineDiff.baselineLine;
}

function requiredPendingLine(
  lineDiff: OrderCommitPreviewLineDiff
): OrderCommitPreviewLineSummary {
  if (!lineDiff.pendingLine) {
    throwEmissionError(
      "ORDER_COMMIT_FINANCIAL_EMISSION_PENDING_LINE_MISSING",
      `OrderCommit financial emission expected pending line for ${lineDiff.stableKey}.`
    );
  }
  return lineDiff.pendingLine;
}

function resolveOrderEntityId(
  orderEntityId: string,
  draftToOrderEntityMap: ReadonlyMap<string, string>
): string {
  if (!orderEntityId.startsWith("draft:")) return orderEntityId;
  const resolved = draftToOrderEntityMap.get(orderEntityId);
  if (!resolved) {
    throwEmissionError(
      "ORDER_COMMIT_FINANCIAL_EMISSION_UNRESOLVED_DRAFT_ID",
      `OrderCommit financial emission could not resolve draft id ${orderEntityId}.`
    );
  }
  return resolved;
}

function extraPhotoCauseId(line: OrderCommitPreviewLineSummary): string {
  const mediaType = line.metadata.mediaType;
  if (mediaType !== "DIGITAL" && mediaType !== "PRINT") {
    throwEmissionError(
      "ORDER_COMMIT_FINANCIAL_EMISSION_INVALID_PACKAGE_DIFF",
      `OrderCommit financial emission rejected extra-photo line ${line.stableKey} without mediaType.`
    );
  }
  if (!line.parentOrderPackageId) {
    throwEmissionError(
      "ORDER_COMMIT_FINANCIAL_EMISSION_INVALID_PACKAGE_DIFF",
      `OrderCommit financial emission rejected extra-photo line ${line.stableKey} without parent package.`
    );
  }
  return `${line.parentOrderPackageId}:${mediaType}`;
}

function linkedProductOrderAddOnId(
  line: OrderCommitPreviewLineSummary
): string {
  const orderAddOnId = stringMetadata(line, "orderAddOnId");
  const draftOrderAddOnId = stringMetadata(line, "draftOrderAddOnId");
  if (orderAddOnId) return orderAddOnId;
  if (draftOrderAddOnId) return draftOrderAddOnId;
  throwEmissionError(
    "ORDER_COMMIT_FINANCIAL_EMISSION_UNRESOLVED_DRAFT_ID",
    `OrderCommit financial emission could not resolve linked add-on for ${line.stableKey}.`
  );
}

function stringMetadata(
  line: OrderCommitPreviewLineSummary,
  key: string
): string | null {
  const value = line.metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function cloneOpenAdjustmentLines(
  openAdjustmentLinesByCause: ReadonlyMap<
    string,
    readonly OrderCommitOpenAdjustmentLine[]
  >
): Map<string, OrderCommitOpenAdjustmentLine[]> {
  return new Map(
    [...openAdjustmentLinesByCause.entries()].map(([key, lines]) => [
      key,
      lines.map((line) => ({
        ...line,
        remainingAmount: round3(line.remainingAmount),
        lineSnapshot: { ...line.lineSnapshot },
      })),
    ])
  );
}

function adjustmentCauseKey(
  causeOrderEntityKind: OrderEntityKind,
  causeOrderEntityId: string
): string {
  return `${causeOrderEntityKind}:${causeOrderEntityId}`;
}

function totalLines(lines: readonly OrderCommitAdjustmentLineInput[]): number {
  return lines.reduce(
    (sum, line) => sum + round3(line.quantity * line.unitPrice),
    0
  );
}

function assertTotalsMatch(
  totals: OrderCommitFinancialEmission["totals"],
  diffNetDelta: number
): void {
  const negativeCoverage = round3(
    totals.reversalTotal + totals.creditNoteFinalTotal
  );
  if (!withinTolerance(totals.negativeTotal, negativeCoverage)) {
    throwEmissionError(
      "ORDER_COMMIT_FINANCIAL_EMISSION_TOTAL_MISMATCH",
      "OrderCommit financial emission negative totals do not match reversal plus residual credit totals."
    );
  }
  if (!withinTolerance(totals.netDelta, round3(diffNetDelta))) {
    throwEmissionError(
      "ORDER_COMMIT_FINANCIAL_EMISSION_TOTAL_MISMATCH",
      "OrderCommit financial emission net total does not match snapshot diff."
    );
  }
}

function withinTolerance(left: number, right: number): boolean {
  return Math.abs(round3(left) - round3(right)) <= ONE_FILS;
}

function round3(value: number): number {
  return Number(value.toFixed(3));
}

function throwEmissionError(
  code: OrderCommitFinancialEmissionErrorCode,
  message: string
): never {
  throw new OrderCommitFinancialEmissionError(code, message);
}
