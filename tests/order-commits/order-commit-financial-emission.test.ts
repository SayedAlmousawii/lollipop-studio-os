import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { InvoiceLineType, OrderEntityKind } from "@prisma/client";
import {
  diffOrderCommitSnapshots,
  mapOrderCommitDiffToFinancialLines,
  OrderCommitFinancialEmissionError,
  ORDER_COMMIT_CREDIT_NOTE_REASON,
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PREVIEW_BASELINE_SOURCE,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_CURRENCY,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
  ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
  type OrderCommitOpenAdjustmentLine,
  type OrderCommitSnapshotDiff,
  type OrderCommitSnapshotLineV1,
  type OrderCommitSnapshotV1,
} from "@/modules/order-commits";

test("maps positive-only diffs to adjustment lines", () => {
  const diff = diffFor({
    baseLines: [packageLine({ unitPrice: 100, label: "Basic" })],
    pendingLines: [
      packageLine({
        unitPrice: 180,
        catalogEntityId: "package-premium",
        label: "Premium",
      }),
      addOnLine({
        orderAddOnId: "draft:addon-frame",
        label: "Frame",
        quantity: 2,
        unitPrice: 12,
      }),
      packageItemUpgradeLine({
        orderPackageItemUpgradeId: "draft:upgrade-cover",
        label: "Leather Cover",
        unitPrice: 20,
      }),
      extraPhotoLine({ mediaType: "DIGITAL", quantity: 3, unitPrice: 5 }),
      sessionConfigurationLine({
        selectionId: "draft:selection-backdrop",
        label: "Backdrop - Gold",
        unitPrice: 15,
      }),
      sessionConfigurationLine({
        selectionId: "draft:selection-album",
        label: "Album",
        unitPrice: 0,
        metadata: { draftOrderAddOnId: "draft:linked-album" },
      }),
      linkedProductLine({
        selectionId: "draft:selection-album",
        addOnRef: "draft:linked-album",
        label: "Premium Album",
        unitPrice: 55,
        draftOrderAddOnId: "draft:linked-album",
      }),
    ],
  });

  const emission = mapOrderCommitDiffToFinancialLines({
    diff,
    baselineSource: ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT,
    draftToOrderEntityMap: new Map([
      ["draft:addon-frame", "addon-frame"],
      ["draft:upgrade-cover", "upgrade-cover"],
      ["draft:selection-backdrop", "selection-backdrop"],
      ["draft:selection-album", "selection-album"],
      ["draft:linked-album", "linked-album"],
    ]),
    openAdjustmentLinesByCause: new Map(),
  });

  assert.deepEqual(
    emission.adjustmentLines.map((line) => ({
      lineType: line.lineType,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      causeOrderEntityKind: line.causeOrderEntityKind,
      causeOrderEntityId: line.causeOrderEntityId,
    })),
    [
      {
        lineType: InvoiceLineType.ADD_ON,
        description: "Frame",
        quantity: 2,
        unitPrice: 12,
        causeOrderEntityKind: OrderEntityKind.ADDON,
        causeOrderEntityId: "addon-frame",
      },
      {
        lineType: InvoiceLineType.ADD_ON,
        description: "Leather Cover",
        quantity: 1,
        unitPrice: 20,
        causeOrderEntityKind: OrderEntityKind.UPGRADE,
        causeOrderEntityId: "upgrade-cover",
      },
      {
        lineType: InvoiceLineType.PACKAGE_UPGRADE,
        description: "Package upgrade: Basic -> Premium",
        quantity: 1,
        unitPrice: 80,
        causeOrderEntityKind: OrderEntityKind.PACKAGE_TIER_UPGRADE,
        causeOrderEntityId: "order-package-1",
      },
      {
        lineType: InvoiceLineType.EXTRA_PHOTOS,
        description: "Extra photos - DIGITAL",
        quantity: 3,
        unitPrice: 5,
        causeOrderEntityKind: OrderEntityKind.EXTRA_PHOTO,
        causeOrderEntityId: "order-package-1:DIGITAL",
      },
      {
        lineType: InvoiceLineType.ADD_ON,
        description: "Premium Album",
        quantity: 1,
        unitPrice: 55,
        causeOrderEntityKind: OrderEntityKind.ADDON,
        causeOrderEntityId: "linked-album",
      },
      {
        lineType: InvoiceLineType.SESSION_CONFIGURATION,
        description: "Backdrop - Gold",
        quantity: 1,
        unitPrice: 15,
        causeOrderEntityKind: OrderEntityKind.SESSION_CONFIGURATION_SELECTION,
        causeOrderEntityId: "selection-backdrop",
      },
    ]
  );
  assert.deepEqual(emission.creditNoteFinalLines, []);
  assert.deepEqual(emission.adjustmentReversals, []);
  assert.equal(emission.totals.positiveTotal, 209);
  assert.equal(emission.totals.netDelta, 209);
});

