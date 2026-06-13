import type {
  DraftPOSCompositionProjection,
  POSCompositionPackageItemProjection,
  POSCompositionPackageLineProjection,
} from "@/modules/orders/composition/projections/to-draft-pos-composition";
import {
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
} from "../order-commit.constants";
import type {
  OrderCommitSnapshotLineV1,
  OrderCommitSnapshotV1,
} from "../order-commit.types";
import type { SalesPageComposition } from "./sales-page-view.types";

export type ToSalesPageCompositionInput = {
  draftSnapshot: OrderCommitSnapshotV1 | null;
  currentComposition: DraftPOSCompositionProjection;
  catalogPackageItemsByPackageId?: ReadonlyMap<
    string,
    POSCompositionPackageItemProjection[]
  >;
};

export function toSalesPageComposition({
  draftSnapshot,
  currentComposition,
  catalogPackageItemsByPackageId,
}: ToSalesPageCompositionInput): SalesPageComposition {
  if (!draftSnapshot) {
    return {
      ...currentComposition,
      packageLines: restoreCatalogPackageItemsForCurrentComposition(
        currentComposition.packageLines,
        catalogPackageItemsByPackageId
      ),
      source: "current",
    };
  }

  const linesByParent = groupLinesByParent(draftSnapshot.lines);
  const totals = projectedTotalsFromSnapshot(draftSnapshot);
  const packageLines = draftSnapshot.lines
    .filter((line) => line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE)
    .map((line) => {
      const childLines = linesByParent.get(line.orderEntityId) ?? [];
      const extraDigitalLine = childLines.find(
        (child) =>
          child.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.SELECTED_PHOTO_EXTRA &&
          child.metadata.mediaType === "DIGITAL"
      );
      const extraPrintLine = childLines.find(
        (child) =>
          child.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.SELECTED_PHOTO_EXTRA &&
          child.metadata.mediaType === "PRINT"
      );
      const extraPhotoTotal = sumLineTotals(
        childLines.filter(
          (child) =>
            child.lineKind ===
            ORDER_COMMIT_SNAPSHOT_LINE_KIND.SELECTED_PHOTO_EXTRA
        )
      );
      const upgradeDelta = sumLineTotals(
        childLines.filter(
          (child) =>
            child.lineKind ===
            ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE
        )
      );
      const packageScopedConfigurationTotal = sumLineTotals(
        childLines.filter(
          (child) =>
            child.lineKind ===
              ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION ||
            child.lineKind ===
              ORDER_COMMIT_SNAPSHOT_LINE_KIND
                .LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON
        )
      );
      const packageId =
        line.catalogEntityId ?? metadataString(line, "packageId") ?? line.orderEntityId;
      const originalPackagePrice = metadataNumber(
        line,
        "originalPackagePriceSnapshot"
      );
      const packageTierDelta =
        originalPackagePrice === null
          ? 0
          : roundMoney(line.lineTotal - originalPackagePrice);

      return {
        id: line.lineId,
        orderPackageId: line.orderEntityId,
        packageId,
        packageName: line.label,
        originalPackageName: metadataString(line, "originalPackageNameSnapshot"),
        packagePrice: line.lineTotal,
        sessionTypeId: metadataString(line, "sessionTypeId"),
        sessionTypeName: metadataString(line, "sessionTypeName"),
        includedPhotoCount: metadataNumber(line, "includedPhotoCount") ?? 0,
        selectedPhotoCount:
          metadataNumber(line, "selectedPhotoCount") ??
          metadataNumber(line, "includedPhotoCount") ??
          0,
        extraDigitalCount: extraDigitalLine?.quantity ?? 0,
        extraPrintCount: extraPrintLine?.quantity ?? 0,
        extraPhotoCount:
          (extraDigitalLine?.quantity ?? 0) + (extraPrintLine?.quantity ?? 0),
        extraDigitalUnitPrice: extraDigitalLine?.unitPrice ?? 0,
        extraPrintUnitPrice: extraPrintLine?.unitPrice ?? 0,
        extraPhotoTotal,
        packageSubtotal: roundMoney(
          line.lineTotal +
            upgradeDelta +
            extraPhotoTotal +
            packageScopedConfigurationTotal
        ),
        upgradeDelta,
        packageTierDelta,
        packageItemUpgradeDelta: upgradeDelta,
        packageItems: projectPackageItemsFromCatalog({
          packageId,
          packageItemUpgradeLines: childLines.filter(
            (child) =>
              child.lineKind ===
              ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE
          ),
          catalogPackageItemsByPackageId,
        }),
      };
    });

  return {
    orderId: draftSnapshot.orderId,
    jobNumber: currentComposition.jobNumber,
    sourceState: currentComposition.sourceState,
    packageLines,
    addOns: draftSnapshot.lines
      .filter((line) => line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON)
      .map((line) => ({
        id: line.lineId,
        orderAddOnId: metadataString(line, "orderAddOnId") ?? line.orderEntityId,
        orderPackageId:
          line.parentOrderPackageId ?? metadataString(line, "orderPackageId"),
        productId: line.catalogEntityId ?? metadataString(line, "productId"),
        name: line.label,
        quantity: line.quantity,
        unitAmount: line.unitPrice,
        totalAmount: line.lineTotal,
      })),
    sessionConfigurations: draftSnapshot.lines
      .filter(
        (line) =>
          line.lineKind ===
            ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION ||
          line.lineKind ===
            ORDER_COMMIT_SNAPSHOT_LINE_KIND
              .LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON
      )
      .map((line) => ({
        id: line.lineId,
        orderPackageId: line.parentOrderPackageId,
        configurationId:
          line.catalogEntityId ?? metadataString(line, "configurationId"),
        label: line.label,
        optionLabel: metadataString(line, "optionLabel"),
        numericValue: metadataString(line, "numericValue"),
        textValue: metadataString(line, "textValue"),
        priceDelta: line.lineTotal,
      })),
    totals: {
      ...totals,
    },
    source: "projected",
  };
}

