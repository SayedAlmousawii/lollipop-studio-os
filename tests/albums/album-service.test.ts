import assert from "node:assert/strict";
import test from "node:test";
import {
  EXTRA_ALBUM_PAGE_PRODUCT_ID,
  ORDER_ALBUM_BACKING_LINE_KIND,
  ORDER_ALBUM_SOURCE_TYPE,
  buildExtraAlbumPageAddOnStagingChange,
  createOrderAlbum,
  getOrderAlbums,
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

function fakeAlbumClient(initialRows: AlbumRow[] = []) {
  const rows = [...initialRows];
  return {
    rows,
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
  } as never;
}

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

function packageLine(): OrderCommitSnapshotLineV1 {
  return {
    lineId: "package:order-package-1",
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE,
    orderEntityId: "order-package-1",
    parentOrderPackageId: null,
    catalogEntityId: "package-base",
    stableKey: "order-package:order-package-1",
    label: "Base package",
    quantity: 1,
    unitPrice: 100,
    lineTotal: 100,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {},
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
