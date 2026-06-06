import assert from "node:assert/strict";
import test from "node:test";
import {
  MediaType,
  Prisma,
  SessionConfigurationFinancialBehavior,
  SessionConfigurationInputType,
  SessionConfigurationPricingMode,
} from "@prisma/client";
import {
  captureOrderCommitSnapshotFromOrderRows,
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
  type OrderCommitSnapshotClient,
  type OrderCommitSnapshotLineV1,
  type OrderCommitSnapshotV1,
} from "@/modules/order-commits";

test("captures V1 snapshot lines from operational order rows", async () => {
  const client = fakeSnapshotClient();

  const snapshot = await captureOrderCommitSnapshotFromOrderRows({
    orderId: "order-1",
    client,
  });

  assert.equal(snapshot.orderId, "order-1");
  assert.equal(snapshot.financialCaseId, "financial-case-1");
  assert.equal(snapshot.schemaVersion, "order_commit_snapshot_v1");
  assert.ok(Date.parse(snapshot.capturedAt));

  const packageLine = lineById(snapshot.lines, "package:op-1");
  assert.equal(packageLine.label, "Operational Package");
  assert.equal(packageLine.catalogEntityId, "pkg-current");
  assert.equal(packageLine.unitPrice, 150.125);
  assert.equal(packageLine.lineTotal, 150.125);
  assert.equal(packageLine.priceSource, ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT);
  assert.equal(packageLine.metadata.originalPackageId, "pkg-original");
  assert.equal(packageLine.metadata.selectedPhotoCount, 12);

  const addOnLine = lineById(snapshot.lines, "addon:addon-1");
  assert.equal(addOnLine.lineKind, ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON);
  assert.equal(addOnLine.parentOrderPackageId, "op-1");
  assert.equal(addOnLine.catalogEntityId, "prod-addon");
  assert.equal(addOnLine.quantity, 3);
  assert.equal(addOnLine.lineTotal, 60);

  const upgradeLine = lineById(snapshot.lines, "item-upgrade:upgrade-1");
  assert.equal(
    upgradeLine.lineKind,
    ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE
  );
  assert.equal(
    upgradeLine.orderEntityKind,
    ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_ITEM_UPGRADE
  );
  assert.equal(upgradeLine.catalogEntityId, "package-item-1");
  assert.equal(upgradeLine.lineTotal, 30);

  const digitalExtraLine = lineById(snapshot.lines, "extra-photo:op-1:digital");
  assert.equal(
    digitalExtraLine.lineKind,
    ORDER_COMMIT_SNAPSHOT_LINE_KIND.SELECTED_PHOTO_EXTRA
  );
  assert.equal(digitalExtraLine.quantity, 2);
  assert.equal(digitalExtraLine.unitPrice, 5);
  assert.equal(digitalExtraLine.lineTotal, 10);

  const printExtraLine = lineById(snapshot.lines, "extra-photo:op-1:print");
  assert.equal(printExtraLine.quantity, 1);
  assert.equal(printExtraLine.unitPrice, 7.5);
  assert.equal(printExtraLine.lineTotal, 7.5);

  const sessionLine = lineById(snapshot.lines, "session-config:selection-1");
  assert.equal(
    sessionLine.lineKind,
    ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION
  );
  assert.equal(
    sessionLine.orderEntityKind,
    ORDER_COMMIT_ORDER_ENTITY_KIND
      .ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION
  );
  assert.equal(sessionLine.orderEntityId, "selection-1");
  assert.equal(sessionLine.catalogEntityId, "configuration-1");
  assert.match(sessionLine.label, /Backdrop/);
  assert.match(sessionLine.label, /Gold/);
  assert.equal(sessionLine.lineTotal, 12.5);

  const operationalSessionLine = lineById(
    snapshot.lines,
    "session-config:selection-operational"
  );
  assert.equal(
    operationalSessionLine.lineKind,
    ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION
  );
  assert.equal(
    operationalSessionLine.orderEntityKind,
    ORDER_COMMIT_ORDER_ENTITY_KIND
      .ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION
  );
  assert.equal(operationalSessionLine.orderEntityId, "selection-operational");
  assert.equal(operationalSessionLine.catalogEntityId, "configuration-operational");
  assert.equal(operationalSessionLine.unitPrice, 0);
  assert.equal(operationalSessionLine.lineTotal, 0);
  assert.equal(
    operationalSessionLine.priceSource,
    ORDER_COMMIT_PRICE_SOURCE.SESSION_CONFIGURATION_SELECTION_SNAPSHOT
  );
  assert.match(operationalSessionLine.label, /Finish/);
  assert.match(operationalSessionLine.label, /Matte/);
  assert.equal(
    operationalSessionLine.metadata.snapshotFinancialBehavior,
    SessionConfigurationFinancialBehavior.OPERATIONAL
  );

  const linkedLine = lineById(
    snapshot.lines,
    "session-config:selection-linked:addon:addon-linked"
  );
  assert.equal(
    linkedLine.lineKind,
    ORDER_COMMIT_SNAPSHOT_LINE_KIND
      .LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON
  );
  assert.equal(linkedLine.orderEntityId, "selection-linked");
  assert.equal(linkedLine.catalogEntityId, "prod-linked");
  assert.equal(linkedLine.metadata.orderAddOnId, "addon-linked");
  assert.equal(
    linkedLine.stableKey,
    "session-configuration-selection:selection-linked:add-on:addon-linked"
  );
  assert.equal(linkedLine.lineTotal, 30);

  assert.equal(
    snapshot.lines.some((line) => line.lineId === "addon:addon-linked"),
    false
  );
  assert.deepEqual(snapshot.totals, {
    subtotal: 300.125,
    discountTotal: 0,
    netTotal: 300.125,
  });
});

