import type { MediaType } from "@prisma/client";

export interface ExtraPhotoPricingRow {
  id: string;
  sessionTypeId: string;
  sessionTypeName: string;
  sessionTypeCode: string;
  departmentName: string;
  departmentCode: string;
  mediaType: MediaType;
  mediaTypeLabel: string;
  unitPrice: string;
  unitPriceValue: number;
}
