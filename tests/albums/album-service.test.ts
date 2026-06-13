import assert from "node:assert/strict";
import test from "node:test";
import {
  EXTRA_ALBUM_PAGE_PRODUCT_ID,
  ORDER_ALBUM_BACKING_LINE_KIND,
  ORDER_ALBUM_SOURCE_TYPE,
  buildExtraAlbumPageAddOnStagingChange,
  createOrderAlbum,
  getOrderAlbums,
  syncOrderAlbumsAfterCommit,
  updateOrderAlbumFinishing,
} from "@/modules/albums";
import {
  orderCommitDraftStagingChangeSchema,
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
  type OrderCommitSnapshotLineV1,
  type OrderCommitSnapshotV1,
} from "@/modules/order-commits";

test("createOrderAlbum is idempotent by order, package, backing kind, and backing id", async () => {
  const client = fakeAlbumClient();

  const first = await createOrderAlbum(
    {
      orderId: "order-1",
      orderPackageId: "order-package-1",
      sourceType: ORDER_ALBUM_SOURCE_TYPE.PACKAGE,
      backingLineKind: ORDER_ALBUM_BACKING_LINE_KIND.PACKAGE_ITEM,
      backingLineId: "package-item-album",
    },
    client
  );
  const repeated = await createOrderAlbum(
    {
      orderId: "order-1",
      orderPackageId: "order-package-1",
      sourceType: ORDER_ALBUM_SOURCE_TYPE.PACKAGE,
      backingLineKind: ORDER_ALBUM_BACKING_LINE_KIND.PACKAGE_ITEM,
      backingLineId: "package-item-album",
    },
    client
  );
  const secondPackageAlbum = await createOrderAlbum(
    {
      orderId: "order-1",
      orderPackageId: "order-package-2",
      sourceType: ORDER_ALBUM_SOURCE_TYPE.PACKAGE,
      backingLineKind: ORDER_ALBUM_BACKING_LINE_KIND.PACKAGE_ITEM,
      backingLineId: "package-item-album",
    },
    client
  );

  assert.equal(first.id, repeated.id);
  assert.notEqual(first.id, secondPackageAlbum.id);
  assert.equal(client.rows.length, 2);
});

test("getOrderAlbums returns raw album rows for one order", async () => {
  const client = fakeAlbumClient([
    albumRow({ id: "album-order-1", orderId: "order-1" }),
    albumRow({ id: "album-order-2", orderId: "order-2" }),
  ]);

  const rows = await getOrderAlbums({ orderId: "order-1" }, client);

  assert.deepEqual(
    rows.map((row) => row.id),
    ["album-order-1"]
  );
});

test("updateOrderAlbumFinishing writes live operational fields without draft access", async () => {
  const client = fakeAlbumClient([albumRow({ id: "album-1" })]);
  Object.defineProperty(client, "orderCommitDraft", {
    get() {
      throw new Error("OrderCommitDraft must not be read for finishing writes.");
    },
  });

  const updated = await updateOrderAlbumFinishing(
    {
      id: "album-1",
      coverMaterial: "linen",
      threadColor: "gold",
      layout: "classic",
      coverText: "Baby Sara",
      coverImageRef: "img-001",
      instructions: "Keep bright.",
    },
    client
  );

  assert.equal(updated.coverMaterial, "linen");
  assert.equal(updated.threadColor, "gold");
  assert.equal(updated.layout, "classic");
  assert.equal(updated.coverText, "Baby Sara");
  assert.equal(updated.coverImageRef, "img-001");
  assert.equal(updated.instructions, "Keep bright.");
});

test("buildExtraAlbumPageAddOnStagingChange returns ADD with a draft-prefixed id", () => {
  const change = buildExtraAlbumPageAddOnStagingChange({
    snapshot: snapshotFixture({ lines: [packageLine()] }),
    orderAlbum: {
      id: "album-1",
      sourceType: ORDER_ALBUM_SOURCE_TYPE.PACKAGE,
      orderPackageId: "order-package-1",
    },
    requestedExtraPages: 3,
  });

  assert.ok(change);
  assert.equal(change.action, "ADD");
  assert.equal(change.productId, EXTRA_ALBUM_PAGE_PRODUCT_ID);
  assert.equal(change.quantity, 3);
  assert.match(change.draftOrderAddOnId ?? "", /^draft:/);
  assert.deepEqual(change.parentPackageTarget, {
    orderEntityId: "order-package-1",
  });
  assert.equal(orderCommitDraftStagingChangeSchema.safeParse(change).success, true);
});