test("maps negative-only diffs without open adjustment exposure to final credit lines", () => {
  const diff = diffFor({
    baseLines: [
      packageLine({
        unitPrice: 180,
        catalogEntityId: "package-premium",
        label: "Premium",
      }),
      addOnLine({
        orderAddOnId: "addon-removed",
        label: "Removed Add-on",
        unitPrice: 10,
      }),
      addOnLine({
        orderAddOnId: "addon-decreased",
        label: "Decreased Add-on",
        quantity: 3,
        unitPrice: 8,
      }),
      packageItemUpgradeLine({
        orderPackageItemUpgradeId: "upgrade-removed",
        label: "Removed Item",
        unitPrice: 12,
      }),
      packageItemUpgradeLine({
        orderPackageItemUpgradeId: "upgrade-decreased",
        label: "Decreased Item",
        quantity: 3,
        unitPrice: 7,
      }),
      extraPhotoLine({ mediaType: "DIGITAL", quantity: 2, unitPrice: 5 }),
      extraPhotoLine({ mediaType: "PRINT", quantity: 3, unitPrice: 6 }),
      sessionConfigurationLine({
        selectionId: "selection-removed",
        label: "Removed Backdrop",
        unitPrice: 15,
      }),
      sessionConfigurationLine({
        selectionId: "selection-linked",
        label: "Album",
        unitPrice: 0,
        metadata: { orderAddOnId: "linked-addon" },
      }),
      linkedProductLine({
        selectionId: "selection-linked",
        addOnRef: "linked-addon",
        label: "Removed Album",
        unitPrice: 55,
        orderAddOnId: "linked-addon",
      }),
    ],
    pendingLines: [
      packageLine({
        unitPrice: 100,
        catalogEntityId: "package-basic",
        label: "Basic",
      }),
      addOnLine({
        orderAddOnId: "addon-decreased",
        label: "Decreased Add-on",
        quantity: 1,
        unitPrice: 8,
      }),
      packageItemUpgradeLine({
        orderPackageItemUpgradeId: "upgrade-decreased",
        label: "Decreased Item",
        quantity: 1,
        unitPrice: 7,
      }),
      extraPhotoLine({ mediaType: "PRINT", quantity: 1, unitPrice: 6 }),
    ],
  });

  const emission = mapOrderCommitDiffToFinancialLines({
    diff,
    baselineSource: ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT,
    draftToOrderEntityMap: new Map(),
    openAdjustmentLinesByCause: new Map(),
  });

  assert.deepEqual(
    emission.creditNoteFinalLines.map((entry) => ({
      reason: entry.reason,
      quantity: entry.line.quantity,
      unitPrice: entry.line.unitPrice,
      causeOrderEntityKind: entry.line.causeOrderEntityKind,
      causeOrderEntityId: entry.line.causeOrderEntityId,
    })),
    [
      {
        reason: ORDER_COMMIT_CREDIT_NOTE_REASON.ADDON_QUANTITY_DECREASE,
        quantity: 1,
        unitPrice: 16,
        causeOrderEntityKind: OrderEntityKind.ADDON,
        causeOrderEntityId: "addon-decreased",
      },
      {
        reason: ORDER_COMMIT_CREDIT_NOTE_REASON.REMOVED_ADDON,
        quantity: 1,
        unitPrice: 10,
        causeOrderEntityKind: OrderEntityKind.ADDON,
        causeOrderEntityId: "addon-removed",
      },
      {
        reason:
          ORDER_COMMIT_CREDIT_NOTE_REASON
            .PACKAGE_ITEM_UPGRADE_QUANTITY_DECREASE,
        quantity: 1,
        unitPrice: 14,
        causeOrderEntityKind: OrderEntityKind.UPGRADE,
        causeOrderEntityId: "upgrade-decreased",
      },
      {
        reason:
          ORDER_COMMIT_CREDIT_NOTE_REASON.REMOVED_PACKAGE_ITEM_UPGRADE,
        quantity: 1,
        unitPrice: 12,
        causeOrderEntityKind: OrderEntityKind.UPGRADE,
        causeOrderEntityId: "upgrade-removed",
      },
      {
        reason: ORDER_COMMIT_CREDIT_NOTE_REASON.PACKAGE_TIER_DOWNGRADE,
        quantity: 1,
        unitPrice: 80,
        causeOrderEntityKind: OrderEntityKind.PACKAGE_TIER_UPGRADE,
        causeOrderEntityId: "order-package-1",
      },
      {
        reason: ORDER_COMMIT_CREDIT_NOTE_REASON.REMOVED_EXTRA_PHOTO,
        quantity: 1,
        unitPrice: 10,
        causeOrderEntityKind: OrderEntityKind.EXTRA_PHOTO,
        causeOrderEntityId: "order-package-1:DIGITAL",
      },
      {
        reason: ORDER_COMMIT_CREDIT_NOTE_REASON.EXTRA_PHOTO_QUANTITY_DECREASE,
        quantity: 1,
        unitPrice: 12,
        causeOrderEntityKind: OrderEntityKind.EXTRA_PHOTO,
        causeOrderEntityId: "order-package-1:PRINT",
      },
      {
        reason:
          ORDER_COMMIT_CREDIT_NOTE_REASON.REMOVED_LINKED_PRODUCT_ADD_ON,
        quantity: 1,
        unitPrice: 55,
        causeOrderEntityKind: OrderEntityKind.ADDON,
        causeOrderEntityId: "linked-addon",
      },
      {
        reason:
          ORDER_COMMIT_CREDIT_NOTE_REASON.REMOVED_SESSION_CONFIGURATION,
        quantity: 1,
        unitPrice: 15,
        causeOrderEntityKind: OrderEntityKind.SESSION_CONFIGURATION_SELECTION,
        causeOrderEntityId: "selection-removed",
      },
    ]
  );
  assert.deepEqual(emission.adjustmentLines, []);
  assert.deepEqual(emission.adjustmentReversals, []);
  assert.equal(emission.totals.negativeTotal, 224);
  assert.equal(emission.totals.netDelta, -224);
});