function restoreCatalogPackageItemsForCurrentComposition(
  packageLines: POSCompositionPackageLineProjection[],
  catalogPackageItemsByPackageId:
    | ReadonlyMap<string, POSCompositionPackageItemProjection[]>
    | undefined
): POSCompositionPackageLineProjection[] {
  if (!catalogPackageItemsByPackageId) return packageLines;

  return packageLines.map((line) => {
    const catalogItems = catalogPackageItemsByPackageId.get(line.packageId);
    if (!catalogItems) return line;
    return {
      ...line,
      packageItems: overlayPackageItems(catalogItems, line.packageItems),
    };
  });
}

function projectPackageItemsFromCatalog(input: {
  packageId: string;
  packageItemUpgradeLines: OrderCommitSnapshotLineV1[];
  catalogPackageItemsByPackageId:
    | ReadonlyMap<string, POSCompositionPackageItemProjection[]>
    | undefined;
}): POSCompositionPackageItemProjection[] {
  const catalogItems =
    input.catalogPackageItemsByPackageId?.get(input.packageId) ?? [];
  const upgradeItems = input.packageItemUpgradeLines.map((line) =>
    packageItemFromUpgradeLine(line)
  );

  // Included deliverables are catalog-current display rows. OrderCommit
  // snapshots intentionally do not carry commit-historical included items.
  return overlayPackageItems(catalogItems, upgradeItems);
}

function overlayPackageItems(
  catalogItems: POSCompositionPackageItemProjection[],
  overlayItems: POSCompositionPackageItemProjection[]
): POSCompositionPackageItemProjection[] {
  const itemsById = new Map(
    catalogItems.map((item) => [item.id, { ...item }])
  );

  for (const overlayItem of overlayItems) {
    const baseItem = itemsById.get(overlayItem.id);
    itemsById.set(overlayItem.id, {
      id: overlayItem.id,
      productId: baseItem?.productId ?? overlayItem.productId,
      productName: overlayItem.productName,
      category: overlayItem.category ?? baseItem?.category ?? null,
      quantity: overlayItem.quantity,
      unitAmount: roundMoney(
        (baseItem?.unitAmount ?? 0) + overlayItem.unitAmount
      ),
      totalAmount: roundMoney(
        (baseItem?.totalAmount ?? 0) + overlayItem.totalAmount
      ),
    });
  }

  return [...itemsById.values()];
}

function packageItemFromUpgradeLine(
  line: OrderCommitSnapshotLineV1
): POSCompositionPackageItemProjection {
  const packageItemId =
    metadataString(line, "packageItemId") ?? line.catalogEntityId ?? line.orderEntityId;
  return {
    id: packageItemId,
    productId: metadataString(line, "productId") ?? line.catalogEntityId,
    productName: line.label,
    category: metadataString(line, "categoryLabel"),
    quantity: line.quantity,
    unitAmount: line.unitPrice,
    totalAmount: line.lineTotal,
  };
}

function projectedTotalsFromSnapshot(
  draftSnapshot: OrderCommitSnapshotV1
): SalesPageComposition["totals"] {
  return {
    packageBaseTotal: sumSnapshotLineTotals(
      draftSnapshot.lines,
      ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE
    ),
    packageUpgradeDeltaTotal: sumSnapshotLineTotals(
      draftSnapshot.lines,
      ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE
    ),
    // OrderCommit snapshots do not carry included deliverables as separate lines;
    // paid package-item upgrades are represented by PACKAGE_ITEM_UPGRADE totals.
    deliverablesTotal: 0,
    addOnTotal: sumSnapshotLineTotals(
      draftSnapshot.lines,
      ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON
    ),
    extraPhotoTotal: sumSnapshotLineTotals(
      draftSnapshot.lines,
      ORDER_COMMIT_SNAPSHOT_LINE_KIND.SELECTED_PHOTO_EXTRA
    ),
    sessionConfigurationTotal: sumSnapshotLineTotals(
      draftSnapshot.lines,
      ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION,
      ORDER_COMMIT_SNAPSHOT_LINE_KIND.LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON
    ),
    netCompositionTotal: draftSnapshot.totals.netTotal,
  };
}

function groupLinesByParent(
  lines: OrderCommitSnapshotLineV1[]
): Map<string, OrderCommitSnapshotLineV1[]> {
  const grouped = new Map<string, OrderCommitSnapshotLineV1[]>();
  for (const line of lines) {
    if (!line.parentOrderPackageId) continue;
    const group = grouped.get(line.parentOrderPackageId) ?? [];
    group.push(line);
    grouped.set(line.parentOrderPackageId, group);
  }
  return grouped;
}

function metadataString(
  line: OrderCommitSnapshotLineV1,
  key: string
): string | null {
  const value = line.metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function metadataNumber(
  line: OrderCommitSnapshotLineV1,
  key: string
): number | null {
  const value = line.metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sumLineTotals(lines: OrderCommitSnapshotLineV1[]): number {
  return roundMoney(lines.reduce((sum, line) => sum + line.lineTotal, 0));
}

function sumSnapshotLineTotals(
  lines: OrderCommitSnapshotLineV1[],
  ...lineKinds: OrderCommitSnapshotLineV1["lineKind"][]
): number {
  const includedLineKinds = new Set(lineKinds);
  return sumLineTotals(
    lines.filter((line) => includedLineKinds.has(line.lineKind))
  );
}

function roundMoney(value: number): number {
  return Number(value.toFixed(3));
}
