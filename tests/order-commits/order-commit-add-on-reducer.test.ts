import assert from "node:assert/strict";
import test from "node:test";
import {
  orderCommitDraftStagingChangeSchema,
  orderCommitSnapshotV1Schema,
  reduceOrderCommitDraftAddOn,
  ORDER_COMMIT_DRAFT_STAGING_DOMAIN,
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_CURRENCY,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
  ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
  type OrderCommitDraftStagingChange,
  type OrderCommitSnapshotLineV1,
  type OrderCommitSnapshotV1,
} from "@/modules/order-commits";

type AddOnStagingChange = Extract<
  OrderCommitDraftStagingChange,
  { domain: typeof ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON }
>;

test("adds a new catalog add-on line from resolved product data", () => {
  const snapshot = snapshotFixture({ lines: [packageLine()] });
  const before = structuredClone(snapshot);

  const reduced = reduceOrderCommitDraftAddOn(snapshot, {
    change: addOnChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
      action: "ADD",
      parentPackageTarget: { stableKey: "order-package:order-package-1" },
      productId: "product-addon",
      quantity: 2,
      draftOrderAddOnId: "draft:addon-1",
    }),
    resolvedProduct: {
      productId: "product-addon",
      label: "Canvas Add-On",
      unitPrice: 12.345,
    },
  });

  assert.deepEqual(snapshot, before);
  assert.doesNotThrow(() => orderCommitSnapshotV1Schema.parse(reduced));
  const line = requireLine(reduced, "addon:draft:addon-1");
  assert.equal(line.lineKind, ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON);
  assert.equal(line.orderEntityKind, ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_ADD_ON);
  assert.equal(line.orderEntityId, "draft:addon-1");
  assert.equal(line.parentOrderPackageId, "order-package-1");
  assert.equal(line.catalogEntityId, "product-addon");
  assert.equal(line.stableKey, "order-add-on:draft:addon-1");
  assert.equal(line.label, "Canvas Add-On");
  assert.equal(line.quantity, 2);
  assert.equal(line.unitPrice, 12.345);
  assert.equal(line.lineTotal, 24.69);
  assert.equal(line.priceSource, ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT);
  assert.deepEqual(line.metadata, {
    draftOrderAddOnId: "draft:addon-1",
    productId: "product-addon",
  });
  assert.deepEqual(reduced.totals, {
    subtotal: 124.69,
    discountTotal: 0,
    netTotal: 124.69,
  });
});

test("increments existing true add-ons by package scope and product", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine(),
      addOnLine({
        orderEntityId: "addon-existing",
        productId: "product-addon",
        quantity: 3,
        unitPrice: 9,
      }),
    ],
  });

  const reduced = reduceOrderCommitDraftAddOn(snapshot, {
    change: addOnChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
      action: "ADD",
      parentPackageTarget: { stableKey: "order-package:order-package-1" },
      productId: "product-addon",
      quantity: 2,
      draftOrderAddOnId: "draft:addon-new",
    }),
    resolvedProduct: {
      productId: "product-addon",
      label: "New catalog label ignored for merged lines",
      unitPrice: 99,
    },
  });

  const line = requireLine(reduced, "addon:addon-existing");
  assert.equal(line.quantity, 5);
  assert.equal(line.unitPrice, 9);
  assert.equal(line.lineTotal, 45);
  assert.equal(
    reduced.lines.filter((candidate) => candidate.lineKind === "ADD_ON").length,
    1
  );
});

test("updates add-on quantity exactly while preserving stored unit price", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine(),
      addOnLine({
        orderEntityId: "addon-existing",
        productId: "product-addon",
        quantity: 3,
        unitPrice: 7.5,
      }),
    ],
  });

  const reduced = reduceOrderCommitDraftAddOn(snapshot, {
    change: addOnChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
      action: "UPDATE_QUANTITY",
      target: { stableKey: "order-add-on:addon-existing" },
      parentPackageTarget: { stableKey: "order-package:order-package-1" },
      quantity: 4,
    }),
  });

  const line = requireLine(reduced, "addon:addon-existing");
  assert.equal(line.quantity, 4);
  assert.equal(line.unitPrice, 7.5);
  assert.equal(line.lineTotal, 30);
});

test("removes an add-on when updated to zero quantity", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine(),
      addOnLine({ orderEntityId: "addon-existing", productId: "product-addon" }),
    ],
  });

  const reduced = reduceOrderCommitDraftAddOn(snapshot, {
    change: addOnChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
      action: "UPDATE_QUANTITY",
      target: { lineId: "addon:addon-existing" },
      parentPackageTarget: { stableKey: "order-package:order-package-1" },
      quantity: 0,
    }),
  });

  assert.equal(
    reduced.lines.some((line) => line.lineId === "addon:addon-existing"),
    false
  );
});

test("removes a draft add-on by service-provided draft entity id", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine(),
      addOnLine({
        orderEntityId: "draft:addon-existing",
        productId: "product-addon",
      }),
    ],
  });

  const reduced = reduceOrderCommitDraftAddOn(snapshot, {
    change: addOnChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
      action: "REMOVE",
      target: { draftEntityId: "draft:addon-existing" },
      parentPackageTarget: { stableKey: "order-package:order-package-1" },
    }),
  });

  assert.equal(
    reduced.lines.some((line) => line.orderEntityId === "draft:addon-existing"),
    false
  );
});