test("routes reductions through open adjustment lines before final residual credit", () => {
  const diff = diffFor({
    baseLines: [
      addOnLine({
        orderAddOnId: "addon-covered",
        label: "Covered Add-on",
        quantity: 4,
        unitPrice: 10,
      }),
    ],
    pendingLines: [
      addOnLine({
        orderAddOnId: "addon-covered",
        label: "Covered Add-on",
        quantity: 1,
        unitPrice: 10,
      }),
    ],
  });
  const openLines = new Map<string, OrderCommitOpenAdjustmentLine[]>([
    [
      "ADDON:addon-covered",
      [
        openAdjustmentLine({
          invoiceLineId: "line-z-first",
          invoiceId: "invoice-1",
          remainingAmount: 10,
        }),
        openAdjustmentLine({
          invoiceLineId: "line-a-second",
          invoiceId: "invoice-2",
          remainingAmount: 15,
        }),
      ],
    ],
  ]);
  const before = structuredClone([...openLines.entries()]);

  const emission = mapOrderCommitDiffToFinancialLines({
    diff,
    baselineSource: ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT,
    draftToOrderEntityMap: new Map(),
    openAdjustmentLinesByCause: openLines,
  });

  assert.deepEqual(
    emission.adjustmentReversals.map((reversal) => ({
      invoiceId: reversal.parentAdjustmentInvoiceId,
      lineId: reversal.targetInvoiceLineId,
      amount: reversal.amount,
      description: reversal.description,
    })),
    [
      {
        invoiceId: "invoice-1",
        lineId: "line-z-first",
        amount: 10,
        description: "Decreased: Covered Add-on",
      },
      {
        invoiceId: "invoice-2",
        lineId: "line-a-second",
        amount: 15,
        description: "Decreased: Covered Add-on",
      },
    ]
  );
  assert.equal(emission.creditNoteFinalLines[0]?.line.unitPrice, 5);
  assert.deepEqual([...openLines.entries()], before);
});

