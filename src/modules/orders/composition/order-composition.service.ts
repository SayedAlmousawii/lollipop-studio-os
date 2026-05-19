import {
  AdjustmentWorkspaceStatus,
  InvoiceType,
  MediaType,
  Prisma,
} from "@prisma/client";
import { db } from "@/lib/db";
import {
  getAdjustmentWorkspaceView,
  getEffectiveCompositionForInvoice,
} from "@/modules/adjustment-workspace/adjustment-workspace.service";
import type {
  AdjustmentBaseSnapshot,
  AdjustmentCompositionLine,
  AdjustmentSessionConfigurationSelection,
  AdjustmentWorkspaceEdit,
} from "@/modules/adjustment-workspace/adjustment-workspace.types";
import { getPOSWorkspace } from "@/modules/orders/order.service";
import type {
  POSAddOn,
  POSPackageItem,
  POSPackageLine,
  POSWorkspace,
} from "@/modules/orders/order.types";
import type {
  CompositionDisplayKind,
  CompositionDisplayMetadata,
  CompositionExtraPhotoLine,
  CompositionLine,
  CompositionMetadataContext,
  CompositionPackageLine,
  CompositionSessionConfigurationLine,
  CompositionSnapshot,
  CompositionSourceKind,
  CompositionTotals,
  OrderCompositionViewModel,
} from "./order-composition.types";

type AdjustmentSnapshotOptions = {
  baseSnapshot?: AdjustmentBaseSnapshot;
  currentSnapshot?: AdjustmentBaseSnapshot;
  edits?: AdjustmentWorkspaceEdit[];
  adjustmentLines?: AdjustmentCompositionLine[];
  metadataContext?: CompositionMetadataContext;
};

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

  const snapshot = await getEffectiveCompositionForInvoice(input.invoiceId);
  const effectiveComposition = buildCompositionSnapshotFromAdjustmentSnapshot(snapshot);
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

export async function getPendingAdjustmentOrderCompositionViewModel(
  workspaceId: string
): Promise<OrderCompositionViewModel | null> {
  const workspace = await getAdjustmentWorkspaceView(workspaceId);
  if (!workspace) return null;
  const metadataContext = await loadMetadataContextForEdits(workspace.pendingChanges.edits);
  const baseComposition = buildCompositionSnapshotFromAdjustmentSnapshot(
    workspace.baseSnapshot,
    { metadataContext }
  );
  const pendingAdjustmentComposition = buildCompositionSnapshotFromAdjustmentSnapshot(
    workspace.proposal.proposed,
    {
      baseSnapshot: workspace.baseSnapshot,
      edits: workspace.pendingChanges.edits,
      adjustmentLines: workspace.proposal.deltas,
      metadataContext,
    }
  );

  return {
    orderId: workspace.orderId,
    jobNumber: workspace.jobNumber,
    state: "adjustment",
    baseComposition,
    effectiveComposition: baseComposition,
    pendingAdjustmentComposition,
    totals: pendingAdjustmentComposition.totals,
  };
}