test("captures deterministic snapshot content apart from capturedAt", async () => {
  const client = fakeSnapshotClient();
  const first = await captureOrderCommitSnapshotFromOrderRows({
    orderId: "order-1",
    client,
  });
  const second = await captureOrderCommitSnapshotFromOrderRows({
    orderId: "order-1",
    client,
  });

  assert.deepEqual(withoutCapturedAt(first), withoutCapturedAt(second));
  assert.deepEqual(
    first.lines.map((line) => [line.stableKey, line.lineId]),
    [...first.lines]
      .sort((left, right) =>
        left.stableKey.localeCompare(right.stableKey) ||
        left.lineId.localeCompare(right.lineId)
      )
      .map((line) => [line.stableKey, line.lineId])
  );

  for (const line of first.lines) {
    assert.deepEqual(
      Object.keys(line.metadata),
      [...Object.keys(line.metadata)].sort((left, right) =>
        left.localeCompare(right)
      )
    );
  }
});

test("invoice line mutations do not affect captured operational snapshots", async () => {
  const invoiceLineItems = [
    {
      id: "invoice-line-1",
      description: "Legacy package line",
      amount: decimal("999.000"),
    },
  ];
  const client = fakeSnapshotClient({ invoiceLineItems });
  const first = await captureOrderCommitSnapshotFromOrderRows({
    orderId: "order-1",
    client,
  });

  invoiceLineItems[0] = {
    ...invoiceLineItems[0],
    description: "Edited invoice package line",
    amount: decimal("1.000"),
  };
  invoiceLineItems.push({
    id: "invoice-line-2",
    description: "Synthetic add-on invoice line",
    amount: decimal("500.000"),
  });
  const second = await captureOrderCommitSnapshotFromOrderRows({
    orderId: "order-1",
    client,
  });

  assert.deepEqual(withoutCapturedAt(second), withoutCapturedAt(first));
});

test("fails loudly when an order has no financial case", async () => {
  await assert.rejects(
    captureOrderCommitSnapshotFromOrderRows({
      orderId: "order-without-financial-case",
      client: fakeSnapshotClient({ financialCaseId: null }),
    }),
    /has no FinancialCase/
  );
});

function lineById(
  lines: OrderCommitSnapshotLineV1[],
  lineId: string
): OrderCommitSnapshotLineV1 {
  const line = lines.find((candidate) => candidate.lineId === lineId);
  assert.ok(line, `Expected snapshot line ${lineId}`);
  return line;
}

function withoutCapturedAt(
  snapshot: OrderCommitSnapshotV1
): Omit<OrderCommitSnapshotV1, "capturedAt"> {
  return {
    schemaVersion: snapshot.schemaVersion,
    orderId: snapshot.orderId,
    financialCaseId: snapshot.financialCaseId,
    currency: snapshot.currency,
    lines: snapshot.lines,
    totals: snapshot.totals,
  };
}