test("maps decomposed session configuration changes as remove plus add", () => {
  const diff = diffFor({
    baseLines: [
      sessionConfigurationLine({
        selectionId: "selection-old",
        label: "Backdrop - Silver",
        unitPrice: 20,
      }),
    ],
    pendingLines: [
      sessionConfigurationLine({
        selectionId: "draft:selection-new",
        label: "Backdrop - Gold",
        unitPrice: 25,
      }),
    ],
  });

  const emission = mapOrderCommitDiffToFinancialLines({
    diff,
    baselineSource: ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT,
    draftToOrderEntityMap: new Map([
      ["draft:selection-new", "selection-new"],
    ]),
    openAdjustmentLinesByCause: new Map(),
  });

  assert.equal(emission.adjustmentLines.length, 1);
  assert.equal(emission.adjustmentLines[0]?.description, "Backdrop - Gold");
  assert.equal(emission.adjustmentLines[0]?.unitPrice, 25);
  assert.equal(emission.creditNoteFinalLines.length, 1);
  assert.equal(
    emission.creditNoteFinalLines[0]?.reason,
    ORDER_COMMIT_CREDIT_NOTE_REASON.REMOVED_SESSION_CONFIGURATION
  );
  assert.equal(emission.creditNoteFinalLines[0]?.line.unitPrice, 20);
  assert.equal(emission.totals.netDelta, 5);
});

test("maps paired linked-product quantity changes and ignores metadata refreshes", () => {
  const quantityDiff = diffFor({
    baseLines: [
      sessionConfigurationLine({
        selectionId: "selection-linked",
        label: "Album",
        quantity: 1,
        unitPrice: 0,
        metadata: { orderAddOnId: "linked-addon" },
      }),
      linkedProductLine({
        selectionId: "selection-linked",
        addOnRef: "linked-addon",
        label: "Album",
        quantity: 1,
        unitPrice: 40,
        orderAddOnId: "linked-addon",
      }),
    ],
    pendingLines: [
      sessionConfigurationLine({
        selectionId: "selection-linked",
        label: "Album",
        quantity: 2,
        unitPrice: 0,
        metadata: { orderAddOnId: "linked-addon" },
      }),
      linkedProductLine({
        selectionId: "selection-linked",
        addOnRef: "linked-addon",
        label: "Album",
        quantity: 2,
        unitPrice: 40,
        orderAddOnId: "linked-addon",
      }),
    ],
  });

  const quantityEmission = mapOrderCommitDiffToFinancialLines({
    diff: quantityDiff,
    baselineSource: ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT,
    draftToOrderEntityMap: new Map(),
    openAdjustmentLinesByCause: new Map(),
  });

  assert.deepEqual(quantityEmission.adjustmentLines, [
    {
      lineType: InvoiceLineType.ADD_ON,
      description: "Album",
      quantity: 1,
      unitPrice: 40,
      causeOrderEntityKind: OrderEntityKind.ADDON,
      causeOrderEntityId: "linked-addon",
    },
  ]);

  const metadataDiff = diffFor({
    baseLines: [
      linkedProductLine({
        selectionId: "selection-linked",
        addOnRef: "linked-addon",
        label: "Album",
        unitPrice: 40,
        orderAddOnId: "linked-addon",
        metadata: { orderAddOnId: "linked-addon", productId: "product-old" },
      }),
    ],
    pendingLines: [
      linkedProductLine({
        selectionId: "selection-linked",
        addOnRef: "linked-addon",
        label: "Album",
        unitPrice: 40,
        orderAddOnId: "linked-addon",
        metadata: { orderAddOnId: "linked-addon", productId: "product-new" },
      }),
    ],
  });

  const metadataEmission = mapOrderCommitDiffToFinancialLines({
    diff: metadataDiff,
    baselineSource: ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT,
    draftToOrderEntityMap: new Map(),
    openAdjustmentLinesByCause: new Map(),
  });

  assert.deepEqual(metadataEmission.adjustmentLines, []);
  assert.deepEqual(metadataEmission.creditNoteFinalLines, []);
});

