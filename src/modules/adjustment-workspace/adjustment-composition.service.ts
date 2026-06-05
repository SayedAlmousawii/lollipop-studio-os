import { MediaType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { roundMoney } from "@/modules/orders/composition/order-composition.service";
import type { POSWorkspace } from "@/modules/orders/order.types";
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
} from "@/modules/orders/composition/order-composition.types";
import type {
  AdjustmentBaseSnapshot,
  AdjustmentCompositionLine,
  AdjustmentSessionConfigurationSelection,
  AdjustmentWorkspaceEdit,
} from "./adjustment-workspace.types";

type AdjustmentSnapshotOptions = {
  baseSnapshot?: AdjustmentBaseSnapshot;
  currentSnapshot?: AdjustmentBaseSnapshot;
  edits?: AdjustmentWorkspaceEdit[];
  adjustmentLines?: AdjustmentCompositionLine[];
  metadataContext?: CompositionMetadataContext;
};

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
    .map((line) => toCompositionPackageLine(line, options));
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
    ...(line.kind === "package"
      ? packagePhotoMetadataForAdjustmentLine(line)
      : {}),
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

export async function loadMetadataContextForEdits(
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
      select: { id: true, name: true, photoCount: true },
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

function toCompositionPackageLine(
  line: CompositionLine,
  options: AdjustmentSnapshotOptions = {}
): CompositionPackageLine {
  const packagePhotoCount =
    options.metadataContext?.packages?.get(line.metadata.packageId ?? "")?.photoCount ??
    options.metadataContext?.packages?.get(String(line.metadata.sourceRefId ?? ""))
      ?.photoCount;
  const includedPhotoCount =
    line.metadata.includedPhotoCount ?? packagePhotoCount ?? 0;
  const selectedPhotoCount =
    line.metadata.selectedPhotoCount ?? includedPhotoCount;

  return {
    ...line,
    orderPackageId: line.metadata.orderPackageId ?? line.id,
    packageId: line.metadata.packageId ?? String(line.metadata.sourceRefId ?? line.id),
    sessionTypeId: line.metadata.sessionTypeId,
    sessionTypeName: line.metadata.sessionTypeName,
    includedPhotoCount,
    selectedPhotoCount,
    extraDigitalCount: 0,
    extraPrintCount: 0,
    extraPhotoCount: 0,
    extraDigitalUnitPrice: 0,
    extraPrintUnitPrice: 0,
    upgradeDelta: 0,
    packageItems: [],
  };
}

export function applyPOSPhotoUnitPrices(
  snapshot: CompositionSnapshot,
  workspace: POSWorkspace | null
): CompositionSnapshot {
  if (!workspace) return snapshot;
  const lineByOrderPackageId = new Map(
    workspace.packageLines.map((line) => [line.id, line])
  );

  return {
    ...snapshot,
    packageLines: snapshot.packageLines.map((line) => {
      const source = lineByOrderPackageId.get(line.orderPackageId);
      const extraPhotos = snapshot.extraPhotos.filter(
        (extraPhoto) => extraPhoto.orderPackageId === line.orderPackageId
      );
      const extraDigitalCount = extraPhotos
        .filter((extraPhoto) => extraPhoto.mediaType === MediaType.DIGITAL)
        .reduce((sum, extraPhoto) => sum + extraPhoto.quantity, 0);
      const extraPrintCount = extraPhotos
        .filter((extraPhoto) => extraPhoto.mediaType === MediaType.PRINT)
        .reduce((sum, extraPhoto) => sum + extraPhoto.quantity, 0);
      const extraPhotoCount = extraDigitalCount + extraPrintCount;
      const includedPhotoCount =
        line.includedPhotoCount > 0
          ? line.includedPhotoCount
          : source?.includedPhotoCount ?? 0;
      const selectedPhotoCount =
        extraPhotoCount > 0
          ? includedPhotoCount + extraPhotoCount
          : line.selectedPhotoCount > 0
            ? line.selectedPhotoCount
            : source?.selectedPhotoCount ?? includedPhotoCount;
      if (!source) {
        return {
          ...line,
          includedPhotoCount,
          selectedPhotoCount,
          extraDigitalCount,
          extraPrintCount,
          extraPhotoCount,
        };
      }
      return {
        ...line,
        sessionTypeId: line.sessionTypeId ?? source.sessionTypeId,
        sessionTypeName: line.sessionTypeName ?? source.sessionTypeName,
        includedPhotoCount,
        selectedPhotoCount,
        extraDigitalCount,
        extraPrintCount,
        extraPhotoCount,
        extraDigitalUnitPrice: source.extraDigitalUnitPrice,
        extraPrintUnitPrice: source.extraPrintUnitPrice,
      };
    }),
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

function packagePhotoMetadataForAdjustmentLine(
  line: AdjustmentCompositionLine
): Partial<CompositionDisplayMetadata> {
  const metadata = line.refMetadata;
  return {
    ...(typeof metadata?.includedPhotoCount === "number"
      ? { includedPhotoCount: metadata.includedPhotoCount }
      : {}),
    ...(typeof metadata?.selectedPhotoCount === "number"
      ? { selectedPhotoCount: metadata.selectedPhotoCount }
      : {}),
    ...(metadata?.sessionTypeId ? { sessionTypeId: metadata.sessionTypeId } : {}),
    ...(metadata?.sessionTypeName ? { sessionTypeName: metadata.sessionTypeName } : {}),
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
  return selectedPhotoCountFromMetadata(packageLine);
}

function selectedPhotoCountFromMetadata(
  line: AdjustmentCompositionLine | undefined
): string | undefined {
  const metadata = line?.refMetadata as Record<string, unknown> | undefined;
  const selectedPhotoCount = metadata?.selectedPhotoCount;
  if (typeof selectedPhotoCount === "number") return String(selectedPhotoCount);
  if (typeof selectedPhotoCount === "string" && selectedPhotoCount.trim()) {
    return selectedPhotoCount;
  }
  return undefined;
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
  return line.lineId.startsWith("extra-photo:");
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