function fakeSnapshotClient(options: {
  financialCaseId?: string | null;
  invoiceLineItems?: unknown[];
} = {}): OrderCommitSnapshotClient {
  const financialCaseId =
    "financialCaseId" in options ? options.financialCaseId : "financial-case-1";
  return {
    order: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        assert.match(where.id, /^order-/);
        return {
          id: where.id,
          booking: {
            financialCase: financialCaseId ? { id: financialCaseId } : null,
          },
          invoices: [
            {
              lineItems: options.invoiceLineItems ?? [],
            },
          ],
          packages: [
            {
              id: "op-1",
              originalPackageId: "pkg-original",
              currentPackageId: "pkg-current",
              bookingPackageId: "booking-package-1",
              sessionTypeId: "session-type-1",
              originalPackageNameSnapshot: "Original Package",
              currentPackageNameSnapshot: "Operational Package",
              originalPackagePriceSnapshot: decimal("100.000"),
              finalPackagePriceSnapshot: decimal("150.125"),
              selectedPhotoCount: 12,
              extraDigitalCount: 2,
              extraPrintCount: 1,
              sortOrder: 1,
              createdAt: new Date("2026-06-01T08:00:00.000Z"),
              currentPackage: {
                price: decimal("999.000"),
                photoCount: 10,
              },
              sessionType: {
                id: "session-type-1",
                name: "Portrait",
              },
              sessionConfigurationSelections: [
                {
                  id: "selection-1",
                  orderPackageId: "op-1",
                  configurationId: "configuration-1",
                  optionId: "option-1",
                  numericValue: null,
                  textValue: null,
                  snapshotOptionLabel: "Gold",
                  snapshotConfigurationCode: "BACKDROP",
                  snapshotLabel: "Backdrop",
                  snapshotPriceDelta: decimal("12.500"),
                  snapshotFinancialBehavior:
                    SessionConfigurationFinancialBehavior.FINANCIAL,
                  snapshotInputType: SessionConfigurationInputType.SELECT,
                  snapshotPricingMode: SessionConfigurationPricingMode.FIXED,
                  snapshotLinkedProductId: null,
                  orderAddOnId: null,
                  createdAt: new Date("2026-06-01T08:01:00.000Z"),
                },
                {
                  id: "selection-linked",
                  orderPackageId: "op-1",
                  configurationId: "configuration-linked",
                  optionId: "option-linked",
                  numericValue: null,
                  textValue: null,
                  snapshotOptionLabel: "Album",
                  snapshotConfigurationCode: "ALBUM",
                  snapshotLabel: "Album",
                  snapshotPriceDelta: decimal("0.000"),
                  snapshotFinancialBehavior:
                    SessionConfigurationFinancialBehavior.FINANCIAL,
                  snapshotInputType: SessionConfigurationInputType.SELECT,
                  snapshotPricingMode:
                    SessionConfigurationPricingMode.LINKED_PRODUCT,
                  snapshotLinkedProductId: "prod-linked",
                  orderAddOnId: "addon-linked",
                  createdAt: new Date("2026-06-01T08:02:00.000Z"),
                },
                {
                  id: "selection-operational",
                  orderPackageId: "op-1",
                  configurationId: "configuration-operational",
                  optionId: "option-operational",
                  numericValue: null,
                  textValue: null,
                  snapshotOptionLabel: "Matte",
                  snapshotConfigurationCode: "FINISH",
                  snapshotLabel: "Finish",
                  snapshotPriceDelta: decimal("0.000"),
                  snapshotFinancialBehavior:
                    SessionConfigurationFinancialBehavior.OPERATIONAL,
                  snapshotInputType: SessionConfigurationInputType.SELECT,
                  snapshotPricingMode: SessionConfigurationPricingMode.NONE,
                  snapshotLinkedProductId: null,
                  orderAddOnId: null,
                  createdAt: new Date("2026-06-01T08:02:30.000Z"),
                },
              ],
            },
          ],
          orderAddOns: [
            {
              id: "addon-1",
              orderPackageId: "op-1",
              productId: "prod-addon",
              nameSnapshot: "Operational Add On",
              priceSnapshot: decimal("20.000"),
              quantity: 3,
              notes: "scoped add-on",
              createdAt: new Date("2026-06-01T08:03:00.000Z"),
              sessionConfigurationSelections: [],
            },
            {
              id: "addon-linked",
              orderPackageId: "op-1",
              productId: "prod-linked",
              nameSnapshot: "Linked Product Add On",
              priceSnapshot: decimal("30.000"),
              quantity: 1,
              notes: null,
              createdAt: new Date("2026-06-01T08:04:00.000Z"),
              sessionConfigurationSelections: [{ id: "selection-linked" }],
            },
          ],
          packageItemUpgrades: [
            {
              id: "upgrade-1",
              orderPackageId: "op-1",
              packageItemId: "package-item-1",
              nameSnapshot: "Upgrade Album",
              priceSnapshot: decimal("15.000"),
              quantity: 2,
              notes: null,
              createdAt: new Date("2026-06-01T08:05:00.000Z"),
            },
          ],
        };
      },
    },
    sessionTypeExtraPhotoPricing: {
      findMany: async () => [
        {
          sessionTypeId: "session-type-1",
          mediaType: MediaType.DIGITAL,
          unitPrice: decimal("5.000"),
        },
        {
          sessionTypeId: "session-type-1",
          mediaType: MediaType.PRINT,
          unitPrice: decimal("7.500"),
        },
      ],
    },
  } as unknown as OrderCommitSnapshotClient;
}

function decimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}
