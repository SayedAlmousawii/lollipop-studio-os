import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import {
  ORDER_COMMIT_DRAFT_STAGING_DOMAIN,
} from "@/modules/order-commits/order-commit-draft.constants";
import { orderCommitDraftStagingChangeSchema } from "@/modules/order-commits/order-commit-draft.schema";
import type { OrderCommitDraftStagingChange } from "@/modules/order-commits/order-commit-draft.types";
import {
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
} from "@/modules/order-commits/order-commit.constants";
import type { OrderCommitSnapshotLineV1 } from "@/modules/order-commits/order-commit.types";
import {
  EXTRA_ALBUM_PAGE_PRODUCT_ID,
  ORDER_ALBUM_SOURCE_TYPE,
} from "./album.constants";
import {
  buildExtraAlbumPageAddOnStagingChangeInputSchema,
  createOrderAlbumInputSchema,
  getOrderAlbumsInputSchema,
  syncOrderAlbumsAfterCommitInputSchema,
  updateOrderAlbumFinishingInputSchema,
} from "./album.schema";
import type {
  BuildExtraAlbumPageAddOnStagingChangeInput,
  CreateOrderAlbumInput,
  GetOrderAlbumsInput,
  SyncOrderAlbumsAfterCommitInput,
  UpdateOrderAlbumFinishingInput,
} from "./album.types";

type AlbumClient = Pick<PrismaClient, "orderAlbum"> | Pick<
  Prisma.TransactionClient,
  "orderAlbum"
>;

const orderAlbumSelect = {
  id: true,
  orderId: true,
  orderPackageId: true,
  sourceType: true,
  backingLineKind: true,
  backingLineId: true,
  coverMaterial: true,
  threadColor: true,
  layout: true,
  coverText: true,
  coverImageRef: true,
  instructions: true,
  extraPages: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OrderAlbumSelect;

export type OrderAlbumRow = Prisma.OrderAlbumGetPayload<{
  select: typeof orderAlbumSelect;
}>;

type AddOnStagingChange = Extract<
  OrderCommitDraftStagingChange,
  { domain: typeof ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON }
>;

export async function getOrderAlbums(
  input: GetOrderAlbumsInput,
  client: AlbumClient = db
): Promise<OrderAlbumRow[]> {
  const parsed = getOrderAlbumsInputSchema.parse(input);
  return client.orderAlbum.findMany({
    where: { orderId: parsed.orderId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: orderAlbumSelect,
  });
}

export async function createOrderAlbum(
  input: CreateOrderAlbumInput,
  client: AlbumClient = db
): Promise<OrderAlbumRow> {
  const parsed = createOrderAlbumInputSchema.parse(input);
  const existing = await findExistingAlbum(client, parsed);
  if (existing) return existing;

  try {
    return await client.orderAlbum.create({
      data: {
        orderId: parsed.orderId,
        orderPackageId: parsed.orderPackageId ?? null,
        sourceType: parsed.sourceType,
        backingLineKind: parsed.backingLineKind,
        backingLineId: parsed.backingLineId,
      },
      select: orderAlbumSelect,
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const raced = await findExistingAlbum(client, parsed);
    if (raced) return raced;
    throw error;
  }
}

export async function updateOrderAlbumFinishing(
  input: UpdateOrderAlbumFinishingInput,
  client: AlbumClient = db
): Promise<OrderAlbumRow> {
  const parsed = updateOrderAlbumFinishingInputSchema.parse(input);
  const { id, ...finishingFields } = parsed;
  return client.orderAlbum.update({
    where: { id },
    data: finishingFields,
    select: orderAlbumSelect,
  });
}

export function buildExtraAlbumPageAddOnStagingChange(
  input: BuildExtraAlbumPageAddOnStagingChangeInput
): AddOnStagingChange | null {
  const parsed = buildExtraAlbumPageAddOnStagingChangeInputSchema.parse(input);
  const scopeOrderPackageId =
    parsed.orderAlbum.sourceType === ORDER_ALBUM_SOURCE_TYPE.PACKAGE
      ? parsed.orderAlbum.orderPackageId
      : null;
  const existingLine = findExtraAlbumPageLine(
    parsed.snapshot.lines,
    scopeOrderPackageId
  );

  if (!existingLine && parsed.requestedExtraPages === 0) return null;
  if (existingLine?.quantity === parsed.requestedExtraPages) return null;

  const parentPackageTarget = scopeOrderPackageId
    ? { orderEntityId: scopeOrderPackageId }
    : undefined;

  if (!existingLine) {
    return parseAddOnStagingChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
      action: "ADD",
      parentPackageTarget,
      productId: EXTRA_ALBUM_PAGE_PRODUCT_ID,
      quantity: parsed.requestedExtraPages,
      draftOrderAddOnId: `draft:${randomUUID()}`,
    });
  }

  const target = { orderEntityId: existingLine.orderEntityId };
  if (parsed.requestedExtraPages === 0) {
    return parseAddOnStagingChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
      action: "REMOVE",
      target,
      parentPackageTarget,
    });
  }

  return parseAddOnStagingChange({
    domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
    action: "UPDATE_QUANTITY",
    target,
    parentPackageTarget,
    quantity: parsed.requestedExtraPages,
  });
}

