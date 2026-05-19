import type {
  CompositionLine,
  CompositionPackageLine,
  CompositionSnapshot,
  OrderCompositionViewModel,
} from "../order-composition.types";

export type POSCompositionPackageItemProjection = {
  id: string;
  productId: string | null;
  productName: string;
  category: string | null;
  quantity: number;
  unitAmount: number;
  totalAmount: number;
};

export type POSCompositionPackageLineProjection = {
  id: string;
  orderPackageId: string;
  packageId: string;
  packageName: string;
  packagePrice: number;
  sessionTypeId: string | null;
  sessionTypeName: string | null;
  includedPhotoCount: number;
  selectedPhotoCount: number;
  extraDigitalCount: number;
  extraPrintCount: number;
  extraPhotoCount: number;
  extraPhotoTotal: number;
  packageSubtotal: number;
  upgradeDelta: number;
  packageItems: POSCompositionPackageItemProjection[];
};

export type POSCompositionAddOnProjection = {
  id: string;
  orderAddOnId: string | null;
  productId: string | null;
  name: string;
  quantity: number;
  unitAmount: number;
  totalAmount: number;
};

export type POSCompositionSessionConfigurationProjection = {
  id: string;
  orderPackageId: string | null;
  configurationId: string | null;
  label: string;
  optionLabel: string | null;
  numericValue: string | null;
  textValue: string | null;
  priceDelta: number;
};

export type POSCompositionTotalsProjection = {
  packageBaseTotal: number;
  packageUpgradeDeltaTotal: number;
  deliverablesTotal: number;
  addOnTotal: number;
  extraPhotoTotal: number;
  sessionConfigurationTotal: number;
  netCompositionTotal: number;
};

export type DraftPOSCompositionProjection = {
  orderId: string;
  jobNumber: string;
  sourceState: OrderCompositionViewModel["state"];
  packageLines: POSCompositionPackageLineProjection[];
  addOns: POSCompositionAddOnProjection[];
  sessionConfigurations: POSCompositionSessionConfigurationProjection[];
  totals: POSCompositionTotalsProjection;
};

export function toDraftPOSComposition(
  model: OrderCompositionViewModel
): DraftPOSCompositionProjection {
  return toPOSCompositionProjection(model, model.effectiveComposition);
}

export function toPOSCompositionProjection(
  model: OrderCompositionViewModel,
  snapshot: CompositionSnapshot
): DraftPOSCompositionProjection {
  const packageLines = projectablePackageLines(snapshot).map((line) => {
    const extras = snapshot.extraPhotos.filter(
      (extraPhoto) => extraPhoto.orderPackageId === line.orderPackageId
    );
    const extraDigitalCount = extras
      .filter((extraPhoto) => extraPhoto.metadata.mediaType === "DIGITAL")
      .reduce((sum, extraPhoto) => sum + extraPhoto.quantity, 0);
    const extraPrintCount = extras
      .filter((extraPhoto) => extraPhoto.metadata.mediaType === "PRINT")
      .reduce((sum, extraPhoto) => sum + extraPhoto.quantity, 0);
    const extraPhotoTotal = roundMoney(
      extras.reduce((sum, extraPhoto) => sum + extraPhoto.totalAmount, 0)
    );
    const packageItems = projectPackageItems(
      snapshot,
      model.baseComposition,
      line.orderPackageId
    );
    const includedPhotoCount = line.includedPhotoCount;
    const extraPhotoCount = extraDigitalCount + extraPrintCount;

    return {
      id: line.id,
      orderPackageId: line.orderPackageId,
      packageId: line.packageId,
      packageName: line.label,
      packagePrice: line.totalAmount,
      sessionTypeId: line.sessionTypeId ?? null,
      sessionTypeName: line.sessionTypeName ?? null,
      includedPhotoCount,
      selectedPhotoCount:
        line.selectedPhotoCount > 0
          ? line.selectedPhotoCount
          : includedPhotoCount + extraPhotoCount,
      extraDigitalCount,
      extraPrintCount,
      extraPhotoCount,
      extraPhotoTotal,
      packageSubtotal: roundMoney(line.totalAmount + extraPhotoTotal),
      upgradeDelta: line.upgradeDelta,
      packageItems,
    };
  });

  return {
    orderId: model.orderId,
    jobNumber: model.jobNumber,
    sourceState: model.state,
    packageLines,
    addOns: snapshot.addOns.map(projectAddOn),
    sessionConfigurations: snapshot.sessionConfigurations.map((line) => ({
      id: line.id,
      orderPackageId: line.orderPackageId ?? null,
      configurationId: line.configurationId ?? null,
      label: line.label,
      optionLabel: line.optionLabel ?? null,
      numericValue: line.numericValue ?? null,
      textValue: line.textValue ?? null,
      priceDelta: line.totalAmount,
    })),
    totals: { ...snapshot.totals },
  };
}

