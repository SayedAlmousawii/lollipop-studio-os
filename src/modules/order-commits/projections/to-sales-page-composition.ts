import type { DraftPOSCompositionProjection } from "@/modules/orders/composition/projections/to-draft-pos-composition";
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
};

export function toSalesPageComposition({
  draftSnapshot,
  currentComposition,
}: ToSalesPageCompositionInput): SalesPageComposition {
  if (!draftSnapshot) {
    return { ...currentComposition, source: "current" };
  }

  const linesByParent = groupLinesByParent(draftSnapshot.lines);
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

      return {
        id: line.lineId,
        orderPackageId: line.orderEntityId,
        packageId: line.catalogEntityId ?? metadataString(line, "packageId") ?? line.orderEntityId,
        packageName: line.label,
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
        packageItems: childLines
          .filter(
            (child) =>
              child.lineKind ===
              ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE
          )
          .map((child) => ({
            id: child.orderEntityId,
            productId: child.catalogEntityId,
            productName: child.label,
            category: metadataString(child, "categoryLabel"),
            quantity: child.quantity,
            unitAmount: child.unitPrice,
            totalAmount: child.lineTotal,
          })),
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
          ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION
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
      ...currentComposition.totals,
      netCompositionTotal: draftSnapshot.totals.netTotal,
    },
    source: "projected",
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

function roundMoney(value: number): number {
  return Number(value.toFixed(3));
}