test("maps mixed-sign commits to both adjustment and credit outputs", () => {
  const diff = diffFor({
    baseLines: [
      packageLine({ unitPrice: 100, label: "Basic" }),
      addOnLine({
        orderAddOnId: "addon-remove",
        label: "Removed Add-on",
        unitPrice: 20,
      }),
    ],
    pendingLines: [
      packageLine({
        unitPrice: 180,
        catalogEntityId: "package-premium",
        label: "Premium",
      }),
    ],
  });

  const emission = mapOrderCommitDiffToFinancialLines({
    diff,
    baselineSource: ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT,
    draftToOrderEntityMap: new Map(),
    openAdjustmentLinesByCause: new Map(),
  });

  assert.equal(emission.adjustmentLines.length, 1);
  assert.equal(emission.creditNoteFinalLines.length, 1);
  assert.equal(emission.totals.positiveTotal, 80);
  assert.equal(emission.totals.negativeTotal, 20);
  assert.equal(emission.totals.netDelta, 60);
});

test("rejects invalid diffs and unresolved draft ids with typed codes", () => {
  const packageAdded = diffFor({
    baseLines: [],
    pendingLines: [packageLine()],
  });
  assertEmissionError(
    () => mapWithDefaults(packageAdded),
    "ORDER_COMMIT_FINANCIAL_EMISSION_INVALID_PACKAGE_DIFF"
  );

  const addOnPriceChanged = diffFor({
    baseLines: [addOnLine({ orderAddOnId: "addon-1", unitPrice: 10 })],
    pendingLines: [addOnLine({ orderAddOnId: "addon-1", unitPrice: 12 })],
  });
  assertEmissionError(
    () => mapWithDefaults(addOnPriceChanged),
    "ORDER_COMMIT_FINANCIAL_EMISSION_PRICE_CHANGE_FORBIDDEN"
  );

  const unresolvedDraft = diffFor({
    baseLines: [],
    pendingLines: [addOnLine({ orderAddOnId: "draft:addon-new" })],
  });
  assertEmissionError(
    () => mapWithDefaults(unresolvedDraft),
    "ORDER_COMMIT_FINANCIAL_EMISSION_UNRESOLVED_DRAFT_ID"
  );

  const brokenLinkedPair = diffFor({
    baseLines: [
      sessionConfigurationLine({
        selectionId: "selection-linked",
        unitPrice: 0,
        metadata: { orderAddOnId: "linked-addon" },
      }),
      linkedProductLine({
        selectionId: "selection-linked",
        addOnRef: "linked-addon",
        quantity: 1,
        unitPrice: 40,
        orderAddOnId: "linked-addon",
      }),
    ],
    pendingLines: [
      sessionConfigurationLine({
        selectionId: "selection-linked",
        unitPrice: 0,
        metadata: { orderAddOnId: "linked-addon" },
      }),
      linkedProductLine({
        selectionId: "selection-linked",
        addOnRef: "linked-addon",
        quantity: 2,
        unitPrice: 40,
        orderAddOnId: "linked-addon",
      }),
    ],
  });
  assertEmissionError(
    () => mapWithDefaults(brokenLinkedPair),
    "ORDER_COMMIT_LINKED_PRODUCT_PAIR_BROKEN"
  );

  const mismatchedTotals: OrderCommitSnapshotDiff = {
    ...diffFor({
      baseLines: [],
      pendingLines: [addOnLine({ orderAddOnId: "addon-1", unitPrice: 10 })],
    }),
    netDelta: 99,
  };
  assertEmissionError(
    () => mapWithDefaults(mismatchedTotals),
    "ORDER_COMMIT_FINANCIAL_EMISSION_TOTAL_MISMATCH"
  );
});

test("mapper output is deterministic and source stays pure", () => {
  const diff = diffFor({
    baseLines: [],
    pendingLines: [
      addOnLine({ orderAddOnId: "draft:addon-new", unitPrice: 10 }),
    ],
  });
  const input = {
    diff,
    baselineSource: ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT,
    draftToOrderEntityMap: new Map([["draft:addon-new", "addon-new"]]),
    openAdjustmentLinesByCause: new Map<string, OrderCommitOpenAdjustmentLine[]>(),
  };

  assert.deepEqual(
    mapOrderCommitDiffToFinancialLines(input),
    mapOrderCommitDiffToFinancialLines(input)
  );

  const source = readFileSync(
    join(
      process.cwd(),
      "src/modules/order-commits/order-commit-financial-emission.service.ts"
    ),
    "utf8"
  );

  assert.doesNotMatch(source, /@\/lib\/db|Prisma\.Decimal|pendingOpsJson/i);
  assert.doesNotMatch(source, /invoiceLineItem/i);
  assert.doesNotMatch(
    source,
    /@\/modules\/(invoices|refunds|payments)|@\/modules\/financial\/edit-classifier/
  );
  assert.doesNotMatch(source, /adjustment-workspace/i);
});