function projectablePackageLines(
  snapshot: CompositionSnapshot
): CompositionPackageLine[] {
  const packageLinesByOrderPackageId = new Map(
    snapshot.packageLines.map((line) => [line.orderPackageId, line])
  );

  for (const line of snapshot.lines) {
    const orderPackageId = line.metadata.orderPackageId;
    if (
      !orderPackageId ||
      !line.id.startsWith("package:") ||
      line.metadata.displayKind !== "swap"
    ) {
      continue;
    }
    packageLinesByOrderPackageId.set(orderPackageId, {
      ...line,
      label: line.metadata.toLabel ?? line.label,
      metadata: {
        ...line.metadata,
        displayKind: "package",
      },
      orderPackageId,
      packageId: line.metadata.packageId ?? String(line.metadata.sourceRefId ?? ""),
      includedPhotoCount: 0,
      selectedPhotoCount: 0,
      extraDigitalCount: 0,
      extraPrintCount: 0,
      extraPhotoCount: 0,
      upgradeDelta: 0,
      packageItems: [],
    });
  }

  return [...packageLinesByOrderPackageId.values()];
}

function projectPackageItems(
  snapshot: CompositionSnapshot,
  baseSnapshot: CompositionSnapshot | null,
  orderPackageId: string
): POSCompositionPackageItemProjection[] {
  const baseItems = (baseSnapshot?.deliverables ?? snapshot.deliverables).filter(
    (line) => line.metadata.orderPackageId === orderPackageId
  );
  const itemById = new Map(
    baseItems.map((line) => [
      line.metadata.packageItemId ?? line.id,
      projectPackageItem(line),
    ])
  );

  for (const line of snapshot.deliverables) {
    if (line.metadata.displayKind === "upgrade") continue;
    if (line.metadata.orderPackageId !== orderPackageId) continue;
    itemById.set(line.metadata.packageItemId ?? line.id, projectPackageItem(line));
  }

  const processedUpgradeItemIds = new Set<string>();
  for (const line of snapshot.lines) {
    if (
      line.metadata.displayKind !== "upgrade" ||
      line.metadata.orderPackageId !== orderPackageId
    ) {
      continue;
    }
    const itemId = line.metadata.packageItemId ?? line.id;
    if (processedUpgradeItemIds.has(itemId)) continue;
    processedUpgradeItemIds.add(itemId);
    const baseItem = itemById.get(itemId);
    itemById.set(itemId, {
      id: itemId,
      productId: line.metadata.productId ?? baseItem?.productId ?? null,
      productName: line.metadata.toLabel ?? line.label,
      category: line.metadata.categoryLabel ?? baseItem?.category ?? null,
      quantity: line.quantity,
      unitAmount: roundMoney((baseItem?.unitAmount ?? 0) + line.unitAmount),
      totalAmount: roundMoney((baseItem?.totalAmount ?? 0) + line.totalAmount),
    });
  }

  return [...itemById.values()];
}

function projectPackageItem(
  line: CompositionLine
): POSCompositionPackageItemProjection {
  return {
    id: line.metadata.packageItemId ?? line.id,
    productId: line.metadata.productId ?? null,
    productName: line.label,
    category: line.metadata.categoryLabel ?? null,
    quantity: line.quantity,
    unitAmount: line.unitAmount,
    totalAmount: line.totalAmount,
  };
}

function projectAddOn(line: CompositionLine): POSCompositionAddOnProjection {
  return {
    id: line.id,
    orderAddOnId: line.metadata.orderAddOnId ?? null,
    productId: line.metadata.productId ?? line.metadata.sourceRefId ?? null,
    name: line.label,
    quantity: line.quantity,
    unitAmount: line.unitAmount,
    totalAmount: line.totalAmount,
  };
}

function roundMoney(value: number): number {
  return Number(value.toFixed(3));
}
