import { randomUUID } from "node:crypto";
import { Prisma, ProductCategory, type PrismaClient } from "@prisma/client";
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
  ORDER_ALBUM_BACKING_LINE_KIND,
  ORDER_ALBUM_SOURCE_TYPE,
} from "./album.constants";
import {
  buildExtraAlbumPageAddOnStagingChangeInputSchema,
  createOrderAlbumInputSchema,
  getOrderAlbumsInputSchema,
  rebindOrderAlbumBackingInputSchema,
  syncOrderAlbumsAfterCommitInputSchema,
  updateOrderAlbumFinishingInputSchema,
} from "./album.schema";
import type {
  BuildExtraAlbumPageAddOnStagingChangeInput,
  CreateOrderAlbumInput,
  GetOrderAlbumsInput,
  RebindOrderAlbumBackingInput,
  SyncOrderAlbumsAfterCommitInput,
  UpdateOrderAlbumFinishingInput,
} from "./album.types";

type AlbumClient =
  | Pick<
      PrismaClient,
      "orderAlbum" | "orderPackage" | "orderPackageItemUpgrade" | "orderAddOn"
    >
  | Pick<
      Prisma.TransactionClient,
      "orderAlbum" | "orderPackage" | "orderPackageItemUpgrade" | "orderAddOn"
    >;

type SalesAlbumClient = AlbumClient &
  (
    | Pick<PrismaClient, "packageItem">
    | Pick<Prisma.TransactionClient, "packageItem">
  );

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

export type SalesOrderAlbumRow = OrderAlbumRow & {
  packageItemId: string | null;
  productId: string | null;
  productLabel: string | null;
};

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