export async function getOrderCompositionViewModel(input: {
  orderId?: string;
  invoiceId?: string;
  workspaceId?: string;
}): Promise<OrderCompositionViewModel | null> {
  if (input.workspaceId) {
    return getPendingAdjustmentOrderCompositionViewModel(input.workspaceId);
  }
  if (input.invoiceId) {
    return getLockedOrderCompositionViewModel({ invoiceId: input.invoiceId });
  }
  if (!input.orderId) {
    throw new Error("Order composition requires an order, invoice, or workspace id");
  }

  const openWorkspace = await db.adjustmentWorkspace.findFirst({
    where: { orderId: input.orderId, status: AdjustmentWorkspaceStatus.OPEN },
    select: { id: true },
  });
  if (openWorkspace) {
    return getPendingAdjustmentOrderCompositionViewModel(openWorkspace.id);
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

export function buildCompositionSnapshotFromAdjustmentSnapshot(
  snapshot: AdjustmentBaseSnapshot,
  options: AdjustmentSnapshotOptions = {}
): CompositionSnapshot {
  const snapshotOptions = { ...options, currentSnapshot: snapshot };
  const lines = snapshot.lines.map((line) =>
    mapAdjustmentCompositionLine(line, snapshotOptions)
  );
  const adjustmentLines = (options.adjustmentLines ?? []).map((line) =>
    mapAdjustmentCompositionLine(line, {
      ...snapshotOptions,
      adjustmentLines: undefined,
    })
  );
  const packageLines = lines
    .filter((line) => line.metadata.displayKind === "package")
    .map(toCompositionPackageLine);
  const deliverables = lines.filter(
    (line) => line.metadata.sourceKind === "packageItem"
  );
  const addOns = lines.filter((line) => line.metadata.displayKind === "addOn");
  const extraPhotos = lines
    .filter((line) => line.metadata.displayKind === "extraPhotos")
    .map(toCompositionExtraPhotoLine);
  const sessionConfigurations = lines
    .filter((line) => line.metadata.displayKind === "sessionConfiguration")
    .map(toCompositionSessionConfigurationLine);

  return {
    capturedAt: snapshot.capturedAt,
    packageLines,
    deliverables,
    addOns,
    extraPhotos,
    sessionConfigurations,
    adjustmentLines,
    lines: [...lines, ...adjustmentLines],
    totals: adjustmentTotals(snapshot, lines),
  };
}

function mapPOSPackageLine(line: POSPackageLine): CompositionPackageLine {
  const packageItems = line.packageItems.map((item) =>
    mapPOSPackageItem(item, line.id)
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
    sessionTypeId: line.sessionTypeId,
    sessionTypeName: line.sessionTypeName,
    includedPhotoCount: line.includedPhotoCount,
    selectedPhotoCount: line.selectedPhotoCount,
    extraDigitalCount: line.extraDigitalCount,
    extraPrintCount: line.extraPrintCount,
    extraPhotoCount: line.extraPhotoCount,
    upgradeDelta: roundMoney(line.upgradeDelta),
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

function mapPOSExtraPhotoLines(line: POSPackageLine): CompositionExtraPhotoLine[] {
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

function mapPOSSessionConfigurationLines(
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

function mapPOSAddOn(addOn: POSAddOn): CompositionLine {
  return {
    id: `addon:${addOn.id}`,
    label: addOn.name,
    quantity: 1,
    unitAmount: roundMoney(addOn.price),
    totalAmount: roundMoney(addOn.price),
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

function mapAdjustmentCompositionLine(
  line: AdjustmentCompositionLine,
  options: AdjustmentSnapshotOptions
): CompositionLine {
  const metadata = metadataForAdjustmentLine(line, options);
  return {
    id: line.lineId,
    label: line.label,
    quantity: line.quantity,
    unitAmount: money(line.unitPrice),
    totalAmount: money(line.lineTotalNet),
    metadata,
  };
}

function metadataForAdjustmentLine(
  line: AdjustmentCompositionLine,
  options: AdjustmentSnapshotOptions
): CompositionDisplayMetadata {
  const editMetadata = metadataFromEdits(line, options);
  if (editMetadata) return editMetadata;

  const orderPackageId = orderPackageIdFromLineId(line.lineId);
  const packageItemId = packageItemIdFromLineId(line.lineId);
  const configurationId = configurationIdFromLine(line, options.baseSnapshot);
  const sourceKind = sourceKindForAdjustmentLine(line);
  return {
    displayKind: displayKindForAdjustmentLine(line),
    sourceKind,
    ...(orderPackageId ? { orderPackageId } : {}),
    ...(packageItemId ? { packageItemId } : {}),
    ...(configurationId ? { configurationId } : {}),
    ...(line.refMetadata?.orderAddOnId
      ? { orderAddOnId: line.refMetadata.orderAddOnId }
      : {}),
    ...(line.kind === "package" ? { packageId: line.refId } : {}),
    ...(line.kind === "addon" ? { productId: line.refId } : {}),
    ...(sourceKind === "extraPhoto" ? { mediaType: mediaTypeFromLineId(line.lineId) } : {}),
    adjustmentLineId: line.lineId,
    sourceLineId: line.lineId,
    sourceRefId: line.refId,
  };
}

function metadataFromEdits(
  line: AdjustmentCompositionLine,
  options: AdjustmentSnapshotOptions
): CompositionDisplayMetadata | null {
  for (const edit of options.edits ?? []) {
    const metadata = metadataForEditLine(line, edit, options);
    if (metadata) return metadata;
  }
  return null;
}

function metadataForEditLine(
  line: AdjustmentCompositionLine,
  edit: AdjustmentWorkspaceEdit,
  options: AdjustmentSnapshotOptions
): CompositionDisplayMetadata | null {
  if (edit.op === "add_line" && matchesAddedLine(line, edit)) {
    return withAdjustmentDefaults(line, {
      displayKind: edit.kind === "addon" ? "addOn" : "line",
      sourceKind: edit.kind === "addon" ? "orderAddOn" : "packageItem",
      productId: edit.refId,
      toLabel: productLabel(edit.refId, options) ?? line.label,
      categoryLabel: edit.kind === "addon" ? "Add-on" : "Line",
      adjustmentEditId: edit.id,
    });
  }

  if (edit.op === "remove_line") {
    const baseLine = findLine(options.baseSnapshot?.lines, edit.targetLineId);
    if (baseLine && matchesAdjustmentSource(line, baseLine)) {
      return withAdjustmentDefaults(line, {
        displayKind: displayKindForAdjustmentLine(baseLine),
        sourceKind: sourceKindForAdjustmentLine(baseLine),
        fromLabel: baseLine.label,
        categoryLabel: categoryLabelForLine(baseLine),
        adjustmentEditId: edit.id,
      });
    }
  }

  if (edit.op === "modify_quantity") {
    const baseLine = findLine(options.baseSnapshot?.lines, edit.targetLineId);
    if (baseLine && matchesAdjustmentSource(line, baseLine)) {
      return withAdjustmentDefaults(line, {
        displayKind: displayKindForAdjustmentLine(baseLine),
        sourceKind: sourceKindForAdjustmentLine(baseLine),
        fromLabel: String(baseLine.quantity),
        toLabel: String(edit.newQuantity),
        categoryLabel: categoryLabelForLine(baseLine),
        adjustmentEditId: edit.id,
      });
    }
  }

  if (edit.op === "swap_package") {
    if (
      line.kind === "package" &&
      (line.refId === edit.fromPackageRefId || line.refId === edit.toPackageRefId)
    ) {
      return withAdjustmentDefaults(line, {
        displayKind: "swap",
        sourceKind: "adjustmentDelta",
        fromLabel: packageLabel(edit.fromPackageRefId, options) ?? line.label,
        toLabel: packageLabel(edit.toPackageRefId, options) ?? line.label,
        categoryLabel: "Package",
        packageId: line.refId,
        adjustmentEditId: edit.id,
      });
    }
  }

  if (edit.op === "swap_addon") {
    const baseLine = findLine(options.baseSnapshot?.lines, edit.targetLineId);
    if (
      baseLine &&
      line.kind === "addon" &&
      (matchesAdjustmentSource(line, baseLine) || line.refId === edit.toAddonRefId)
    ) {
      return withAdjustmentDefaults(line, {
        displayKind: "swap",
        sourceKind: "adjustmentDelta",
        fromLabel: baseLine.label,
        toLabel: productLabel(edit.toAddonRefId, options) ?? line.label,
        categoryLabel: "Add-on",
        productId: line.refId,
        adjustmentEditId: edit.id,
      });
    }
  }

  if (edit.op === "upgrade_package_item") {
    const lineId = packageItemUpgradeLineId(edit.orderPackageId, edit.packageItemId);
    if (line.lineId === lineId || line.refId === edit.toProductId) {
      const packageItem = options.metadataContext?.packageItems?.get(
        edit.packageItemId
      );
      return withAdjustmentDefaults(line, {
        displayKind: "upgrade",
        sourceKind: "adjustmentDelta",
        fromLabel: packageItem?.productName ?? edit.packageItemId,
        toLabel: productLabel(edit.toProductId, options) ?? line.label,
        categoryLabel: packageItem?.categoryLabel ?? "Package item",
        orderPackageId: edit.orderPackageId,
        packageItemId: edit.packageItemId,
        productId: edit.toProductId,
        adjustmentEditId: edit.id,
      });
    }
  }

  if (edit.op === "change_selected_photo_count") {
    if (line.lineId.includes(`extra-photo:${edit.orderPackageId}:`)) {
      return withAdjustmentDefaults(line, {
        displayKind: "extraPhotos",
        sourceKind: "extraPhoto",
        fromLabel: selectedPhotoCountFromBase(options.baseSnapshot, edit.orderPackageId),
        toLabel: String(edit.selectedPhotoCount),
        categoryLabel: "Selected photos",
        orderPackageId: edit.orderPackageId,
        mediaType: mediaTypeFromLineId(line.lineId),
        adjustmentEditId: edit.id,
      });
    }
  }

  if (edit.op === "change_package_tier") {
    const lineMatches =
      line.lineId === `package:${edit.orderPackageId}` ||
      line.refId === edit.toPackageRefId ||
      line.refId === basePackageRef(options.baseSnapshot, edit.orderPackageId);
    if (line.kind === "package" && lineMatches) {
      const fromPackageId = basePackageRef(options.baseSnapshot, edit.orderPackageId);
      return withAdjustmentDefaults(line, {
        displayKind: "swap",
        sourceKind: "adjustmentDelta",
        fromLabel:
          (fromPackageId ? packageLabel(fromPackageId, options) : null) ??
          basePackageLabel(options.baseSnapshot, edit.orderPackageId) ??
          line.label,
        toLabel: packageLabel(edit.toPackageRefId, options) ?? line.label,
        categoryLabel: "Package",
        orderPackageId: edit.orderPackageId,
        packageId: line.refId,
        adjustmentEditId: edit.id,
      });
    }
  }

  if (edit.op === "change_session_configuration_selection") {
    const selectionMatch = sessionConfigurationLineMatches(line, edit, options);
    if (selectionMatch) {
      return withAdjustmentDefaults(line, {
        displayKind: "sessionConfiguration",
        sourceKind: "sessionConfiguration",
        fromLabel: selectionDisplay(selectionMatch.base),
        toLabel: selectionDisplay(selectionMatch.proposed),
        categoryLabel: "Session configuration",
        orderPackageId: edit.orderPackageId,
        configurationId: edit.configurationId,
        orderAddOnId:
          selectionMatch.proposed?.orderAddOnId ??
          selectionMatch.base?.orderAddOnId ??
          line.refMetadata?.orderAddOnId,
        adjustmentEditId: edit.id,
      });
    }
  }

  return null;
}

function withAdjustmentDefaults(
  line: AdjustmentCompositionLine,
  metadata: CompositionDisplayMetadata
): CompositionDisplayMetadata {
  return {
    ...metadata,
    adjustmentLineId: line.lineId,
    sourceLineId: line.lineId,
    sourceRefId: line.refId,
  };
}

function adjustmentTotals(
  snapshot: AdjustmentBaseSnapshot,
  lines: CompositionLine[]
): CompositionTotals {
  const packageLines = lines.filter(
    (line) => line.metadata.displayKind === "package"
  );
  const deliverables = lines.filter(
    (line) => line.metadata.sourceKind === "packageItem"
  );
  const addOns = lines.filter((line) => line.metadata.displayKind === "addOn");
  const extraPhotos = lines.filter(
    (line) => line.metadata.displayKind === "extraPhotos"
  );
  const sessionConfigurations = lines.filter(
    (line) => line.metadata.displayKind === "sessionConfiguration"
  );

  return {
    packageBaseTotal: sumLineTotals(packageLines),
    packageUpgradeDeltaTotal: 0,
    deliverablesTotal: sumLineTotals(deliverables),
    addOnTotal: sumLineTotals(addOns),
    extraPhotoTotal: sumLineTotals(extraPhotos),
    sessionConfigurationTotal: sumLineTotals(sessionConfigurations),
    netCompositionTotal: money(snapshot.totals.netPayable),
  };
}

async function loadMetadataContextForEdits(
  edits: AdjustmentWorkspaceEdit[]
): Promise<CompositionMetadataContext> {
  const productIds = [
    ...new Set(
      edits.flatMap((edit) => {
        if (edit.op === "add_line") return [edit.refId];
        if (edit.op === "swap_addon") return [edit.toAddonRefId];
        if (edit.op === "upgrade_package_item") return [edit.toProductId];
        return [];
      })
    ),
  ];
  const packageIds = [
    ...new Set(
      edits.flatMap((edit) => {
        if (edit.op === "swap_package") {
          return [edit.fromPackageRefId, edit.toPackageRefId];
        }
        if (edit.op === "change_package_tier") return [edit.toPackageRefId];
        return [];
      })
    ),
  ];
  const packageItemIds = [
    ...new Set(
      edits.flatMap((edit) =>
        edit.op === "upgrade_package_item" ? [edit.packageItemId] : []
      )
    ),
  ];

  const [products, packages, packageItems] = await Promise.all([
    db.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true },
    }),
    db.package.findMany({
      where: { id: { in: packageIds } },
      select: { id: true, name: true },
    }),
    db.packageItem.findMany({
      where: { id: { in: packageItemIds } },
      select: {
        id: true,
        packageId: true,
        productId: true,
        product: { select: { name: true, category: true } },
      },
    }),
  ]);

  return {
    products: new Map(products.map((product) => [product.id, product])),
    packages: new Map(packages.map((packageRow) => [packageRow.id, packageRow])),
    packageItems: new Map(
      packageItems.map((packageItem) => [
        packageItem.id,
        {
          id: packageItem.id,
          packageId: packageItem.packageId,
          productId: packageItem.productId,
          productName: packageItem.product.name,
          categoryLabel: packageItem.product.category,
        },
      ])
    ),
  };
}

function toCompositionPackageLine(line: CompositionLine): CompositionPackageLine {
  return {
    ...line,
    orderPackageId: line.metadata.orderPackageId ?? line.id,
    packageId: line.metadata.packageId ?? String(line.metadata.sourceRefId ?? line.id),
    includedPhotoCount: 0,
    selectedPhotoCount: 0,
    extraDigitalCount: 0,
    extraPrintCount: 0,
    extraPhotoCount: 0,
    upgradeDelta: 0,
    packageItems: [],
  };
}

function toCompositionExtraPhotoLine(
  line: CompositionLine
): CompositionExtraPhotoLine {
  return {
    ...line,
    orderPackageId: line.metadata.orderPackageId ?? line.id,
    mediaType: line.metadata.mediaType ?? MediaType.DIGITAL,
  };
}

function toCompositionSessionConfigurationLine(
  line: CompositionLine
): CompositionSessionConfigurationLine {
  return {
    ...line,
    orderPackageId: line.metadata.orderPackageId,
    configurationId: line.metadata.configurationId,
  };
}

function sourceKindForAdjustmentLine(
  line: AdjustmentCompositionLine
): CompositionSourceKind {
  if (line.lineId.startsWith("adj:") || line.lineId.startsWith("delta:")) {
    return "adjustmentDelta";
  }
  if (line.kind === "package") return "orderPackage";
  if (line.kind === "addon") return "orderAddOn";
  if (line.kind === "session_configuration") return "sessionConfiguration";
  if (isExtraPhotoLine(line)) return "extraPhoto";
  return "packageItem";
}

function displayKindForAdjustmentLine(
  line: AdjustmentCompositionLine
): CompositionDisplayKind {
  if (line.kind === "package") return "package";
  if (line.kind === "addon") return "addOn";
  if (line.kind === "session_configuration") return "sessionConfiguration";
  if (isExtraPhotoLine(line)) return "extraPhotos";
  return "line";
}

function categoryLabelForLine(line: AdjustmentCompositionLine): string {
  if (line.kind === "package") return "Package";
  if (line.kind === "addon") return "Add-on";
  if (line.kind === "session_configuration") return "Session configuration";
  if (isExtraPhotoLine(line)) return "Selected photos";
  return "Line";
}

function matchesAddedLine(
  line: AdjustmentCompositionLine,
  edit: Extract<AdjustmentWorkspaceEdit, { op: "add_line" }>
): boolean {
  return line.lineId === `edit:${edit.id}` || line.refId === edit.refId;
}

function matchesAdjustmentSource(
  line: AdjustmentCompositionLine,
  source: AdjustmentCompositionLine
): boolean {
  return (
    line.lineId === source.lineId ||
    line.refId === source.refId ||
    (line.lineId.startsWith("delta:") &&
      line.kind === source.kind &&
      line.refId === source.refId)
  );
}

function findLine(
  lines: AdjustmentCompositionLine[] | undefined,
  lineId: string
): AdjustmentCompositionLine | null {
  return lines?.find((line) => line.lineId === lineId) ?? null;
}

function productLabel(
  productId: string,
  options: AdjustmentSnapshotOptions
): string | null {
  return options.metadataContext?.products?.get(productId)?.name ?? null;
}

function packageLabel(
  packageId: string,
  options: AdjustmentSnapshotOptions
): string | null {
  return options.metadataContext?.packages?.get(packageId)?.name ?? null;
}

function basePackageRef(
  snapshot: AdjustmentBaseSnapshot | undefined,
  orderPackageId: string
): string | null {
  return (
    snapshot?.lines.find((line) => line.lineId === `package:${orderPackageId}`)
      ?.refId ?? null
  );
}

function basePackageLabel(
  snapshot: AdjustmentBaseSnapshot | undefined,
  orderPackageId: string
): string | null {
  return (
    snapshot?.lines.find((line) => line.lineId === `package:${orderPackageId}`)
      ?.label ?? null
  );
}

function selectedPhotoCountFromBase(
  snapshot: AdjustmentBaseSnapshot | undefined,
  orderPackageId: string
): string | undefined {
  if (!snapshot) return undefined;
  const packageLine = snapshot.lines.find(
    (line) => line.lineId === `package:${orderPackageId}`
  );
  if (!packageLine) return undefined;
  const extraCount = snapshot.lines
    .filter((line) => line.lineId.includes(`extra-photo:${orderPackageId}:`))
    .reduce((sum, line) => sum + Math.max(line.quantity, 0), 0);
  return String(packageLine.quantity + extraCount);
}

function sessionConfigurationLineMatches(
  line: AdjustmentCompositionLine,
  edit: Extract<
    AdjustmentWorkspaceEdit,
    { op: "change_session_configuration_selection" }
  >,
  options: AdjustmentSnapshotOptions
):
  | {
      base: AdjustmentSessionConfigurationSelection | null;
      proposed: AdjustmentSessionConfigurationSelection | null;
    }
  | null {
  const base = findSelection(
    options.baseSnapshot?.sessionConfigurationSelections,
    edit
  );
  const proposedSelection =
    findSelectionByLine(options, line) ??
    findSelection(options.currentSnapshot?.sessionConfigurationSelections, edit);
  const candidate = proposedSelection ?? base;
  if (!candidate) return null;
  const ids = [
    candidate.id,
    candidate.orderAddOnId,
    candidate.snapshotLinkedProductId,
    pendingSessionConfigurationSelectionId(edit.configurationId),
    pendingSessionConfigurationAddOnId(edit.configurationId),
  ].filter((value): value is string => Boolean(value));
  const matches =
    ids.includes(line.refId) ||
    ids.includes(line.refMetadata?.orderAddOnId ?? "") ||
    line.lineId.includes(candidate.id) ||
    line.lineId.includes(edit.configurationId);
  if (!matches) return null;
  return { base, proposed: proposedSelection };
}

function findSelection(
  selections: AdjustmentSessionConfigurationSelection[] | undefined,
  edit: Extract<
    AdjustmentWorkspaceEdit,
    { op: "change_session_configuration_selection" }
  >
): AdjustmentSessionConfigurationSelection | null {
  return (
    selections?.find(
      (selection) =>
        selection.orderPackageId === edit.orderPackageId &&
        selection.configurationId === edit.configurationId
    ) ?? null
  );
}

function findSelectionByLine(
  options: AdjustmentSnapshotOptions,
  line: AdjustmentCompositionLine
): AdjustmentSessionConfigurationSelection | null {
  const snapshots = [
    options.baseSnapshot,
    options.currentSnapshot,
  ].filter((snapshot): snapshot is AdjustmentBaseSnapshot => Boolean(snapshot));
  for (const snapshot of snapshots) {
    const selection = snapshot.sessionConfigurationSelections?.find(
      (candidate) =>
        candidate.id === line.refId ||
        candidate.orderAddOnId === line.refMetadata?.orderAddOnId ||
        candidate.snapshotLinkedProductId === line.refId ||
        line.lineId.includes(candidate.id)
    );
    if (selection) return selection;
  }
  return null;
}

function selectionDisplay(
  selection: AdjustmentSessionConfigurationSelection | null
): string | undefined {
  if (!selection) return undefined;
  return (
    selection.snapshotOptionLabel ??
    selection.numericValue ??
    selection.textValue ??
    selection.snapshotLabel
  );
}

function configurationIdFromLine(
  line: AdjustmentCompositionLine,
  snapshot: AdjustmentBaseSnapshot | undefined
): string | undefined {
  if (line.kind !== "session_configuration") return undefined;
  return snapshot?.sessionConfigurationSelections?.find((selection) =>
    [selection.id, selection.orderAddOnId, selection.snapshotLinkedProductId].includes(
      line.refId
    )
  )?.configurationId;
}

function orderPackageIdFromLineId(lineId: string): string | undefined {
  if (lineId.startsWith("package:")) return lineId.slice("package:".length);
  if (lineId.startsWith("extra-photo:")) return lineId.split(":")[1];
  if (lineId.startsWith("item:")) return lineId.split(":")[1];
  return undefined;
}

function packageItemIdFromLineId(lineId: string): string | undefined {
  if (!lineId.startsWith("item:")) return undefined;
  return lineId.split(":")[2];
}

function mediaTypeFromLineId(lineId: string): MediaType | undefined {
  if (lineId.endsWith(":digital")) return MediaType.DIGITAL;
  if (lineId.endsWith(":print")) return MediaType.PRINT;
  return undefined;
}

function isExtraPhotoLine(line: AdjustmentCompositionLine): boolean {
  return (
    line.lineId.startsWith("extra-photo:") ||
    line.refId.startsWith("Extra photos - ")
  );
}

function extraPhotoLineId(orderPackageId: string, mediaType: MediaType): string {
  return `extra-photo:${orderPackageId}:${mediaType.toLowerCase()}`;
}

function packageItemUpgradeLineId(
  orderPackageId: string,
  packageItemId: string
): string {
  return `item:${orderPackageId}:${packageItemId}`;
}

function pendingSessionConfigurationSelectionId(configurationId: string): string {
  return `pending:${configurationId}`;
}

function pendingSessionConfigurationAddOnId(configurationId: string): string {
  return `pending:addon:${configurationId}`;
}

function sumLineTotals(lines: CompositionLine[]): number {
  return roundMoney(lines.reduce((sum, line) => sum + line.totalAmount, 0));
}

function money(value: string | number | Prisma.Decimal): number {
  return roundMoney(Number(value));
}

function roundMoney(value: number): number {
  return Number(value.toFixed(3));
}

function formatEnum(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