test("keeps true add-ons isolated by package scope", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine({ orderEntityId: "order-package-1" }),
      packageLine({ orderEntityId: "order-package-2" }),
      addOnLine({
        orderEntityId: "addon-package-1",
        parentOrderPackageId: "order-package-1",
        productId: "product-addon",
        quantity: 1,
      }),
      addOnLine({
        orderEntityId: "addon-package-2",
        parentOrderPackageId: "order-package-2",
        productId: "product-addon",
        quantity: 2,
      }),
    ],
  });

  const reduced = reduceOrderCommitDraftAddOn(snapshot, {
    change: addOnChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
      action: "ADD",
      parentPackageTarget: { stableKey: "order-package:order-package-2" },
      productId: "product-addon",
      quantity: 3,
      draftOrderAddOnId: "draft:addon-package-2",
    }),
    resolvedProduct: {
      productId: "product-addon",
      label: "Scoped Add-On",
      unitPrice: 20,
    },
  });

  assert.equal(requireLine(reduced, "addon:addon-package-1").quantity, 1);
  assert.equal(requireLine(reduced, "addon:addon-package-2").quantity, 5);
});

test("rejects contradictory add-on target identity fields", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine(),
      addOnLine({
        orderEntityId: "addon-existing",
        productId: "product-addon",
      }),
      addOnLine({
        orderEntityId: "addon-other",
        productId: "product-other",
      }),
    ],
  });

  assert.throws(
    () =>
      reduceOrderCommitDraftAddOn(snapshot, {
        change: addOnChange({
          domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
          action: "UPDATE_QUANTITY",
          target: {
            stableKey: "order-add-on:addon-existing",
            lineId: "addon:addon-other",
          },
          parentPackageTarget: { stableKey: "order-package:order-package-1" },
          quantity: 2,
        }),
      }),
    /matched multiple lines from contradictory target identity fields/
  );
});

test("rejects linked-product session-configuration add-on updates and removals", () => {
  const snapshot = snapshotFixture({
    lines: [packageLine(), linkedProductAddOnLine()],
  });

  assert.throws(
    () =>
      reduceOrderCommitDraftAddOn(snapshot, {
        change: addOnChange({
          domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
          action: "UPDATE_QUANTITY",
          target: {
            stableKey:
              "session-configuration-selection:selection-1:add-on:addon-linked",
          },
          parentPackageTarget: { stableKey: "order-package:order-package-1" },
          quantity: 2,
        }),
      }),
    /linked-product session-configuration add-ons cannot be mutated/
  );

  assert.throws(
    () =>
      reduceOrderCommitDraftAddOn(snapshot, {
        change: addOnChange({
          domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
          action: "REMOVE",
          target: { lineId: "session-config:selection-1:addon:addon-linked" },
          parentPackageTarget: { stableKey: "order-package:order-package-1" },
        }),
      }),
    /linked-product session-configuration add-ons cannot be mutated/
  );
});

function addOnChange(input: unknown): AddOnStagingChange {
  const parsed = orderCommitDraftStagingChangeSchema.parse(input);
  assert.equal(parsed.domain, ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON);
  return parsed as AddOnStagingChange;
}

function snapshotFixture(input: {
  lines: OrderCommitSnapshotLineV1[];
}): OrderCommitSnapshotV1 {
  return {
    schemaVersion: ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
    orderId: "order-1",
    financialCaseId: "financial-case-1",
    capturedAt: "2026-06-01T00:00:00.000Z",
    currency: ORDER_COMMIT_SNAPSHOT_CURRENCY,
    lines: input.lines,
    totals: {
      subtotal: 0,
      discountTotal: 0,
      netTotal: 0,
    },
  };
}

function packageLine(
  overrides: Partial<OrderCommitSnapshotLineV1> = {}
): OrderCommitSnapshotLineV1 {
  const orderEntityId = overrides.orderEntityId ?? "order-package-1";
  return {
    lineId: `package:${orderEntityId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE,
    orderEntityId,
    parentOrderPackageId: null,
    catalogEntityId: `package-catalog-${orderEntityId}`,
    stableKey: `order-package:${orderEntityId}`,
    label: `Package ${orderEntityId}`,
    quantity: 1,
    unitPrice: 100,
    lineTotal: 100,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {},
    ...overrides,
  };
}

function addOnLine(
  input: Partial<OrderCommitSnapshotLineV1> & {
    orderEntityId: string;
    productId: string;
  }
): OrderCommitSnapshotLineV1 {
  const parentOrderPackageId = input.parentOrderPackageId ?? "order-package-1";
  const quantity = input.quantity ?? 1;
  const unitPrice = input.unitPrice ?? 20;
  return {
    lineId: `addon:${input.orderEntityId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_ADD_ON,
    orderEntityId: input.orderEntityId,
    parentOrderPackageId,
    catalogEntityId: input.productId,
    stableKey: `order-add-on:${input.orderEntityId}`,
    label: `Add-On ${input.orderEntityId}`,
    quantity,
    unitPrice,
    lineTotal: Number((unitPrice * quantity).toFixed(3)),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {},
    ...input,
  };
}

function linkedProductAddOnLine(): OrderCommitSnapshotLineV1 {
  return {
    lineId: "session-config:selection-1:addon:addon-linked",
    lineKind:
      ORDER_COMMIT_SNAPSHOT_LINE_KIND
        .LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND
        .ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
    orderEntityId: "selection-1",
    parentOrderPackageId: "order-package-1",
    catalogEntityId: "product-linked",
    stableKey: "session-configuration-selection:selection-1:add-on:addon-linked",
    label: "Linked Product",
    quantity: 1,
    unitPrice: 30,
    lineTotal: 30,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      orderAddOnId: "addon-linked",
      productId: "product-linked",
    },
  };
}

function requireLine(
  snapshot: OrderCommitSnapshotV1,
  lineId: string
): OrderCommitSnapshotLineV1 {
  const line = snapshot.lines.find((candidate) => candidate.lineId === lineId);
  assert.ok(line, `Expected line ${lineId}`);
  return line;
}
