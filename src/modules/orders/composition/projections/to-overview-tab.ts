import type { OrderCompositionViewModel } from "../order-composition.types";
import {
  toDraftPOSComposition,
  type POSCompositionAddOnProjection,
  type POSCompositionPackageLineProjection,
  type POSCompositionSessionConfigurationProjection,
  type POSCompositionTotalsProjection,
} from "./to-draft-pos-composition";

export type OverviewCompositionSummaryProjection = {
  packageCount: number;
  includedPhotoCount: number;
  selectedPhotoCount: number;
  extraPhotoCount: number;
  selectedPhotosLabel: string;
};

export type OverviewCompositionProjection = {
  orderId: string;
  jobNumber: string;
  summary: OverviewCompositionSummaryProjection;
  packageLines: Array<
    Pick<
      POSCompositionPackageLineProjection,
      | "orderPackageId"
      | "packageId"
      | "packageName"
      | "sessionTypeName"
      | "includedPhotoCount"
      | "selectedPhotoCount"
      | "extraPhotoCount"
      | "packageItems"
    >
  >;
  addOns: POSCompositionAddOnProjection[];
  sessionConfigurations: POSCompositionSessionConfigurationProjection[];
  totals: POSCompositionTotalsProjection;
};

export function toOverviewTab(
  model: OrderCompositionViewModel
): OverviewCompositionProjection {
  const projection = toDraftPOSComposition(model);
  const includedPhotoCount = projection.packageLines.reduce(
    (sum, line) => sum + line.includedPhotoCount,
    0
  );
  const selectedPhotoCount = projection.packageLines.reduce(
    (sum, line) => sum + line.selectedPhotoCount,
    0
  );
  const extraPhotoCount = projection.packageLines.reduce(
    (sum, line) => sum + line.extraPhotoCount,
    0
  );
  return {
    orderId: projection.orderId,
    jobNumber: projection.jobNumber,
    summary: {
      packageCount: projection.packageLines.length,
      includedPhotoCount,
      selectedPhotoCount,
      extraPhotoCount,
      selectedPhotosLabel:
        extraPhotoCount > 0
          ? `${selectedPhotoCount} (${extraPhotoCount} extra)`
          : String(selectedPhotoCount),
    },
    packageLines: projection.packageLines.map((line) => ({
      orderPackageId: line.orderPackageId,
      packageId: line.packageId,
      packageName: line.packageName,
      sessionTypeName: line.sessionTypeName,
      includedPhotoCount: line.includedPhotoCount,
      selectedPhotoCount: line.selectedPhotoCount,
      extraPhotoCount: line.extraPhotoCount,
      packageItems: line.packageItems,
    })),
    addOns: projection.addOns,
    sessionConfigurations: projection.sessionConfigurations,
    totals: projection.totals,
  };
}
