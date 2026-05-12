import { MediaType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import type { ExtraPhotoPricingRow } from "./pricing.types";

export const MEDIA_TYPE_LABELS: Record<MediaType, string> = {
  DIGITAL: "Digital",
  PRINT: "Print",
};

export class ExtraPhotoPricingNotFoundError extends Error {
  constructor(sessionTypeId: string, mediaType: MediaType) {
    super(
      `Extra-photo unit price is missing for session type "${sessionTypeId}" and media type "${mediaType}".`
    );
    this.name = "ExtraPhotoPricingNotFoundError";
  }
}

export async function getExtraPhotoUnitPrice(
  sessionTypeId: string,
  mediaType: MediaType
): Promise<Prisma.Decimal> {
  const row = await withRetry(
    () =>
      db.sessionTypeExtraPhotoPricing.findUnique({
        where: {
          sessionTypeId_mediaType: {
            sessionTypeId,
            mediaType,
          },
        },
        select: { unitPrice: true },
      }),
    "Failed to fetch extra-photo unit price"
  );

  if (!row) {
    throw new ExtraPhotoPricingNotFoundError(sessionTypeId, mediaType);
  }

  return row.unitPrice;
}

export async function getExtraPhotoPricingCatalog(): Promise<ExtraPhotoPricingRow[]> {
  const rows = await withRetry(
    () =>
      db.sessionTypeExtraPhotoPricing.findMany({
        include: {
          sessionType: {
            include: { department: true },
          },
        },
        orderBy: [
          { sessionType: { department: { sortOrder: "asc" } } },
          { sessionType: { sortOrder: "asc" } },
          { mediaType: "asc" },
        ],
      }),
    "Failed to fetch extra-photo pricing catalog"
  );

  return rows.map((row) => ({
    id: row.id,
    sessionTypeId: row.sessionTypeId,
    sessionTypeName: row.sessionType.name,
    sessionTypeCode: row.sessionType.code,
    departmentName: row.sessionType.department.name,
    departmentCode: row.sessionType.department.code,
    mediaType: row.mediaType,
    mediaTypeLabel: MEDIA_TYPE_LABELS[row.mediaType],
    unitPrice: formatPrice(row.unitPrice),
    unitPriceValue: row.unitPrice.toNumber(),
  }));
}

function formatPrice(value: { toFixed(dp: number): string }): string {
  return value.toFixed(3) + " KD";
}