function mapWithDefaults(diff: OrderCommitSnapshotDiff) {
  return mapOrderCommitDiffToFinancialLines({
    diff,
    baselineSource: ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT,
    draftToOrderEntityMap: new Map(),
    openAdjustmentLinesByCause: new Map(),
  });
}

function assertEmissionError(
  run: () => unknown,
  code: string
): void {
  assert.throws(
    run,
    (error) =>
      error instanceof OrderCommitFinancialEmissionError &&
      error.code === code
  );
}

function openAdjustmentLine(input: {
  invoiceLineId: string;
  invoiceId: string;
  remainingAmount: number;
}): OrderCommitOpenAdjustmentLine {
  return {
    invoiceLineId: input.invoiceLineId,
    invoiceId: input.invoiceId,
    causeOrderEntityKind: OrderEntityKind.ADDON,
    causeOrderEntityId: "addon-covered",
    remainingAmount: input.remainingAmount,
    isPaid: false,
    lineSnapshot: { name: "Covered Add-on" },
  };
}

function diffFor(input: {
  baseLines: OrderCommitSnapshotLineV1[];
  pendingLines: OrderCommitSnapshotLineV1[];
}): OrderCommitSnapshotDiff {
  return diffOrderCommitSnapshots({
    baseSnapshot: snapshotFixture({ lines: input.baseLines }),
    pendingSnapshot: snapshotFixture({ lines: input.pendingLines }),
  });
}

function snapshotFixture(input: {
  lines?: OrderCommitSnapshotLineV1[];
} = {}): OrderCommitSnapshotV1 {
  const lines = input.lines ?? [];
  const subtotal = money(lines.reduce((sum, line) => sum + line.lineTotal, 0));

  return {
    schemaVersion: ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
    orderId: "order-1",
    financialCaseId: "financial-case-1",
    capturedAt: "2026-06-02T10:00:00.000Z",
    currency: ORDER_COMMIT_SNAPSHOT_CURRENCY,
    lines,
    totals: {
      subtotal,
      discountTotal: 0,
      netTotal: subtotal,
    },
  };
}

