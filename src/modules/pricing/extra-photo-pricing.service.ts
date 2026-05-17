import { MediaType, Prisma } from "@prisma/client";
import type { CurrentAppUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  PERMISSIONS,
  requireCurrentAppUserPermission,
  requirePermission,
} from "@/lib/permissions";
import { withRetry } from "@/lib/retry";
import {
  updateExtraPhotoPricingSchema,
  type UpdateExtraPhotoPricingInput,
} from "./extra-photo-pricing.schema";
import type { ExtraPhotoPricingRow } from "./pricing.types";

type ExtraPhotoPricingClient = typeof db | Prisma.TransactionClient;
type ExtraPhotoPricingActor = Pick<CurrentAppUser, "id" | "role">;

const EXTRA_PHOTO_MEDIA_TYPES = [MediaType.DIGITAL, MediaType.PRINT] as const;

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
  return withRetry(
    () => getExtraPhotoUnitPriceWithClient(db, sessionTypeId, mediaType),
    "Failed to fetch extra-photo unit price",
    3,
    (error) => !(error instanceof ExtraPhotoPricingNotFoundError)
  );
}

export async function getExtraPhotoUnitPriceWithClient(
  client: ExtraPhotoPricingClient,
  sessionTypeId: string,
  mediaType: MediaType
): Promise<Prisma.Decimal> {
  const row = await client.sessionTypeExtraPhotoPricing.findUnique({
    where: {
      sessionTypeId_mediaType: {
        sessionTypeId,
        mediaType,
      },
    },
    select: { unitPrice: true },
  });
  if (!row) {
    throw new ExtraPhotoPricingNotFoundError(sessionTypeId, mediaType);
  }

  return row.unitPrice;
}

export async function listExtraPhotoPricing(): Promise<ExtraPhotoPricingRow[]> {
  const rows = await withRetry(
    () =>
      db.sessionType.findMany({
        where: { isActive: true },
        include: {
          department: true,
          extraPhotoPricing: {
            where: { mediaType: { in: [...EXTRA_PHOTO_MEDIA_TYPES] } },
            select: { mediaType: true, unitPrice: true },
          },
        },
        orderBy: [
          { department: { sortOrder: "asc" } },
          { department: { name: "asc" } },
          { sortOrder: "asc" },
          { name: "asc" },
        ],
      }),
    "Failed to fetch extra-photo pricing catalog"
  );

  return rows.map((row) => {
    const prices = priceMapForSessionType(row.id, row.extraPhotoPricing);
    const digitalUnitPrice = prices.get(MediaType.DIGITAL);
    const printUnitPrice = prices.get(MediaType.PRINT);
    if (!digitalUnitPrice) {
      throw new ExtraPhotoPricingNotFoundError(row.id, MediaType.DIGITAL);
    }
    if (!printUnitPrice) {
      throw new ExtraPhotoPricingNotFoundError(row.id, MediaType.PRINT);
    }

    return {
      sessionTypeId: row.id,
      sessionTypeName: row.name,
      sessionTypeCode: row.code,
      departmentName: row.department.name,
      departmentCode: row.department.code,
      digitalUnitPrice: formatPrice(digitalUnitPrice),
      digitalUnitPriceValue: digitalUnitPrice.toNumber(),
      printUnitPrice: formatPrice(printUnitPrice),
      printUnitPriceValue: printUnitPrice.toNumber(),
    };
  });
}

export async function updateExtraPhotoPricing(
  sessionTypeId: string,
  input: UpdateExtraPhotoPricingInput,
  actor?: ExtraPhotoPricingActor
): Promise<{ sessionTypeId: string }> {
  await assertCanManageExtraPhotoPricing(actor);
  const data = updateExtraPhotoPricingSchema.parse(input);

  return db.$transaction(async (tx) => {
    const existingRows = await tx.sessionTypeExtraPhotoPricing.findMany({
      where: {
        sessionTypeId,
        mediaType: { in: [...EXTRA_PHOTO_MEDIA_TYPES] },
      },
      select: { mediaType: true },
    });
    const existingMediaTypes = new Set(existingRows.map((row) => row.mediaType));
    for (const mediaType of EXTRA_PHOTO_MEDIA_TYPES) {
      if (!existingMediaTypes.has(mediaType)) {
        throw new ExtraPhotoPricingNotFoundError(sessionTypeId, mediaType);
      }
    }

    await tx.sessionTypeExtraPhotoPricing.update({
      where: {
        sessionTypeId_mediaType: {
          sessionTypeId,
          mediaType: MediaType.DIGITAL,
        },
      },
      data: { unitPrice: data.digitalUnitPrice },
      select: { id: true },
    });
    await tx.sessionTypeExtraPhotoPricing.update({
      where: {
        sessionTypeId_mediaType: {
          sessionTypeId,
          mediaType: MediaType.PRINT,
        },
      },
      data: { unitPrice: data.printUnitPrice },
      select: { id: true },
    });

    return { sessionTypeId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function assertCanManageExtraPhotoPricing(
  actor?: ExtraPhotoPricingActor
): Promise<void> {
  if (actor) {
    requirePermission(actor, PERMISSIONS.PACKAGE_CATALOG_MANAGE);
    return;
  }

  await requireCurrentAppUserPermission(PERMISSIONS.PACKAGE_CATALOG_MANAGE);
}

function priceMapForSessionType(
  sessionTypeId: string,
  rows: Array<{ mediaType: MediaType; unitPrice: Prisma.Decimal }>
): Map<MediaType, Prisma.Decimal> {
  const prices = new Map<MediaType, Prisma.Decimal>();
  for (const row of rows) {
    if (prices.has(row.mediaType)) {
      throw new ExtraPhotoPricingNotFoundError(sessionTypeId, row.mediaType);
    }
    prices.set(row.mediaType, row.unitPrice);
  }
  return prices;
}

function formatPrice(value: Prisma.Decimal): string {
  return value.toFixed(3) + " KD";
}