test("buildExtraAlbumPageAddOnStagingChange returns UPDATE_QUANTITY for changed package scope", () => {
  const change = buildExtraAlbumPageAddOnStagingChange({
    snapshot: snapshotFixture({
      lines: [
        packageLine(),
        extraAlbumPageLine({
          addOnId: "order-addon-pages",
          parentOrderPackageId: "order-package-1",
          quantity: 2,
        }),
      ],
    }),
    orderAlbum: {
      sourceType: ORDER_ALBUM_SOURCE_TYPE.PACKAGE,
      orderPackageId: "order-package-1",
    },
    requestedExtraPages: 5,
  });

  assert.ok(change);
  assert.equal(change.action, "UPDATE_QUANTITY");
  assert.equal(change.quantity, 5);
  assert.deepEqual(change.target, { orderEntityId: "order-addon-pages" });
  assert.deepEqual(change.parentPackageTarget, {
    orderEntityId: "order-package-1",
  });
});

test("buildExtraAlbumPageAddOnStagingChange returns REMOVE for zero requested pages", () => {
  const change = buildExtraAlbumPageAddOnStagingChange({
    snapshot: snapshotFixture({
      lines: [
        packageLine(),
        extraAlbumPageLine({
          addOnId: "order-addon-pages",
          parentOrderPackageId: null,
          quantity: 2,
        }),
      ],
    }),
    orderAlbum: {
      sourceType: ORDER_ALBUM_SOURCE_TYPE.ADDON,
      orderPackageId: null,
    },
    requestedExtraPages: 0,
  });

  assert.ok(change);
  assert.equal(change.action, "REMOVE");
  assert.deepEqual(change.target, { orderEntityId: "order-addon-pages" });
  assert.equal(change.parentPackageTarget, undefined);
});

test("buildExtraAlbumPageAddOnStagingChange returns null for no-op branches", () => {
  assert.equal(
    buildExtraAlbumPageAddOnStagingChange({
      snapshot: snapshotFixture({ lines: [packageLine()] }),
      orderAlbum: {
        sourceType: ORDER_ALBUM_SOURCE_TYPE.ADDON,
        orderPackageId: null,
      },
      requestedExtraPages: 0,
    }),
    null
  );
  assert.equal(
    buildExtraAlbumPageAddOnStagingChange({
      snapshot: snapshotFixture({
        lines: [
          packageLine(),
          extraAlbumPageLine({
            addOnId: "order-addon-pages",
            parentOrderPackageId: null,
            quantity: 2,
          }),
        ],
      }),
      orderAlbum: {
        sourceType: ORDER_ALBUM_SOURCE_TYPE.ADDON,
        orderPackageId: null,
      },
      requestedExtraPages: 2,
    }),
    null
  );
});

test("syncOrderAlbumsAfterCommit materializes package, upgrade, and standalone albums", async () => {
  const client = fakeAlbumClient([], {
    orderPackages: [
      orderPackageRow({
        id: "order-package-base",
        albumPackageItems: ["package-item-base-album"],
      }),
      orderPackageRow({
        id: "order-package-upgrade",
        albumPackageItems: ["package-item-upgraded-album"],
      }),
    ],
    packageItemUpgrades: [
      packageItemUpgradeRow({
        id: "upgrade-album",
        orderPackageId: "order-package-upgrade",
        packageItemId: "package-item-upgraded-album",
      }),
    ],
    addOns: [
      orderAddOnRow({ id: "standalone-album", productId: "album-product" }),
      orderAddOnRow({
        id: "extra-page-add-on",
        productId: EXTRA_ALBUM_PAGE_PRODUCT_ID,
      }),
    ],
  });

  await syncOrderAlbumsAfterCommit(
    {
      orderId: "order-1",
      committedSnapshot: snapshotFixture({
        lines: [
          packageLine({ orderPackageId: "order-package-base" }),
          packageLine({ orderPackageId: "order-package-upgrade" }),
          extraAlbumPageLine({
            addOnId: "extra-page-add-on",
            parentOrderPackageId: "order-package-base",
            quantity: 4,
          }),
        ],
      }),
      draftToOrderEntityEntries: [],
    },
    client
  );

  assert.deepEqual(
    client.rows.map((row) => ({
      orderPackageId: row.orderPackageId,
      sourceType: row.sourceType,
      backingLineKind: row.backingLineKind,
      backingLineId: row.backingLineId,
      extraPages: row.extraPages,
    })),
    [
      {
        orderPackageId: "order-package-base",
        sourceType: ORDER_ALBUM_SOURCE_TYPE.PACKAGE,
        backingLineKind: ORDER_ALBUM_BACKING_LINE_KIND.PACKAGE_ITEM,
        backingLineId: "package-item-base-album",
        extraPages: 4,
      },
      {
        orderPackageId: "order-package-upgrade",
        sourceType: ORDER_ALBUM_SOURCE_TYPE.PACKAGE,
        backingLineKind:
          ORDER_ALBUM_BACKING_LINE_KIND.ORDER_PACKAGE_ITEM_UPGRADE,
        backingLineId: "upgrade-album",
        extraPages: 0,
      },
      {
        orderPackageId: null,
        sourceType: ORDER_ALBUM_SOURCE_TYPE.ADDON,
        backingLineKind: ORDER_ALBUM_BACKING_LINE_KIND.ORDER_ADD_ON,
        backingLineId: "standalone-album",
        extraPages: 0,
      },
    ]
  );
  assert.equal(
    client.rows.some((row) => row.backingLineId === "extra-page-add-on"),
    false
  );
  assert.equal(
    client.rows.some((row) => row.backingLineId === "package-item-upgraded-album"),
    false
  );
});