export async function getSalesOrderAlbums(
  input: GetOrderAlbumsInput,
  client: SalesAlbumClient = db
): Promise<SalesOrderAlbumRow[]> {
  const albums = await getOrderAlbums(input, client);
  const packageItemBackingIds = albums.flatMap((album) =>
    album.backingLineKind === ORDER_ALBUM_BACKING_LINE_KIND.PACKAGE_ITEM
      ? [album.backingLineId]
      : []
  );
  const packageItemUpgradeBackingIds = albums.flatMap((album) =>
    album.backingLineKind ===
    ORDER_ALBUM_BACKING_LINE_KIND.ORDER_PACKAGE_ITEM_UPGRADE
      ? [album.backingLineId]
      : []
  );
  const addOnBackingIds = albums.flatMap((album) =>
    album.backingLineKind === ORDER_ALBUM_BACKING_LINE_KIND.ORDER_ADD_ON
      ? [album.backingLineId]
      : []
  );

  const [packageItems, packageItemUpgrades, orderAddOns] = await Promise.all([
    packageItemBackingIds.length > 0
      ? client.packageItem.findMany({
          where: { id: { in: packageItemBackingIds } },
          select: {
            id: true,
            productId: true,
            product: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    packageItemUpgradeBackingIds.length > 0
      ? client.orderPackageItemUpgrade.findMany({
          where: { id: { in: packageItemUpgradeBackingIds } },
          select: {
            id: true,
            packageItemId: true,
            nameSnapshot: true,
            packageItem: { select: { productId: true } },
          },
        })
      : Promise.resolve([]),
    addOnBackingIds.length > 0
      ? client.orderAddOn.findMany({
          where: { id: { in: addOnBackingIds } },
          select: {
            id: true,
            productId: true,
            product: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const packageItemById = new Map(packageItems.map((item) => [item.id, item]));
  const packageItemUpgradeById = new Map(
    packageItemUpgrades.map((upgrade) => [upgrade.id, upgrade])
  );
  const addOnById = new Map(orderAddOns.map((addOn) => [addOn.id, addOn]));

  return albums.map((album) => {
    if (album.backingLineKind === ORDER_ALBUM_BACKING_LINE_KIND.PACKAGE_ITEM) {
      const packageItem = packageItemById.get(album.backingLineId);
      return {
        ...album,
        packageItemId: album.backingLineId,
        productId: packageItem?.productId ?? null,
        productLabel: packageItem?.product.name ?? null,
      };
    }

    if (
      album.backingLineKind ===
      ORDER_ALBUM_BACKING_LINE_KIND.ORDER_PACKAGE_ITEM_UPGRADE
    ) {
      const upgrade = packageItemUpgradeById.get(album.backingLineId);
      return {
        ...album,
        packageItemId: upgrade?.packageItemId ?? null,
        productId: upgrade?.packageItem.productId ?? null,
        productLabel: upgrade?.nameSnapshot ?? null,
      };
    }

    const addOn = addOnById.get(album.backingLineId);
    return {
      ...album,
      packageItemId: null,
      productId: addOn?.productId ?? null,
      productLabel: addOn?.product.name ?? null,
    };
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

export async function rebindOrderAlbumBacking(
  input: RebindOrderAlbumBackingInput,
  client: AlbumClient = db
): Promise<OrderAlbumRow> {
  const parsed = rebindOrderAlbumBackingInputSchema.parse(input);
  const updated = await client.orderAlbum.updateMany({
    where: { id: parsed.id, orderId: parsed.orderId },
    data: {
      orderPackageId: parsed.orderPackageId ?? null,
      sourceType: parsed.sourceType,
      backingLineKind: parsed.backingLineKind,
      backingLineId: parsed.backingLineId,
    },
  });
  if (updated.count !== 1) {
    throw new Error("Album does not belong to this order.");
  }

  const album = await client.orderAlbum.findUnique({
    where: { id: parsed.id },
    select: orderAlbumSelect,
  });
  if (!album) {
    throw new Error("Album was not found after backing update.");
  }
  return album;
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

  const preMaterializedAlbums = await client.orderAlbum.findMany({
    where: { orderId: parsed.orderId },
    select: {
      id: true,
      sourceType: true,
      orderPackageId: true,
      backingLineId: true,
    },
  });
  const extraPagesUpdatedAlbumIds = new Set<string>();

  for (const album of preMaterializedAlbums) {
    const remappedBackingLineId = album.backingLineId.startsWith("draft:")
      ? draftToOrderEntityMap.get(album.backingLineId) ?? album.backingLineId
      : album.backingLineId;
    if (remappedBackingLineId === album.backingLineId) continue;
    const scopeOrderPackageId =
      album.sourceType === ORDER_ALBUM_SOURCE_TYPE.PACKAGE
        ? album.orderPackageId
        : null;
    const extraPages =
      findExtraAlbumPageLine(parsed.committedSnapshot.lines, scopeOrderPackageId)
        ?.quantity ?? 0;

    await client.orderAlbum.update({
      where: { id: album.id },
      data: { backingLineId: remappedBackingLineId, extraPages },
      select: { id: true },
    });
    extraPagesUpdatedAlbumIds.add(album.id);
  }

  await materializeOrderAlbumsAfterCommit(parsed.orderId, client);
  const albums = await client.orderAlbum.findMany({
    where: { orderId: parsed.orderId },
    select: {
      id: true,
      sourceType: true,
      orderPackageId: true,
    },
  });

  for (const album of albums) {
    if (extraPagesUpdatedAlbumIds.has(album.id)) continue;
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
        extraPages,
      },
      select: { id: true },
    });
  }
}

async function materializeOrderAlbumsAfterCommit(
  orderId: string,
  client: AlbumClient
): Promise<void> {
  const [orderPackages, packageItemUpgrades, albumAddOns] = await Promise.all([
    client.orderPackage.findMany({
      where: { orderId },
      select: {
        id: true,
        currentPackage: {
          select: {
            items: {
              where: { product: { category: ProductCategory.ALBUM } },
              select: { id: true },
            },
          },
        },
      },
    }),
    client.orderPackageItemUpgrade.findMany({
      where: {
        orderId,
        packageItem: { product: { category: ProductCategory.ALBUM } },
      },
      select: {
        id: true,
        orderPackageId: true,
        packageItemId: true,
      },
    }),
    client.orderAddOn.findMany({
      where: {
        orderId,
        orderPackageId: null,
        product: { category: ProductCategory.ALBUM },
        productId: { not: EXTRA_ALBUM_PAGE_PRODUCT_ID },
      },
      select: { id: true },
    }),
  ]);
  const upgradeByPackageAndItem = new Map(
    packageItemUpgrades.map((upgrade) => [
      albumPackageItemKey(upgrade.orderPackageId, upgrade.packageItemId),
      upgrade,
    ])
  );
  const expectedPackageAlbumKeys = new Set<string>();

  for (const orderPackage of orderPackages) {
    for (const packageItem of orderPackage.currentPackage?.items ?? []) {
      const upgrade = upgradeByPackageAndItem.get(
        albumPackageItemKey(orderPackage.id, packageItem.id)
      );
      expectedPackageAlbumKeys.add(
        albumBackingKey(
          upgrade
            ? ORDER_ALBUM_BACKING_LINE_KIND.ORDER_PACKAGE_ITEM_UPGRADE
            : ORDER_ALBUM_BACKING_LINE_KIND.PACKAGE_ITEM,
          upgrade?.id ?? packageItem.id
        )
      );
    }
  }

  const packageAlbums = await client.orderAlbum.findMany({
    where: {
      orderId,
      sourceType: ORDER_ALBUM_SOURCE_TYPE.PACKAGE,
    },
    select: {
      id: true,
      backingLineKind: true,
      backingLineId: true,
    },
  });
  const obsoletePackageAlbumIds = packageAlbums
    .filter(
      (album) =>
        !expectedPackageAlbumKeys.has(
          albumBackingKey(album.backingLineKind, album.backingLineId)
        )
    )
    .map((album) => album.id);

  if (obsoletePackageAlbumIds.length > 0) {
    await client.orderAlbum.deleteMany({
      where: { id: { in: obsoletePackageAlbumIds } },
    });
  }

  for (const orderPackage of orderPackages) {
    for (const packageItem of orderPackage.currentPackage?.items ?? []) {
      const upgrade = upgradeByPackageAndItem.get(
        albumPackageItemKey(orderPackage.id, packageItem.id)
      );

      if (upgrade) {
        await createOrderAlbum(
          {
            orderId,
            orderPackageId: orderPackage.id,
            sourceType: ORDER_ALBUM_SOURCE_TYPE.PACKAGE,
            backingLineKind:
              ORDER_ALBUM_BACKING_LINE_KIND.ORDER_PACKAGE_ITEM_UPGRADE,
            backingLineId: upgrade.id,
          },
          client
        );
        continue;
      }

      // Part 2 size/product swaps must migrate this logical album row from the
      // PACKAGE_ITEM backing id to the upgrade backing id across commits, so a
      // swap does not leave both backing rows visible for one album.
      await createOrderAlbum(
        {
          orderId,
          orderPackageId: orderPackage.id,
          sourceType: ORDER_ALBUM_SOURCE_TYPE.PACKAGE,
          backingLineKind: ORDER_ALBUM_BACKING_LINE_KIND.PACKAGE_ITEM,
          backingLineId: packageItem.id,
        },
        client
      );
    }
  }

  for (const addOn of albumAddOns) {
    await createOrderAlbum(
      {
        orderId,
        orderPackageId: null,
        sourceType: ORDER_ALBUM_SOURCE_TYPE.ADDON,
        backingLineKind: ORDER_ALBUM_BACKING_LINE_KIND.ORDER_ADD_ON,
        backingLineId: addOn.id,
      },
      client
    );
  }
}

function albumPackageItemKey(
  orderPackageId: string,
  packageItemId: string
): string {
  return `${orderPackageId}:${packageItemId}`;
}

function albumBackingKey(backingLineKind: string, backingLineId: string): string {
  return `${backingLineKind}:${backingLineId}`;
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
