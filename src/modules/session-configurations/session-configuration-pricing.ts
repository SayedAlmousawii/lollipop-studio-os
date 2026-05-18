import {
  Prisma,
  type InvoiceLineType,
  type OrderEntityKind,
  type SessionConfigurationInputType,
  type SessionConfigurationLinkProductDisplay,
  type SessionConfigurationPricingMode,
} from "@prisma/client";

export type PricedSelection = {
  id: string;
  snapshotConfigurationCode: string;
  snapshotLabel: string;
  snapshotPriceDelta: Prisma.Decimal;
  snapshotPricingMode: SessionConfigurationPricingMode;
  snapshotInputType: SessionConfigurationInputType;
  snapshotLinkProductDisplay: SessionConfigurationLinkProductDisplay | null;
  snapshotLinkedProductId: string | null;
  numericValue: Prisma.Decimal | null;
};

export type SnapshotInvoiceLineItemDraft = {
  lineType: InvoiceLineType;
  description: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  sortOrder?: number | null;
  causeOrderEntityKind: OrderEntityKind;
  causeOrderEntityId: string;
};

export class SessionConfigurationPricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionConfigurationPricingError";
  }
}

export function priceSelections(selections: PricedSelection[]): {
  totalDelta: Prisma.Decimal;
  lineItems: SnapshotInvoiceLineItemDraft[];
  nonLineDelta: Prisma.Decimal;
} {
  const initial = {
    lineDelta: zeroMoney(),
    lineItems: [] as SnapshotInvoiceLineItemDraft[],
    nonLineDelta: zeroMoney(),
  };

  const priced = selections.reduce((acc, selection) => {
    const result = priceSingleSelection(selection);
    if (result.lineDelta) {
      acc.lineDelta = acc.lineDelta.plus(result.lineDelta);
    }
    if (result.nonLineDelta) {
      acc.nonLineDelta = acc.nonLineDelta.plus(result.nonLineDelta);
    }
    if (result.lineItem) {
      acc.lineItems.push(result.lineItem);
    }
    return acc;
  }, initial);

  return {
    totalDelta: priced.lineDelta.plus(priced.nonLineDelta),
    lineItems: priced.lineItems,
    nonLineDelta: priced.nonLineDelta,
  };
}

export function priceSingleSelection(selection: PricedSelection): {
  lineDelta: Prisma.Decimal | null;
  nonLineDelta: Prisma.Decimal | null;
  lineItem: SnapshotInvoiceLineItemDraft | null;
} {
  switch (selection.snapshotPricingMode) {
    case "NONE":
      return {
        lineDelta: zeroMoney(),
        nonLineDelta: zeroMoney(),
        lineItem: null,
      };
    case "FIXED":
      return createLineSelectionPrice(selection);
    case "TIERED":
      if (
        selection.snapshotInputType !== "SELECT" &&
        selection.snapshotInputType !== "COUNTER"
      ) {
        throw new SessionConfigurationPricingError(
          `Tiered session configuration ${selection.snapshotConfigurationCode} has unsupported input type ${selection.snapshotInputType}`
        );
      }
      return createLineSelectionPrice(selection);
    case "LINKED_PRODUCT":
      if (selection.snapshotLinkProductDisplay === "LINE_ITEM") {
        return createLineSelectionPrice(selection);
      }
      if (selection.snapshotLinkProductDisplay === "MODIFIER_ONLY") {
        return {
          lineDelta: null,
          nonLineDelta: selection.snapshotPriceDelta,
          lineItem: null,
        };
      }
      throw new SessionConfigurationPricingError(
        `Linked-product session configuration ${selection.snapshotConfigurationCode} is missing a display mode`
      );
    default:
      throw new SessionConfigurationPricingError(
        `Unsupported session configuration pricing mode ${String(
          selection.snapshotPricingMode
        )}`
      );
  }
}

function createLineSelectionPrice(selection: PricedSelection): {
  lineDelta: Prisma.Decimal;
  nonLineDelta: Prisma.Decimal | null;
  lineItem: SnapshotInvoiceLineItemDraft;
} {
  return {
    lineDelta: selection.snapshotPriceDelta,
    nonLineDelta: null,
    lineItem: {
      lineType: "SESSION_CONFIGURATION",
      description: formatSelectionDescription(selection),
      quantity: 1,
      unitPrice: selection.snapshotPriceDelta,
      lineTotal: selection.snapshotPriceDelta,
      causeOrderEntityKind: "SESSION_CONFIGURATION_SELECTION",
      causeOrderEntityId: selection.id,
    },
  };
}

function formatSelectionDescription(selection: PricedSelection): string {
  if (selection.snapshotInputType !== "COUNTER") {
    return selection.snapshotLabel;
  }

  const value = selection.numericValue?.toString() ?? "0";
  return `${selection.snapshotLabel} (×${value})`;
}

function zeroMoney(): Prisma.Decimal {
  return new Prisma.Decimal(0);
}
