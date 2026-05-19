import type { MediaType } from "@prisma/client";

export type OrderCompositionState = "draft" | "locked" | "adjustment";

export type CompositionDisplayKind =
  | "package"
  | "addOn"
  | "extraPhotos"
  | "sessionConfiguration"
  | "swap"
  | "upgrade"
  | "line";

export type CompositionSourceKind =
  | "orderPackage"
  | "packageItem"
  | "orderAddOn"
  | "extraPhoto"
  | "sessionConfiguration"
  | "adjustmentDelta";

export type CompositionDisplayMetadata = {
  displayKind: CompositionDisplayKind;
  sourceKind: CompositionSourceKind;
  fromLabel?: string;
  toLabel?: string;
  categoryLabel?: string;
  orderPackageId?: string;
  productId?: string | null;
  packageId?: string;
  packageItemId?: string;
  configurationId?: string;
  orderAddOnId?: string;
  adjustmentEditId?: string;
  adjustmentLineId?: string;
  sourceLineId?: string;
  sourceRefId?: string | null;
  mediaType?: MediaType;
};

export type CompositionLine = {
  id: string;
  label: string;
  quantity: number;
  unitAmount: number;
  totalAmount: number;
  metadata: CompositionDisplayMetadata;
};

export type CompositionPackageLine = CompositionLine & {
  orderPackageId: string;
  packageId: string;
  sessionTypeId?: string;
  sessionTypeName?: string;
  includedPhotoCount: number;
  selectedPhotoCount: number;
  extraDigitalCount: number;
  extraPrintCount: number;
  extraPhotoCount: number;
  upgradeDelta: number;
  packageItems: CompositionLine[];
};

export type CompositionExtraPhotoLine = CompositionLine & {
  orderPackageId: string;
  mediaType: MediaType;
};

export type CompositionSessionConfigurationLine = CompositionLine & {
  orderPackageId?: string;
  configurationId?: string;
  optionLabel?: string | null;
  numericValue?: string | null;
  textValue?: string | null;
};

export type CompositionTotals = {
  packageBaseTotal: number;
  packageUpgradeDeltaTotal: number;
  deliverablesTotal: number;
  addOnTotal: number;
  extraPhotoTotal: number;
  sessionConfigurationTotal: number;
  netCompositionTotal: number;
};

export type CompositionSnapshot = {
  capturedAt: string | null;
  packageLines: CompositionPackageLine[];
  deliverables: CompositionLine[];
  addOns: CompositionLine[];
  extraPhotos: CompositionExtraPhotoLine[];
  sessionConfigurations: CompositionSessionConfigurationLine[];
  adjustmentLines: CompositionLine[];
  lines: CompositionLine[];
  totals: CompositionTotals;
};

export type OrderCompositionViewModel = {
  orderId: string;
  jobNumber: string;
  state: OrderCompositionState;
  baseComposition: CompositionSnapshot | null;
  effectiveComposition: CompositionSnapshot;
  pendingAdjustmentComposition: CompositionSnapshot | null;
  totals: CompositionTotals;
};

export type CompositionMetadataContext = {
  products?: Map<string, { id: string; name: string }>;
  packages?: Map<string, { id: string; name: string }>;
  packageItems?: Map<
    string,
    {
      id: string;
      packageId?: string;
      productId?: string;
      productName: string;
      categoryLabel?: string;
    }
  >;
};
