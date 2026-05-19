import type { OrderCompositionViewModel } from "../order-composition.types";
import {
  toDraftPOSComposition,
  type POSCompositionAddOnProjection,
  type POSCompositionPackageLineProjection,
  type POSCompositionSessionConfigurationProjection,
  type POSCompositionTotalsProjection,
} from "./to-draft-pos-composition";

export type OverviewCompositionProjection = {
  orderId: string;
  jobNumber: string;
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
  return {
    orderId: projection.orderId,
    jobNumber: projection.jobNumber,
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