function packageLine(input: {
  orderPackageId?: string;
  catalogEntityId?: string;
  label?: string;
  quantity?: number;
  unitPrice?: number;
} = {}): OrderCommitSnapshotLineV1 {
  const orderPackageId = input.orderPackageId ?? "order-package-1";
  const quantity = input.quantity ?? 1;
  const unitPrice = input.unitPrice ?? 100;

  return {
    lineId: `package:${orderPackageId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE,
    orderEntityId: orderPackageId,
    parentOrderPackageId: null,
    catalogEntityId: input.catalogEntityId ?? "package-basic",
    stableKey: `order-package:${orderPackageId}`,
    label: input.label ?? "Basic",
    quantity,
    unitPrice,
    lineTotal: money(unitPrice * quantity),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      includedPhotoCount: 10,
      selectedPhotoCount: 10,
      extraDigitalCount: 0,
      extraPrintCount: 0,
      sessionTypeId: "session-type-1",
    },
  };
}

function addOnLine(input: {
  orderAddOnId: string;
  productId?: string;
  label?: string;
  quantity?: number;
  unitPrice?: number;
}): OrderCommitSnapshotLineV1 {
  const quantity = input.quantity ?? 1;
  const unitPrice = input.unitPrice ?? 10;

  return {
    lineId: `addon:${input.orderAddOnId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_ADD_ON,
    orderEntityId: input.orderAddOnId,
    parentOrderPackageId: "order-package-1",
    catalogEntityId: input.productId ?? "product-1",
    stableKey: `order-add-on:${input.orderAddOnId}`,
    label: input.label ?? "Add-on",
    quantity,
    unitPrice,
    lineTotal: money(unitPrice * quantity),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: { productId: input.productId ?? "product-1" },
  };
}

function packageItemUpgradeLine(input: {
  orderPackageItemUpgradeId: string;
  packageItemId?: string;
  label?: string;
  quantity?: number;
  unitPrice?: number;
}): OrderCommitSnapshotLineV1 {
  const quantity = input.quantity ?? 1;
  const unitPrice = input.unitPrice ?? 10;

  return {
    lineId: `item-upgrade:${input.orderPackageItemUpgradeId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_ITEM_UPGRADE,
    orderEntityId: input.orderPackageItemUpgradeId,
    parentOrderPackageId: "order-package-1",
    catalogEntityId: input.packageItemId ?? "package-item-1",
    stableKey: `order-package-item-upgrade:${input.orderPackageItemUpgradeId}`,
    label: input.label ?? "Item Upgrade",
    quantity,
    unitPrice,
    lineTotal: money(unitPrice * quantity),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: { packageItemId: input.packageItemId ?? "package-item-1" },
  };
}

function extraPhotoLine(input: {
  mediaType: "DIGITAL" | "PRINT";
  quantity?: number;
  unitPrice?: number;
}): OrderCommitSnapshotLineV1 {
  const quantity = input.quantity ?? 1;
  const unitPrice = input.unitPrice ?? 5;
  const mediaKey = input.mediaType.toLowerCase();

  return {
    lineId: `extra-photo:order-package-1:${mediaKey}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.SELECTED_PHOTO_EXTRA,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_PHOTO_EXTRA,
    orderEntityId: `order-package-1:${input.mediaType}`,
    parentOrderPackageId: "order-package-1",
    catalogEntityId: null,
    stableKey: `order-package:order-package-1:extra-photo:${mediaKey}`,
    label: `Extra photos - ${input.mediaType}`,
    quantity,
    unitPrice,
    lineTotal: money(unitPrice * quantity),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.SESSION_TYPE_EXTRA_PHOTO_PRICING,
    metadata: { mediaType: input.mediaType },
  };
}

function sessionConfigurationLine(input: {
  selectionId: string;
  label?: string;
  quantity?: number;
  unitPrice?: number;
  metadata?: Record<string, unknown>;
}): OrderCommitSnapshotLineV1 {
  const quantity = input.quantity ?? 1;
  const unitPrice = input.unitPrice ?? 0;

  return {
    lineId: `session-config:${input.selectionId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND
        .ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
    orderEntityId: input.selectionId,
    parentOrderPackageId: "order-package-1",
    catalogEntityId: "configuration-1",
    stableKey: `session-configuration-selection:${input.selectionId}`,
    label: input.label ?? "Session Configuration",
    quantity,
    unitPrice,
    lineTotal: money(unitPrice * quantity),
    priceSource:
      ORDER_COMMIT_PRICE_SOURCE.SESSION_CONFIGURATION_SELECTION_SNAPSHOT,
    metadata: input.metadata ?? { configurationId: "configuration-1" },
  };
}

function linkedProductLine(input: {
  selectionId: string;
  addOnRef: string;
  label?: string;
  quantity?: number;
  unitPrice?: number;
  orderAddOnId?: string;
  draftOrderAddOnId?: string;
  metadata?: Record<string, unknown>;
}): OrderCommitSnapshotLineV1 {
  const quantity = input.quantity ?? 1;
  const unitPrice = input.unitPrice ?? 10;

  return {
    lineId: `session-config:${input.selectionId}:addon:${input.addOnRef}`,
    lineKind:
      ORDER_COMMIT_SNAPSHOT_LINE_KIND
        .LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND
        .ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
    orderEntityId: input.selectionId,
    parentOrderPackageId: "order-package-1",
    catalogEntityId: "product-linked",
    stableKey: `session-configuration-selection:${input.selectionId}:add-on:${input.addOnRef}`,
    label: input.label ?? "Linked Product",
    quantity,
    unitPrice,
    lineTotal: money(unitPrice * quantity),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: input.metadata ?? {
      configurationId: "configuration-linked",
      productId: "product-linked",
      orderAddOnId: input.orderAddOnId ?? null,
      ...(input.draftOrderAddOnId
        ? { draftOrderAddOnId: input.draftOrderAddOnId }
        : {}),
    },
  };
}

function money(value: number): number {
  return Number(value.toFixed(3));
}
