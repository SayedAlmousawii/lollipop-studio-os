import { InvoiceType, MediaType } from "@prisma/client";
import { db } from "@/lib/db";
import { getPOSWorkspace } from "@/modules/orders/order.service";
import type {
  POSAddOn,
  POSPackageItem,
  POSPackageLine,
  POSWorkspace,
} from "@/modules/orders/order.types";
import type {
  CompositionExtraPhotoLine,
  CompositionLine,
  CompositionPackageLine,
  CompositionSessionConfigurationLine,
  CompositionSnapshot,
  OrderCompositionViewModel,
} from "./order-composition.types";

export async function getDraftOrderCompositionViewModel(
  orderId: string
): Promise<OrderCompositionViewModel | null> {
  const workspace = await getPOSWorkspace(orderId);
  if (!workspace) return null;
  const effectiveComposition = buildCompositionSnapshotFromPOSWorkspace(workspace);
  return {
    orderId: workspace.orderId,
    jobNumber: workspace.jobNumber,
    state: "draft",
    baseComposition: null,
    effectiveComposition,
    pendingAdjustmentComposition: null,
    totals: effectiveComposition.totals,
  };
}

export async function getLockedOrderCompositionViewModel(input: {
  invoiceId: string;
}): Promise<OrderCompositionViewModel> {
  const invoice = await db.invoice.findUnique({
    where: { id: input.invoiceId },
    select: {
      id: true,
      orderId: true,
      order: { select: { jobNumber: true } },
    },
  });
  if (!invoice?.orderId || !invoice.order) {
    throw new Error("Final invoice has no attached order");
  }

  const workspace = await getPOSWorkspace(invoice.orderId);
  if (!workspace) {
    throw new Error("Final invoice order composition is unavailable");
  }
  const effectiveComposition = buildCompositionSnapshotFromPOSWorkspace(workspace);
  return {
    orderId: invoice.orderId,
    jobNumber: invoice.order.jobNumber,
    state: "locked",
    baseComposition: effectiveComposition,
    effectiveComposition,
    pendingAdjustmentComposition: null,
    totals: effectiveComposition.totals,
  };
}

export async function getOrderCompositionViewModel(input: {
  orderId?: string;
  invoiceId?: string;
}): Promise<OrderCompositionViewModel | null> {
  if (input.invoiceId) {
    return getLockedOrderCompositionViewModel({ invoiceId: input.invoiceId });
  }
  if (!input.orderId) {
    throw new Error("Order composition requires an order or invoice id");
  }

  const finalInvoice = await db.invoice.findFirst({
    where: { orderId: input.orderId, invoiceType: InvoiceType.FINAL },
    select: { id: true, isLocked: true },
    orderBy: { createdAt: "desc" },
  });
  if (finalInvoice?.isLocked) {
    return getLockedOrderCompositionViewModel({ invoiceId: finalInvoice.id });
  }

  return getDraftOrderCompositionViewModel(input.orderId);
}

export function buildCompositionSnapshotFromPOSWorkspace(
  workspace: POSWorkspace
): CompositionSnapshot {
  const packageLines = workspace.packageLines.map(mapPOSPackageLine);
  const deliverables = packageLines.flatMap((line) => line.packageItems);
  const extraPhotos = workspace.packageLines.flatMap(mapPOSExtraPhotoLines);
  const sessionConfigurations = workspace.packageLines.flatMap(
    mapPOSSessionConfigurationLines
  );
  const addOns = workspace.addOns.map(mapPOSAddOn);
  const lines = [
    ...packageLines,
    ...deliverables,
    ...extraPhotos,
    ...sessionConfigurations,
    ...addOns,
  ];

  return {
    capturedAt: null,
    packageLines,
    deliverables,
    addOns,
    extraPhotos,
    sessionConfigurations,
    adjustmentLines: [],
    lines,
    totals: {
      packageBaseTotal: roundMoney(
        packageLines.reduce((sum, line) => sum + line.totalAmount, 0)
      ),
      packageUpgradeDeltaTotal: roundMoney(
        packageLines.reduce((sum, line) => sum + line.upgradeDelta, 0)
      ),
      deliverablesTotal: roundMoney(
        deliverables.reduce((sum, line) => sum + line.totalAmount, 0)
      ),
      addOnTotal: roundMoney(workspace.addOnTotal),
      extraPhotoTotal: roundMoney(workspace.extraPhotoTotal),
      sessionConfigurationTotal: roundMoney(workspace.sessionConfigurationTotal),
      netCompositionTotal: roundMoney(
        packageLines.reduce((sum, line) => sum + line.totalAmount, 0) +
          workspace.addOnTotal +
          workspace.extraPhotoTotal +
          workspace.sessionConfigurationTotal
      ),
    },
  };
}

