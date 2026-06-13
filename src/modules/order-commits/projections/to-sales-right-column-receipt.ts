import type { SalesPageComposition } from "./sales-page-view.types";

export type SalesReceiptLine = {
  id: string;
  label: string;
  meta: string | null;
  quantity: number | null;
  unitPrice: number | null;
  totalAmount: number;
};

export type SalesReceiptGroup = {
  id: string;
  title: string;
  lines: SalesReceiptLine[];
};

export type SalesRightColumnReceipt = {
  source: SalesPageComposition["source"];
  groups: SalesReceiptGroup[];
  totalAmount: number;
};

export function toSalesRightColumnReceipt(
  composition: SalesPageComposition
): SalesRightColumnReceipt {
  const groups: SalesReceiptGroup[] = [];

  for (const packageLine of composition.packageLines) {
    const lines: SalesReceiptLine[] = [
      {
        id: `${packageLine.orderPackageId}:package`,
        label: packageLine.packageName,
        meta: packageReceiptMeta(packageLine),
        quantity: 1,
        unitPrice: packageLine.packagePrice,
        totalAmount: packageLine.packagePrice,
      },
    ];
    const packageItemUpgradeDelta = packageLine.packageItemUpgradeDelta ?? 0;

    if (packageItemUpgradeDelta !== 0) {
      lines.push({
        id: `${packageLine.orderPackageId}:package-item-upgrades`,
        label: "Package item upgrades",
        meta: null,
        quantity: null,
        unitPrice: null,
        totalAmount: packageItemUpgradeDelta,
      });
    }

    appendExtraPhotoLines(lines, packageLine);
    appendSessionConfigurationLines(lines, composition, packageLine.orderPackageId);
    appendAddOnLines(lines, composition, packageLine.orderPackageId);

    groups.push({
      id: packageLine.orderPackageId,
      title: packageLine.packageName,
      lines,
    });
  }

  const orderLevelLines: SalesReceiptLine[] = [];
  appendSessionConfigurationLines(orderLevelLines, composition, null);
  appendAddOnLines(orderLevelLines, composition, null);
  if (orderLevelLines.length > 0) {
    groups.push({
      id: "order-level",
      title: "Order-level add-ons",
      lines: orderLevelLines,
    });
  }

  return {
    source: composition.source,
    groups,
    totalAmount: composition.totals.netCompositionTotal,
  };
}

function packageReceiptMeta(
  packageLine: SalesPageComposition["packageLines"][number]
): string | null {
  const parts = [packageLine.sessionTypeName].filter(Boolean);
  const originalPackageName = packageLine.originalPackageName;
  const packageTierDelta = packageLine.packageTierDelta ?? 0;
  if (
    packageTierDelta !== 0 &&
    originalPackageName &&
    originalPackageName !== packageLine.packageName
  ) {
    parts.push(`Upgraded from ${originalPackageName}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function appendExtraPhotoLines(
  lines: SalesReceiptLine[],
  packageLine: SalesPageComposition["packageLines"][number]
) {
  if (packageLine.extraDigitalCount > 0) {
    lines.push({
      id: `${packageLine.orderPackageId}:extra-digital`,
      label: "Extra digital photos",
      meta: null,
      quantity: packageLine.extraDigitalCount,
      unitPrice: packageLine.extraDigitalUnitPrice,
      totalAmount: roundMoney(
        packageLine.extraDigitalCount * packageLine.extraDigitalUnitPrice
      ),
    });
  }

  if (packageLine.extraPrintCount > 0) {
    lines.push({
      id: `${packageLine.orderPackageId}:extra-print`,
      label: "Extra printed photos",
      meta: null,
      quantity: packageLine.extraPrintCount,
      unitPrice: packageLine.extraPrintUnitPrice,
      totalAmount: roundMoney(
        packageLine.extraPrintCount * packageLine.extraPrintUnitPrice
      ),
    });
  }
}

function appendSessionConfigurationLines(
  lines: SalesReceiptLine[],
  composition: SalesPageComposition,
  orderPackageId: string | null
) {
  for (const config of composition.sessionConfigurations) {
    if (config.orderPackageId !== orderPackageId) continue;
    if (config.priceDelta === 0) continue;

    lines.push({
      id: config.id,
      label: config.label,
      meta: config.optionLabel ?? config.numericValue ?? config.textValue,
      quantity: 1,
      unitPrice: config.priceDelta,
      totalAmount: config.priceDelta,
    });
  }
}

function appendAddOnLines(
  lines: SalesReceiptLine[],
  composition: SalesPageComposition,
  orderPackageId: string | null
) {
  for (const addOn of composition.addOns) {
    if (addOn.orderPackageId !== orderPackageId) continue;

    lines.push({
      id: addOn.id,
      label: addOn.name,
      meta: null,
      quantity: addOn.quantity,
      unitPrice: addOn.unitAmount,
      totalAmount: addOn.totalAmount,
    });
  }
}

function roundMoney(value: number): number {
  return Number(value.toFixed(3));
}
