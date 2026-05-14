import { InvoiceLineType, InvoiceType, MediaType, Prisma } from "@prisma/client";
import { getExtraPhotoUnitPriceWithClient } from "@/modules/pricing/pricing.service";
import { db } from "@/lib/db";

type DbClient = typeof db | Prisma.TransactionClient;
export type Money = Prisma.Decimal;

export type AdditionEvent =
  | {
      kind: "NEW_ADDON";
      orderAddOnId: string;
      nameSnapshot: string;
      priceSnapshot: Money;
      quantity: number;
    }
  | {
      kind: "NEW_UPGRADE";
      orderPackageItemUpgradeId: string;
      nameSnapshot: string;
      priceSnapshot: Money;
      quantity: number;
    }
  | {
      kind: "ADDON_QUANTITY_INCREASE";
      orderAddOnId: string;
      deltaQuantity: number;
      lineSnapshot: { name: string; unitPrice: Money };
    }
  | {
      kind: "NEW_EXTRA_PHOTO";
      lineSnapshot: { name: string };
      priceSnapshot: Money;
      quantity: number;
    }
  | {
      kind: "PACKAGE_TIER_UPGRADE";
      oldPriceSnapshot: Money;
      newPriceSnapshot: Money;
    };

export type ReductionEvent =
  | { kind: "REMOVED_ADDON"; lineSnapshot: { name: string; totalValue: Money } }
  | { kind: "REMOVED_UPGRADE"; lineSnapshot: { name: string; totalValue: Money } }
  | {
      kind: "ADDON_QUANTITY_DECREASE";
      deltaQuantity: number;
      lineSnapshot: { name: string; unitPrice: Money };
    }
  | { kind: "REMOVED_EXTRA_PHOTO"; lineSnapshot: { name: string; totalValue: Money } }
  | {
      kind: "PACKAGE_TIER_DOWNGRADE";
      oldPriceSnapshot: Money;
      newPriceSnapshot: Money;
    }
  | { kind: "PRICE_SNAPSHOT_EDIT_ATTEMPT"; lineSnapshot: { name: string } };

export type SwapEvent = {
  kind: "UPGRADE_REPLACEMENT";
  removedPriceSnapshot: Money;
  addedPriceSnapshot: Money;
  removedLineSnapshot: { name: string };
  addedLineSnapshot: { name: string };
};

export type EditDelta = {
  additions: AdditionEvent[];
  reductions: ReductionEvent[];
  swaps: SwapEvent[];
};

type ComparableLine = {
  id?: string;
  source: "ADDON" | "UPGRADE" | "EXTRA_PHOTO";
  name: string;
  quantity: number;
  unitPrice: Money;
};