export function mapPOSPackageLine(line: POSPackageLine): CompositionPackageLine {
  const packageItems = line.packageItems.map((item) =>
    mapPOSPackageItem(item, line.id)
  );
  const packageTierDelta = roundMoney(
    line.currentPackage.price - line.originalPackage.price
  );
  return {
    id: `package:${line.id}`,
    label: line.currentPackage.name,
    quantity: 1,
    unitAmount: roundMoney(line.currentPackage.price),
    totalAmount: roundMoney(line.currentPackage.price),
    metadata: {
      displayKind: "package",
      sourceKind: "orderPackage",
      orderPackageId: line.id,
      packageId: line.currentPackage.id,
      sourceLineId: line.id,
      sourceRefId: line.currentPackage.id,
    },
    orderPackageId: line.id,
    packageId: line.currentPackage.id,
    originalPackageName: line.originalPackage.name,
    sessionTypeId: line.sessionTypeId,
    sessionTypeName: line.sessionTypeName,
    includedPhotoCount: line.includedPhotoCount,
    selectedPhotoCount: line.selectedPhotoCount,
    extraDigitalCount: line.extraDigitalCount,
    extraPrintCount: line.extraPrintCount,
    extraPhotoCount: line.extraPhotoCount,
    extraDigitalUnitPrice: line.extraDigitalUnitPrice,
    extraPrintUnitPrice: line.extraPrintUnitPrice,
    upgradeDelta: roundMoney(line.upgradeDelta),
    packageTierDelta,
    packageItemUpgradeDelta: roundMoney(line.upgradeDelta - packageTierDelta),
    packageItems,
  };
}

function mapPOSPackageItem(
  item: POSPackageItem,
  orderPackageId: string
): CompositionLine {
  return {
    id: `package-item:${orderPackageId}:${item.id}`,
    label: item.productName,
    quantity: item.quantity,
    unitAmount: roundMoney(item.priceSnapshot),
    totalAmount: roundMoney(item.priceSnapshot * item.quantity),
    metadata: {
      displayKind: "line",
      sourceKind: "packageItem",
      orderPackageId,
      packageItemId: item.id,
      productId: item.productId,
      categoryLabel: item.category,
      sourceLineId: item.id,
      sourceRefId: item.productId,
    },
  };
}

export function mapPOSExtraPhotoLines(
  line: POSPackageLine
): CompositionExtraPhotoLine[] {
  return [
    extraPhotoLineFromPOSPackageLine(line, MediaType.DIGITAL),
    extraPhotoLineFromPOSPackageLine(line, MediaType.PRINT),
  ].filter((extraPhotoLine): extraPhotoLine is CompositionExtraPhotoLine =>
    Boolean(extraPhotoLine)
  );
}

function extraPhotoLineFromPOSPackageLine(
  line: POSPackageLine,
  mediaType: MediaType
): CompositionExtraPhotoLine | null {
  const quantity =
    mediaType === MediaType.DIGITAL
      ? line.extraDigitalCount
      : line.extraPrintCount;
  if (quantity <= 0) return null;
  const unitAmount =
    mediaType === MediaType.DIGITAL
      ? line.extraDigitalUnitPrice
      : line.extraPrintUnitPrice;
  return {
    id: extraPhotoLineId(line.id, mediaType),
    label: `Extra photos - ${formatEnum(mediaType)} (${line.currentPackage.name})`,
    quantity,
    unitAmount: roundMoney(unitAmount),
    totalAmount: roundMoney(unitAmount * quantity),
    metadata: {
      displayKind: "extraPhotos",
      sourceKind: "extraPhoto",
      orderPackageId: line.id,
      mediaType,
      categoryLabel: "Extra photos",
      sourceLineId: extraPhotoLineId(line.id, mediaType),
      sourceRefId: line.currentPackage.id,
    },
    orderPackageId: line.id,
    mediaType,
  };
}

export function mapPOSSessionConfigurationLines(
  line: POSPackageLine
): CompositionSessionConfigurationLine[] {
  return line.sessionConfigurationSummary.flatMap((selection) => {
    if (selection.priceDelta === 0) return [];
    return [
      {
        id: `session-config:${selection.configurationId}`,
        label: selection.label,
        quantity: 1,
        unitAmount: roundMoney(selection.priceDelta),
        totalAmount: roundMoney(selection.priceDelta),
        metadata: {
          displayKind: "sessionConfiguration",
          sourceKind: "sessionConfiguration",
          orderPackageId: line.id,
          configurationId: selection.configurationId,
          categoryLabel: "Session configuration",
          sourceLineId: selection.configurationId,
          sourceRefId: selection.configurationId,
        },
        orderPackageId: line.id,
        configurationId: selection.configurationId,
        optionLabel: selection.optionLabel,
        numericValue: selection.numericValue,
        textValue: selection.textValue,
      },
    ];
  });
}

export function mapPOSAddOn(addOn: POSAddOn): CompositionLine {
  const quantity = addOn.quantity ?? 1;
  return {
    id: `addon:${addOn.id}`,
    label: addOn.name,
    quantity,
    unitAmount: roundMoney(addOn.price),
    totalAmount: roundMoney(addOn.price * quantity),
    metadata: {
      displayKind: "addOn",
      sourceKind: "orderAddOn",
      productId: addOn.productId,
      orderAddOnId: addOn.addOnRowId,
      categoryLabel: "Add-on",
      sourceLineId: addOn.addOnRowId,
      sourceRefId: addOn.productId,
    },
  };
}

function extraPhotoLineId(orderPackageId: string, mediaType: MediaType): string {
  return `extra-photo:${orderPackageId}:${mediaType.toLowerCase()}`;
}

export function roundMoney(value: number): number {
  return Number(value.toFixed(3));
}

function formatEnum(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