test("syncOrderAlbumsAfterCommit is idempotent and uses the passed client", async () => {
  const client = fakeAlbumClient([], {
    orderPackages: [
      orderPackageRow({
        id: "order-package-base",
        albumPackageItems: ["package-item-base-album"],
      }),
    ],
    addOns: [orderAddOnRow({ id: "standalone-album", productId: "album-product" })],
  });

  const input = {
    orderId: "order-1",
    committedSnapshot: snapshotFixture({
      lines: [packageLine({ orderPackageId: "order-package-base" })],
    }),
    draftToOrderEntityEntries: [],
  };
  await syncOrderAlbumsAfterCommit(input, client);
  await syncOrderAlbumsAfterCommit(input, client);

  assert.equal(client.rows.length, 2);
  assert.deepEqual(client.calls, {
    orderPackageFindMany: 2,
    orderPackageItemUpgradeFindMany: 2,
    orderAddOnFindMany: 2,
  });
});

function fakeAlbumClient(
  initialRows: AlbumRow[] = [],
  options: {
    orderPackages?: FakeOrderPackageRow[];
    packageItemUpgrades?: FakePackageItemUpgradeRow[];
    addOns?: FakeOrderAddOnRow[];
  } = {}
) {
  const rows = [...initialRows];
  const calls = {
    orderPackageFindMany: 0,
    orderPackageItemUpgradeFindMany: 0,
    orderAddOnFindMany: 0,
  };
  return {
    rows,
    calls,
    orderAlbum: {
      findMany: async (args: { where: { orderId: string } }) =>
        rows.filter((row) => row.orderId === args.where.orderId),
      findFirst: async (args: {
        where: {
          orderId: string;
          orderPackageId: string | null;
          backingLineKind: string;
          backingLineId: string;
        };
      }) =>
        rows.find(
          (row) =>
            row.orderId === args.where.orderId &&
            row.orderPackageId === args.where.orderPackageId &&
            row.backingLineKind === args.where.backingLineKind &&
            row.backingLineId === args.where.backingLineId
        ) ?? null,
      create: async (args: { data: Partial<AlbumRow> }) => {
        const row = albumRow({
          id: `album-${rows.length + 1}`,
          orderId: args.data.orderId,
          orderPackageId: args.data.orderPackageId,
          sourceType: args.data.sourceType,
          backingLineKind: args.data.backingLineKind,
          backingLineId: args.data.backingLineId,
        });
        rows.push(row);
        return row;
      },
      update: async (args: { where: { id: string }; data: Partial<AlbumRow> }) => {
        const index = rows.findIndex((row) => row.id === args.where.id);
        assert.notEqual(index, -1);
        rows[index] = { ...rows[index], ...args.data, updatedAt: new Date() };
        return rows[index];
      },
    },
    orderPackage: {
      findMany: async () => {
        calls.orderPackageFindMany += 1;
        return options.orderPackages ?? [];
      },
    },
    orderPackageItemUpgrade: {
      findMany: async () => {
        calls.orderPackageItemUpgradeFindMany += 1;
        return options.packageItemUpgrades ?? [];
      },
    },
    orderAddOn: {
      findMany: async (args: {
        where: {
          orderId: string;
          orderPackageId: null;
          product: { category: string };
          productId: { not: string };
        };
      }) => {
        calls.orderAddOnFindMany += 1;
        assert.equal(args.where.orderId, "order-1");
        assert.equal(args.where.orderPackageId, null);
        assert.equal(args.where.product.category, "ALBUM");
        assert.equal(args.where.productId.not, EXTRA_ALBUM_PAGE_PRODUCT_ID);
        return (options.addOns ?? []).filter(
          (addOn) =>
            addOn.orderPackageId === null &&
            addOn.product.category === args.where.product.category &&
            addOn.productId !== args.where.productId.not
        );
      },
    },
  } as never;
}