export async function computeOrderEditDelta(
  orderId: string,
  client: DbClient
): Promise<EditDelta> {
  const order = await client.order.findUnique({
    where: { id: orderId },
    include: {
      booking: { select: { financialCase: { select: { id: true } } } },
      packages: {
        include: { package: { select: { name: true, price: true } } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
      orderAddOns: {
        select: {
          id: true,
          nameSnapshot: true,
          priceSnapshot: true,
          quantity: true,
        },
        orderBy: { createdAt: "asc" },
      },
      packageItemUpgrades: {
        select: {
          id: true,
          nameSnapshot: true,
          priceSnapshot: true,
          quantity: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!order) throw new Error("Order not found");
  const financialCaseId = order.booking?.financialCase?.id;
  if (!financialCaseId) {
    throw new Error("Order financial case is required to compute edit delta");
  }

  const finalInvoice = await client.invoice.findFirst({
    where: {
      financialCaseId,
      orderId,
      invoiceType: InvoiceType.FINAL,
      parentInvoiceId: null,
      isLocked: true,
    },
    include: { lineItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
    orderBy: { createdAt: "asc" },
  });
  if (!finalInvoice) throw new Error("Locked final invoice not found");
  if (finalInvoice.lineItems.length === 0) {
    throw new Error("Locked final invoice has no snapshotted line items");
  }

  const additions: AdditionEvent[] = [];
  const reductions: ReductionEvent[] = [];
  const swaps: SwapEvent[] = [];

  comparePackageTotals({
    previousTotal: sumLines(finalInvoice.lineItems, InvoiceLineType.PACKAGE_BASE),
    nextTotal: order.packages.reduce(
      (sum, line) => sum.plus(line.finalPackagePriceSnapshot ?? line.package.price),
      new Prisma.Decimal(0)
    ),
    additions,
    reductions,
  });

  compareLines({
    previous: finalInvoice.lineItems
      .filter((line) => line.lineType === InvoiceLineType.ADD_ON)
      .map((line) => ({
        source: "ADDON" as const,
        name: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      })),
    next: [
      ...order.orderAddOns.map((line) => ({
        id: line.id,
        source: "ADDON" as const,
        name: line.nameSnapshot,
        quantity: line.quantity,
        unitPrice: line.priceSnapshot,
      })),
      ...order.packageItemUpgrades.map((line) => ({
        id: line.id,
        source: "UPGRADE" as const,
        name: line.nameSnapshot,
        quantity: line.quantity,
        unitPrice: line.priceSnapshot,
      })),
    ],
    additions,
    reductions,
    swaps,
  });

  compareLines({
    previous: finalInvoice.lineItems
      .filter((line) => line.lineType === InvoiceLineType.EXTRA_PHOTOS)
      .map((line) => ({
        source: "EXTRA_PHOTO" as const,
        name: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      })),
    next: await buildCurrentExtraPhotoLines(order.packages, client),
    additions,
    reductions,
    swaps,
  });

  return { additions, reductions, swaps };
}

function comparePackageTotals({
  previousTotal,
  nextTotal,
  additions,
  reductions,
}: {
  previousTotal: Money;
  nextTotal: Money;
  additions: AdditionEvent[];
  reductions: ReductionEvent[];
}) {
  if (nextTotal.equals(previousTotal)) return;
  if (nextTotal.greaterThan(previousTotal)) {
    additions.push({
      kind: "PACKAGE_TIER_UPGRADE",
      oldPriceSnapshot: previousTotal,
      newPriceSnapshot: nextTotal,
    });
    return;
  }

  reductions.push({
    kind: "PACKAGE_TIER_DOWNGRADE",
    oldPriceSnapshot: previousTotal,
    newPriceSnapshot: nextTotal,
  });
}

function compareLines({
  previous,
  next,
  additions,
  reductions,
  swaps,
}: {
  previous: ComparableLine[];
  next: ComparableLine[];
  additions: AdditionEvent[];
  reductions: ReductionEvent[];
  swaps: SwapEvent[];
}) {
  const remainingPrevious = [...previous];
  const remainingNext = [...next];

  for (let nextIndex = remainingNext.length - 1; nextIndex >= 0; nextIndex--) {
    const nextLine = remainingNext[nextIndex];
    const previousIndex = remainingPrevious.findIndex(
      (line) => line.name === nextLine.name && line.unitPrice.equals(nextLine.unitPrice)
    );
    if (previousIndex === -1) continue;

    const previousLine = remainingPrevious.splice(previousIndex, 1)[0];
    remainingNext.splice(nextIndex, 1);
    if (nextLine.quantity > previousLine.quantity) {
      additions.push(toQuantityIncrease(nextLine, nextLine.quantity - previousLine.quantity));
    } else if (nextLine.quantity < previousLine.quantity) {
      reductions.push(toQuantityDecrease(previousLine, previousLine.quantity - nextLine.quantity));
    }
  }

  for (let nextIndex = remainingNext.length - 1; nextIndex >= 0; nextIndex--) {
    const nextLine = remainingNext[nextIndex];
    const previousIndex = remainingPrevious.findIndex(
      (line) => line.name === nextLine.name && !line.unitPrice.equals(nextLine.unitPrice)
    );
    if (previousIndex === -1) continue;

    const previousLine = remainingPrevious.splice(previousIndex, 1)[0];
    remainingNext.splice(nextIndex, 1);
    reductions.push({
      kind: "PRICE_SNAPSHOT_EDIT_ATTEMPT",
      lineSnapshot: { name: previousLine.name },
    });
  }

  if (
    remainingPrevious.length === 1 &&
    remainingNext.length === 1 &&
    remainingNext[0]?.source === "UPGRADE"
  ) {
    const removed = remainingPrevious.pop();
    const added = remainingNext.pop();
    if (removed && added) {
      swaps.push({
        kind: "UPGRADE_REPLACEMENT",
        removedPriceSnapshot: removed.unitPrice.mul(removed.quantity),
        addedPriceSnapshot: added.unitPrice.mul(added.quantity),
        removedLineSnapshot: { name: removed.name },
        addedLineSnapshot: { name: added.name },
      });
    }
  }

  for (const nextLine of remainingNext) {
    additions.push(toAddition(nextLine));
  }
  for (const previousLine of remainingPrevious) {
    reductions.push(toReduction(previousLine));
  }
}

function toAddition(line: ComparableLine): AdditionEvent {
  if (line.source === "UPGRADE") {
    return {
      kind: "NEW_UPGRADE",
      orderPackageItemUpgradeId: requiredId(line),
      nameSnapshot: line.name,
      priceSnapshot: line.unitPrice,
      quantity: line.quantity,
    };
  }
  if (line.source === "EXTRA_PHOTO") {
    return {
      kind: "NEW_EXTRA_PHOTO",
      lineSnapshot: { name: line.name },
      priceSnapshot: line.unitPrice,
      quantity: line.quantity,
    };
  }

  return {
    kind: "NEW_ADDON",
    orderAddOnId: requiredId(line),
    nameSnapshot: line.name,
    priceSnapshot: line.unitPrice,
    quantity: line.quantity,
  };
}

function toQuantityIncrease(line: ComparableLine, deltaQuantity: number): AdditionEvent {
  if (line.source === "EXTRA_PHOTO") {
    return {
      kind: "NEW_EXTRA_PHOTO",
      lineSnapshot: { name: line.name },
      priceSnapshot: line.unitPrice,
      quantity: deltaQuantity,
    };
  }

  return {
    kind: "ADDON_QUANTITY_INCREASE",
    orderAddOnId: requiredId(line),
    deltaQuantity,
    lineSnapshot: { name: line.name, unitPrice: line.unitPrice },
  };
}

function toQuantityDecrease(line: ComparableLine, deltaQuantity: number): ReductionEvent {
  if (line.source === "EXTRA_PHOTO") {
    return {
      kind: "REMOVED_EXTRA_PHOTO",
      lineSnapshot: { name: line.name, totalValue: line.unitPrice.mul(deltaQuantity) },
    };
  }

  return {
    kind: "ADDON_QUANTITY_DECREASE",
    deltaQuantity,
    lineSnapshot: { name: line.name, unitPrice: line.unitPrice },
  };
}

function toReduction(line: ComparableLine): ReductionEvent {
  if (line.source === "UPGRADE") {
    return {
      kind: "REMOVED_UPGRADE",
      lineSnapshot: { name: line.name, totalValue: line.unitPrice.mul(line.quantity) },
    };
  }
  if (line.source === "EXTRA_PHOTO") {
    return {
      kind: "REMOVED_EXTRA_PHOTO",
      lineSnapshot: { name: line.name, totalValue: line.unitPrice.mul(line.quantity) },
    };
  }

  return {
    kind: "REMOVED_ADDON",
    lineSnapshot: { name: line.name, totalValue: line.unitPrice.mul(line.quantity) },
  };
}

async function buildCurrentExtraPhotoLines(
  packages: Array<{
    sessionTypeId: string;
    extraDigitalCount: number;
    extraPrintCount: number;
    package: { name: string };
  }>,
  client: DbClient
): Promise<ComparableLine[]> {
  const lines: ComparableLine[] = [];
  for (const orderPackage of packages) {
    for (const mediaType of [MediaType.DIGITAL, MediaType.PRINT] as const) {
      const quantity =
        mediaType === MediaType.DIGITAL
          ? orderPackage.extraDigitalCount
          : orderPackage.extraPrintCount;
      if (quantity <= 0) continue;

      lines.push({
        source: "EXTRA_PHOTO",
        name: `Extra photos - ${formatEnum(mediaType)} (${orderPackage.package.name})`,
        quantity,
        unitPrice: await getExtraPhotoUnitPriceWithClient(
          client,
          orderPackage.sessionTypeId,
          mediaType
        ),
      });
    }
  }

  return lines;
}

function sumLines(
  lines: Array<{ lineType: InvoiceLineType; lineTotal: Prisma.Decimal }>,
  lineType: InvoiceLineType
): Money {
  return lines
    .filter((line) => line.lineType === lineType)
    .reduce((sum, line) => sum.plus(line.lineTotal), new Prisma.Decimal(0));
}

function requiredId(line: ComparableLine): string {
  if (!line.id) throw new Error(`Missing line source id for ${line.name}`);
  return line.id;
}

function formatEnum(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