export async function syncOrderAlbumsAfterCommit(
  input: SyncOrderAlbumsAfterCommitInput,
  client: AlbumClient
): Promise<void> {
  const parsed = syncOrderAlbumsAfterCommitInputSchema.parse(input);
  const draftToOrderEntityMap = new Map(parsed.draftToOrderEntityEntries);
  const albums = await client.orderAlbum.findMany({
    where: { orderId: parsed.orderId },
    select: {
      id: true,
      sourceType: true,
      orderPackageId: true,
      backingLineId: true,
    },
  });

  for (const album of albums) {
    const remappedBackingLineId = album.backingLineId.startsWith("draft:")
      ? draftToOrderEntityMap.get(album.backingLineId) ?? album.backingLineId
      : album.backingLineId;
    const scopeOrderPackageId =
      album.sourceType === ORDER_ALBUM_SOURCE_TYPE.PACKAGE
        ? album.orderPackageId
        : null;
    // F1 stores extra pages at package scope only. If B5 supports two albums in
    // one package, it must add per-album attribution instead of this shared count.
    const extraPages =
      findExtraAlbumPageLine(parsed.committedSnapshot.lines, scopeOrderPackageId)
        ?.quantity ?? 0;

    await client.orderAlbum.update({
      where: { id: album.id },
      data: {
        backingLineId: remappedBackingLineId,
        extraPages,
      },
      select: { id: true },
    });
  }
}

async function findExistingAlbum(
  client: AlbumClient,
  input: CreateOrderAlbumInput
): Promise<OrderAlbumRow | null> {
  return client.orderAlbum.findFirst({
    where: {
      orderId: input.orderId,
      orderPackageId: input.orderPackageId ?? null,
      backingLineKind: input.backingLineKind,
      backingLineId: input.backingLineId,
    },
    select: orderAlbumSelect,
  });
}

function findExtraAlbumPageLine(
  lines: OrderCommitSnapshotLineV1[],
  parentOrderPackageId: string | null
): OrderCommitSnapshotLineV1 | null {
  return (
    lines.find(
      (line) =>
        line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON &&
        line.catalogEntityId === EXTRA_ALBUM_PAGE_PRODUCT_ID &&
        line.parentOrderPackageId === parentOrderPackageId
    ) ?? null
  );
}

function parseAddOnStagingChange(
  change: AddOnStagingChange
): AddOnStagingChange {
  return orderCommitDraftStagingChangeSchema.parse(change) as AddOnStagingChange;
}

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