type FakeOrderPackageRow = {
  id: string;
  currentPackage: {
    items: Array<{ id: string }>;
  };
};

type FakePackageItemUpgradeRow = {
  id: string;
  orderPackageId: string;
  packageItemId: string;
};

type FakeOrderAddOnRow = {
  id: string;
  orderPackageId: string | null;
  productId: string;
  product: {
    category: string;
  };
};

type AlbumRow = {
  id: string;
  orderId: string;
  orderPackageId: string | null;
  sourceType: string;
  backingLineKind: string;
  backingLineId: string;
  coverMaterial: string | null;
  threadColor: string | null;
  layout: string | null;
  coverText: string | null;
  coverImageRef: string | null;
  instructions: string | null;
  extraPages: number;
  createdAt: Date;
  updatedAt: Date;
};

function albumRow(overrides: Partial<AlbumRow> = {}): AlbumRow {
  return {
    id: "album-1",
    orderId: "order-1",
    orderPackageId: "order-package-1",
    sourceType: ORDER_ALBUM_SOURCE_TYPE.PACKAGE,
    backingLineKind: ORDER_ALBUM_BACKING_LINE_KIND.PACKAGE_ITEM,
    backingLineId: "package-item-album",
    coverMaterial: null,
    threadColor: null,
    layout: null,
    coverText: null,
    coverImageRef: null,
    instructions: null,
    extraPages: 0,
    createdAt: new Date("2026-06-11T00:00:00.000Z"),
    updatedAt: new Date("2026-06-11T00:00:00.000Z"),
    ...overrides,
  };
}

function snapshotFixture(input: {
  lines: OrderCommitSnapshotLineV1[];
}): OrderCommitSnapshotV1 {
  const subtotal = input.lines.reduce((sum, line) => sum + line.lineTotal, 0);
  return {
    schemaVersion: "order_commit_snapshot_v1",
    orderId: "order-1",
    financialCaseId: "financial-case-1",
    capturedAt: "2026-06-11T00:00:00.000Z",
    currency: "KWD",
    lines: input.lines,
    totals: {
      subtotal,
      discountTotal: 0,
      netTotal: subtotal,
    },
  };
}

function packageLine(input: { orderPackageId?: string } = {}): OrderCommitSnapshotLineV1 {
  const orderPackageId = input.orderPackageId ?? "order-package-1";
  return {
    lineId: `package:${orderPackageId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE,
    orderEntityId: orderPackageId,
    parentOrderPackageId: null,
    catalogEntityId: "package-base",
    stableKey: `order-package:${orderPackageId}`,
    label: "Base package",
    quantity: 1,
    unitPrice: 100,
    lineTotal: 100,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {},
  };
}

function orderPackageRow(input: {
  id: string;
  albumPackageItems: string[];
}): FakeOrderPackageRow {
  return {
    id: input.id,
    currentPackage: {
      items: input.albumPackageItems.map((id) => ({ id })),
    },
  };
}

function packageItemUpgradeRow(
  input: FakePackageItemUpgradeRow
): FakePackageItemUpgradeRow {
  return input;
}

function orderAddOnRow(
  input: Partial<FakeOrderAddOnRow> & { id: string; productId: string }
): FakeOrderAddOnRow {
  return {
    id: input.id,
    orderPackageId: input.orderPackageId ?? null,
    productId: input.productId,
    product: input.product ?? { category: "ALBUM" },
  };
}

function extraAlbumPageLine(input: {
  addOnId: string;
  parentOrderPackageId: string | null;
  quantity: number;
}): OrderCommitSnapshotLineV1 {
  return {
    lineId: `addon:${input.addOnId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_ADD_ON,
    orderEntityId: input.addOnId,
    parentOrderPackageId: input.parentOrderPackageId,
    catalogEntityId: EXTRA_ALBUM_PAGE_PRODUCT_ID,
    stableKey: `order-add-on:${input.addOnId}`,
    label: "Extra album page",
    quantity: input.quantity,
    unitPrice: 1,
    lineTotal: input.quantity,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: { productId: EXTRA_ALBUM_PAGE_PRODUCT_ID },
  };
}
