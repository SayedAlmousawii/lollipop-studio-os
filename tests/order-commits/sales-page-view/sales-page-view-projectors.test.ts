import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { InvoiceStatus, InvoiceType } from "@prisma/client";
import {
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND,
  ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND,
  ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_CURRENCY,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
  ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
  type OrderCommitPreview,
  type OrderCommitPreviewLineDiff,
  type OrderCommitSnapshotLineV1,
  type OrderCommitSnapshotV1,
} from "@/modules/order-commits";
import {
  toSalesPageComposition,
} from "@/modules/order-commits/projections/to-sales-page-composition";
import { toSalesPageFinancialPreview } from "@/modules/order-commits/projections/to-sales-page-financial-preview";
import { toSalesPageStagedChanges } from "@/modules/order-commits/projections/to-sales-page-staged-changes";
import type { FinancialCaseSummary } from "@/modules/financial-cases/financial-case-summary.types";
import type { DraftPOSCompositionProjection } from "@/modules/orders/composition/projections/to-draft-pos-composition";

const PROJECTOR_FILES = [
  "src/modules/order-commits/projections/to-sales-page-composition.ts",
  "src/modules/order-commits/projections/to-sales-page-staged-changes.ts",
  "src/modules/order-commits/projections/to-sales-page-financial-preview.ts",
];

const NEW_PROJECTION_FILES = [
  ...PROJECTOR_FILES,
  "src/modules/order-commits/projections/sales-page-view.types.ts",
  "src/modules/order-commits/projections/sales-page-view.loader.ts",
  "src/modules/order-commits/projections/index.ts",
];

test("sales page projectors stay pure and service-free", () => {
  const forbiddenLegacyName = ["Adjustment", "Workspace"].join("");

  for (const file of PROJECTOR_FILES) {
    const source = readFileSync(join(process.cwd(), file), "utf8");

    assert.doesNotMatch(source, /@\/lib\/db/);
    assert.doesNotMatch(source, /from\s+["'][^"']*\.service["']/);
    assert.doesNotMatch(source, /from\s+["'][^"']*\/order\.service["']/);
    assert.doesNotMatch(source, /export\s+async\s+function/);
    assert.doesNotMatch(source, /\bfetch\s*\(/);
  }

  for (const file of NEW_PROJECTION_FILES) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    assert.equal(
      source.includes(forbiddenLegacyName),
      false,
      `${file} should not expose legacy workspace naming`
    );
  }
});

test("composition projector selects current source without draft snapshot", () => {
  const currentComposition = currentCompositionFixture({
    orderId: "order-current",
    packageName: "Current Package",
    netCompositionTotal: 111,
  });

  const projected = toSalesPageComposition({
    draftSnapshot: null,
    currentComposition,
  });

  assert.equal(projected.source, "current");
  assert.deepEqual(projected.packageLines, currentComposition.packageLines);
  assert.equal(projected.totals.netCompositionTotal, 111);
});

test("composition projector maps draft snapshot lines as projected source", () => {
  const draftSnapshot = snapshotFixture({
    lines: [
      packageLine({
        lineId: "package:draft-package-1",
        orderEntityId: "draft:package-1",
        catalogEntityId: "package-premium",
        label: "Premium Package",
        lineTotal: 180,
        metadata: {
          includedPhotoCount: 10,
          selectedPhotoCount: 13,
          sessionTypeId: "session-type-1",
          sessionTypeName: "Portrait",
        },
      }),
      packageItemLine({
        orderEntityId: "draft:item-upgrade-1",
        parentOrderPackageId: "draft:package-1",
        label: "Atelier Album",
        lineTotal: 25,
      }),
      extraPhotoLine({
        parentOrderPackageId: "draft:package-1",
        mediaType: "DIGITAL",
        quantity: 3,
        unitPrice: 5,
      }),
      extraPhotoLine({
        parentOrderPackageId: "draft:package-1",
        mediaType: "PRINT",
        quantity: 2,
        unitPrice: 4,
      }),
      addOnLine({
        orderEntityId: "draft:addon-1",
        label: "Canvas",
        lineTotal: 30,
      }),
      sessionConfigurationLine({
        parentOrderPackageId: "draft:package-1",
        label: "Backdrop",
        lineTotal: 7,
      }),
      linkedProductSessionConfigurationAddOnLine({
        parentOrderPackageId: "draft:package-1",
        label: "Linked album",
        lineTotal: 6,
      }),
    ],
    netTotal: 242,
  });

  const projected = toSalesPageComposition({
    draftSnapshot,
    currentComposition: currentCompositionFixture({ netCompositionTotal: 100 }),
  });

  assert.equal(projected.source, "projected");
  assert.equal(projected.orderId, "order-1");
  assert.equal(projected.totals.netCompositionTotal, 242);
  assert.equal(projected.packageLines[0]?.orderPackageId, "draft:package-1");
  assert.equal(projected.packageLines[0]?.packageName, "Premium Package");
  assert.equal(projected.packageLines[0]?.selectedPhotoCount, 13);
  assert.equal(projected.packageLines[0]?.extraDigitalCount, 3);
  assert.equal(projected.packageLines[0]?.extraPrintCount, 2);
  assert.equal(projected.packageLines[0]?.extraPhotoTotal, 23);
  assert.equal(projected.packageLines[0]?.upgradeDelta, 25);
  assert.equal(projected.packageLines[0]?.packageSubtotal, 241);
  assert.equal(projected.packageLines[0]?.packageItems[0]?.id, "draft:item-upgrade-1");
  assert.equal(projected.addOns[0]?.orderAddOnId, "draft:addon-1");
  assert.equal(projected.sessionConfigurations[0]?.priceDelta, 7);
  assert.deepEqual(projected.totals, {
    packageBaseTotal: 180,
    packageUpgradeDeltaTotal: 25,
    deliverablesTotal: 0,
    addOnTotal: 30,
    extraPhotoTotal: 23,
    sessionConfigurationTotal: 13,
    netCompositionTotal: 242,
  });
});

test("composition projector derives projected totals only from snapshot fields", () => {
  const draftSnapshot = snapshotFixture({
    lines: [
      packageLine({ lineTotal: 100.123 }),
      packageItemLine({ lineTotal: 25, parentOrderPackageId: "order-package-1" }),
      addOnLine({ lineTotal: 30.111 }),
      extraPhotoLine({
        parentOrderPackageId: "order-package-1",
        mediaType: "DIGITAL",
        quantity: 1,
        unitPrice: 5,
      }),
      sessionConfigurationLine({
        parentOrderPackageId: "order-package-1",
        lineTotal: 7.222,
      }),
      linkedProductSessionConfigurationAddOnLine({
        parentOrderPackageId: "order-package-1",
        lineTotal: 6.333,
      }),
    ],
    netTotal: 456.789,
  });

  const projected = toSalesPageComposition({
    draftSnapshot,
    currentComposition: currentCompositionFixture({
      totals: {
        packageBaseTotal: 999,
        packageUpgradeDeltaTotal: 999,
        deliverablesTotal: 999,
        addOnTotal: 999,
        extraPhotoTotal: 999,
        sessionConfigurationTotal: 999,
        netCompositionTotal: 999,
      },
    }),
  });

  assert.equal(projected.packageLines[0]?.packageSubtotal, 143.678);
  assert.deepEqual(projected.totals, {
    packageBaseTotal: 100.123,
    packageUpgradeDeltaTotal: 25,
    deliverablesTotal: 0,
    addOnTotal: 30.111,
    extraPhotoTotal: 5,
    sessionConfigurationTotal: 13.555,
    netCompositionTotal: 456.789,
  });
});

test("staged changes projector preserves diff deltas and presentational order", () => {
  const preview = previewFixture({
    lineDiffs: [
      lineDiff({
        stableKey: "remove-1",
        changeKind: ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.REMOVED,
        moneyDelta: -9.125,
        baselineLabel: "Removed add-on",
        parentLabel: "Package B",
      }),
      lineDiff({
        stableKey: "change-1",
        changeKind: ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.PRICE_CHANGED,
        moneyDelta: 2.25,
        baselineLabel: "Album cover",
        pendingLabel: "Atelier leather",
        parentLabel: "Package A",
      }),
      lineDiff({
        stableKey: "add-1",
        changeKind: ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.ADDED,
        moneyDelta: 11.875,
        pendingLabel: "Added canvas",
        parentLabel: "Package C",
      }),
    ],
  });

  const rows = toSalesPageStagedChanges({ preview });

  assert.deepEqual(
    rows.map((row) => row.id),
    ["add-1", "change-1", "remove-1"]
  );
  assert.deepEqual(
    rows.map((row) => row.netDelta),
    [11.875, 2.25, -9.125]
  );
  assert.equal(rows[1]?.label, "Album cover -> Atelier leather");
});

test("staged changes projector prefers package labels before raw parent ids", () => {
  const childWithoutParentLabel = lineDiff({
    stableKey: "addon-child",
    changeKind: ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.ADDED,
    moneyDelta: 12,
    pendingLabel: "Gift frame",
  });
  childWithoutParentLabel.pendingLine = lineSummary({
    label: "Gift frame",
    lineTotal: 12,
    parentOrderPackageId: "order-package-labeled",
  });

  const fallbackChild = lineDiff({
    stableKey: "addon-fallback",
    changeKind: ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.ADDED,
    moneyDelta: 8,
    pendingLabel: "Loose print",
  });
  fallbackChild.pendingLine = lineSummary({
    label: "Loose print",
    lineTotal: 8,
    parentOrderPackageId: "order-package-unlabeled",
  });

  const packageDiff = lineDiff({
    stableKey: "package-labeled",
    changeKind: ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.PRICE_CHANGED,
    moneyDelta: 0,
    pendingLabel: "Signature Package",
  });
  packageDiff.pendingLine = lineSummary({
    label: "Signature Package",
    lineTotal: 100,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
    orderEntityId: "order-package-labeled",
    parentOrderPackageId: null,
  });

  const rows = toSalesPageStagedChanges({
    preview: previewFixture({
      lineDiffs: [childWithoutParentLabel, fallbackChild, packageDiff],
    }),
  });

  assert.equal(
    rows.find((row) => row.id === "addon-child")?.parentLabel,
    "Signature Package"
  );
  assert.equal(
    rows.find((row) => row.id === "addon-fallback")?.parentLabel,
    "order-package-unlabeled"
  );
});

test("staged changes projector drops unchanged restored package diffs", () => {
  const rows = toSalesPageStagedChanges({
    preview: previewFixture({
      netDelta: 0,
      lineDiffs: [
        lineDiff({
          stableKey: "order-package:order-package-1",
          changeKind: ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.UNCHANGED,
          moneyDelta: 0,
          baselineLabel: "Basic",
          pendingLabel: "Basic",
        }),
      ],
    }),
  });

  assert.deepEqual(rows, []);
});

test("financial preview passes through financial case and preview fields", () => {
  const financialCase = activeFinancialCase({
    customerTotal: 321,
    finalTotal: 300,
    depositApplied: 50,
    paidSoFar: 125,
    effectivePaid: 140,
    remaining: 176,
  });
  const preview = previewFixture({
    netDelta: 44,
    documentPlan: {
      kind: ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.FINAL_INVOICE_REBUILD,
      amount: 44,
      requiresPaymentCollection: true,
      requiresRefundReview: false,
      reason: null,
    },
  });

  const projected = toSalesPageFinancialPreview({ preview, financialCase });

  assert.equal(projected.baseline.customerTotal, 321);
  assert.equal(projected.baseline.finalTotal, 300);
  assert.equal(projected.baseline.depositApplied, 50);
  assert.equal(projected.baseline.paidSoFar, 125);
  assert.equal(projected.baseline.effectivePaid, 140);
  assert.equal(projected.baseline.remaining, 176);
  assert.equal(projected.baseline.outstandingAmount, 176);
  assert.equal(projected.baseline.totalAdjustments, 0);
  assert.deepEqual(projected.baseline.finalizedAdjustments, []);
  assert.deepEqual(projected.baseline.creditNotes, []);
  assert.deepEqual(projected.baseline.refunds, []);
  assert.equal(projected.baseline.isFullySettled, false);
  assert.equal(projected.baseline.collectPaymentTargetInvoiceId, "final-1");
  assert.equal(projected.overlay.pendingDelta, 44);
  assert.equal(projected.overlay.previousTotal, 100);
  assert.equal(projected.overlay.pendingTotal, 144);
  assert.equal(projected.overlay.documentPlan, preview.documentPlan);
  assert.equal(
    projected.overlay.documentPlan?.kind,
    ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.FINAL_INVOICE_REBUILD
  );
  assert.equal(projected.overlay.paymentImpact, preview.paymentImpact);
  assert.equal(projected.overlay.refundImpact, preview.refundImpact);

  const unrelatedMutation = previewFixture({
    netDelta: 44,
    lineDiffs: [
      lineDiff({
        stableKey: "unrelated",
        moneyDelta: 999,
        pendingLabel: "Unrelated",
      }),
    ],
  });
  const unchanged = toSalesPageFinancialPreview({
    preview: unrelatedMutation,
    financialCase,
  });
  assert.equal(unchanged.overlay.pendingDelta, 44);
  assert.equal(unchanged.overlay.previousTotal, 100);
  assert.equal(unchanged.overlay.pendingTotal, 144);
  assert.equal(unchanged.baseline.remaining, 176);
});

test("financial preview targets open adjustments when the final invoice is settled", () => {
  const openAdjustment = {
    id: "adjustment-open-1",
    invoiceNumber: "ADJ-1",
    invoiceType: InvoiceType.ADJUSTMENT,
    total: 42,
    remaining: 42,
    status: InvoiceStatus.ISSUED,
    isLocked: true,
  };
  const financialCase = activeFinancialCase({
    finalInvoice: {
      id: "final-1",
      invoiceNumber: "INV-1",
      invoiceType: InvoiceType.FINAL,
      total: 300,
      remaining: 0,
      status: InvoiceStatus.CLOSED,
      isLocked: true,
      depositPaidAmount: 50,
    },
    finalizedAdjustments: [openAdjustment],
    customerTotal: 342,
    totalAdjustments: 42,
    remaining: 42,
    paymentStatusEnum: "PARTIAL",
  });

  const projected = toSalesPageFinancialPreview({
    preview: null,
    financialCase,
  });

  assert.equal(projected.baseline.outstandingAmount, 42);
  assert.equal(projected.baseline.isFullySettled, false);
  assert.deepEqual(projected.baseline.finalizedAdjustments, [openAdjustment]);
  assert.equal(
    projected.baseline.collectPaymentTargetInvoiceId,
    "adjustment-open-1"
  );
});

test("financial preview marks paid cases as fully settled", () => {
  const projected = toSalesPageFinancialPreview({
    preview: null,
    financialCase: activeFinancialCase({
      finalInvoice: {
        id: "final-1",
        invoiceNumber: "INV-1",
        invoiceType: InvoiceType.FINAL,
        total: 300,
        remaining: 0,
        status: InvoiceStatus.CLOSED,
        isLocked: true,
        depositPaidAmount: 50,
      },
      remaining: 0,
      paymentStatusEnum: "PAID",
    }),
  });

  assert.equal(projected.baseline.isFullySettled, true);
  assert.equal(projected.baseline.collectPaymentTargetInvoiceId, null);
});

test("financial preview supports booking-stage baseline without synthetic final totals", () => {
  const projected = toSalesPageFinancialPreview({
    preview: null,
    financialCase: bookingFinancialCase(),
  });

  assert.equal(projected.baseline.stage, "booking");
  assert.equal(projected.baseline.customerTotal, null);
  assert.equal(projected.baseline.finalInvoice, null);
  assert.deepEqual(projected.baseline.finalizedAdjustments, []);
  assert.deepEqual(projected.baseline.creditNotes, []);
  assert.deepEqual(projected.baseline.refunds, []);
  assert.equal(projected.baseline.outstandingAmount, null);
  assert.equal(projected.baseline.totalAdjustments, null);
  assert.equal(projected.baseline.isFullySettled, false);
  assert.equal(projected.baseline.collectPaymentTargetInvoiceId, null);
  assert.equal(projected.overlay.pendingDelta, null);
});

function currentCompositionFixture(
  overrides: Partial<DraftPOSCompositionProjection> & {
    packageName?: string;
    netCompositionTotal?: number;
  } = {}
): DraftPOSCompositionProjection {
  const netCompositionTotal = overrides.netCompositionTotal ?? 100;
  return {
    orderId: overrides.orderId ?? "order-1",
    jobNumber: overrides.jobNumber ?? "JOB-1",
    sourceState: overrides.sourceState ?? "draft",
    packageLines: overrides.packageLines ?? [
      {
        id: "package:current-package-1",
        orderPackageId: "current-package-1",
        packageId: "package-basic",
        packageName: overrides.packageName ?? "Basic Package",
        packagePrice: netCompositionTotal,
        sessionTypeId: "session-type-1",
        sessionTypeName: "Portrait",
        includedPhotoCount: 10,
        selectedPhotoCount: 10,
        extraDigitalCount: 0,
        extraPrintCount: 0,
        extraPhotoCount: 0,
        extraDigitalUnitPrice: 0,
        extraPrintUnitPrice: 0,
        extraPhotoTotal: 0,
        packageSubtotal: netCompositionTotal,
        upgradeDelta: 0,
        packageItems: [],
      },
    ],
    addOns: overrides.addOns ?? [],
    sessionConfigurations: overrides.sessionConfigurations ?? [],
    totals: overrides.totals ?? {
      packageBaseTotal: netCompositionTotal,
      packageUpgradeDeltaTotal: 0,
      deliverablesTotal: 0,
      addOnTotal: 0,
      extraPhotoTotal: 0,
      sessionConfigurationTotal: 0,
      netCompositionTotal,
    },
  };
}

function snapshotFixture(input: {
  lines: OrderCommitSnapshotLineV1[];
  netTotal: number;
}): OrderCommitSnapshotV1 {
  return {
    schemaVersion: ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
    orderId: "order-1",
    financialCaseId: "financial-case-1",
    capturedAt: "2026-06-02T10:00:00.000Z",
    currency: ORDER_COMMIT_SNAPSHOT_CURRENCY,
    lines: input.lines,
    totals: {
      subtotal: input.netTotal,
      discountTotal: 0,
      netTotal: input.netTotal,
    },
  };
}

function packageLine(
  input: Partial<OrderCommitSnapshotLineV1> = {}
): OrderCommitSnapshotLineV1 {
  return snapshotLine({
    lineId: "package:order-package-1",
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE,
    orderEntityId: "order-package-1",
    catalogEntityId: "package-basic",
    stableKey: "order-package:order-package-1",
    label: "Basic Package",
    quantity: 1,
    unitPrice: 100,
    lineTotal: 100,
    metadata: { includedPhotoCount: 10, selectedPhotoCount: 10 },
    ...input,
  });
}

function packageItemLine(
  input: Partial<OrderCommitSnapshotLineV1> = {}
): OrderCommitSnapshotLineV1 {
  return snapshotLine({
    lineId: "item-upgrade:draft:item-upgrade-1",
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_ITEM_UPGRADE,
    orderEntityId: "draft:item-upgrade-1",
    parentOrderPackageId: "order-package-1",
    catalogEntityId: "package-item-1",
    stableKey: "order-package-item-upgrade:draft:item-upgrade-1",
    label: "Album",
    quantity: 1,
    unitPrice: 25,
    lineTotal: 25,
    metadata: { categoryLabel: "Album" },
    ...input,
  });
}

function extraPhotoLine(input: {
  parentOrderPackageId: string;
  mediaType: "DIGITAL" | "PRINT";
  quantity: number;
  unitPrice: number;
}): OrderCommitSnapshotLineV1 {
  return snapshotLine({
    lineId: `extra-photo:${input.parentOrderPackageId}:${input.mediaType.toLowerCase()}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.SELECTED_PHOTO_EXTRA,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_PHOTO_EXTRA,
    orderEntityId: `${input.parentOrderPackageId}:${input.mediaType}`,
    parentOrderPackageId: input.parentOrderPackageId,
    catalogEntityId: null,
    stableKey: `order-package:${input.parentOrderPackageId}:extra-photo:${input.mediaType.toLowerCase()}`,
    label: `Extra photos - ${input.mediaType}`,
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    lineTotal: input.quantity * input.unitPrice,
    metadata: { mediaType: input.mediaType },
  });
}

function addOnLine(
  input: Partial<OrderCommitSnapshotLineV1> = {}
): OrderCommitSnapshotLineV1 {
  return snapshotLine({
    lineId: "addon:draft:addon-1",
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_ADD_ON,
    orderEntityId: "draft:addon-1",
    catalogEntityId: "product-canvas",
    stableKey: "order-add-on:draft:addon-1",
    label: "Canvas",
    quantity: 1,
    unitPrice: 30,
    lineTotal: 30,
    metadata: { draftOrderAddOnId: "draft:addon-1" },
    ...input,
  });
}

function sessionConfigurationLine(
  input: Partial<OrderCommitSnapshotLineV1> = {}
): OrderCommitSnapshotLineV1 {
  return snapshotLine({
    lineId: "session-configuration:draft:selection-1",
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
    orderEntityId: "draft:selection-1",
    parentOrderPackageId: "order-package-1",
    catalogEntityId: "configuration-1",
    stableKey: "order-package:order-package-1:session-configuration:configuration-1",
    label: "Backdrop",
    quantity: 1,
    unitPrice: 7,
    lineTotal: 7,
    metadata: { configurationId: "configuration-1", optionLabel: "Blue" },
    ...input,
  });
}

function linkedProductSessionConfigurationAddOnLine(
  input: Partial<OrderCommitSnapshotLineV1> = {}
): OrderCommitSnapshotLineV1 {
  return snapshotLine({
    lineId: "linked-product:draft:selection-1",
    lineKind:
      ORDER_COMMIT_SNAPSHOT_LINE_KIND
        .LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
    orderEntityId: "draft:selection-1",
    parentOrderPackageId: "order-package-1",
    catalogEntityId: "linked-product-1",
    stableKey:
      "order-package:order-package-1:session-configuration:configuration-1:linked-product",
    label: "Linked album",
    quantity: 1,
    unitPrice: 6,
    lineTotal: 6,
    metadata: { configurationId: "configuration-1", linkedProductId: "linked-product-1" },
    ...input,
  });
}

function snapshotLine(
  input: Partial<OrderCommitSnapshotLineV1> &
    Pick<
      OrderCommitSnapshotLineV1,
      | "lineId"
      | "lineKind"
      | "orderEntityKind"
      | "orderEntityId"
      | "catalogEntityId"
      | "stableKey"
      | "label"
      | "quantity"
      | "unitPrice"
      | "lineTotal"
      | "metadata"
    >
): OrderCommitSnapshotLineV1 {
  return {
    parentOrderPackageId: null,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    ...input,
  };
}

function previewFixture(
  input: Partial<OrderCommitPreview> = {}
): OrderCommitPreview {
  return {
    baselineSource: "LATEST_ORDER_COMMIT",
    baselineCommitId: "commit-1",
    baselineSequence: 1,
    draftId: "draft-1",
    draftVersion: 2,
    commitKind: "ADJUSTMENT_INVOICE",
    lineDiffs: input.lineDiffs ?? [lineDiff({ moneyDelta: input.netDelta ?? 10 })],
    netDelta: input.netDelta ?? 10,
    totals: input.totals ?? {
      baselineTotal: 100,
      netDelta: input.netDelta ?? 10,
      pendingTotal: 100 + (input.netDelta ?? 10),
    },
    requiresApproval: input.requiresApproval ?? false,
    approvalReasons: input.approvalReasons ?? [],
    documentPlan: input.documentPlan ?? {
      kind: ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.ADJUSTMENT_INVOICE,
      amount: input.netDelta ?? 10,
      requiresPaymentCollection: true,
      requiresRefundReview: false,
      reason: null,
    },
    paymentImpact: input.paymentImpact ?? {
      kind: ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND.PAYMENT_DUE,
      amountDue: input.netDelta ?? 10,
      creditAmount: 0,
      alreadyPaidAmount: 0,
      remainingAfterCommit: input.netDelta ?? 10,
    },
    refundImpact: input.refundImpact ?? {
      refundRequired: false,
      refundableAmount: 0,
      creditNoteAmount: 0,
      reason: null,
    },
    zeroNetReason: input.zeroNetReason ?? null,
  };
}

function lineDiff(input: {
  stableKey?: string;
  changeKind?: OrderCommitPreviewLineDiff["changeKind"];
  moneyDelta?: number;
  baselineLabel?: string;
  pendingLabel?: string;
  parentLabel?: string;
}): OrderCommitPreviewLineDiff {
  return {
    stableKey: input.stableKey ?? "line-1",
    lineId: input.stableKey ?? "line-1",
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON,
    changeKind: input.changeKind ?? ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.ADDED,
    baselineLine: input.baselineLabel
      ? lineSummary({
          label: input.baselineLabel,
          lineTotal: 0,
          parentLabel: input.parentLabel,
        })
      : null,
    pendingLine: input.pendingLabel
      ? lineSummary({
          label: input.pendingLabel,
          lineTotal: input.moneyDelta ?? 0,
          parentLabel: input.parentLabel,
        })
      : null,
    quantityDelta: 0,
    moneyDelta: input.moneyDelta ?? 0,
    operationalFlags: {
      isPackageChange: false,
      isPackageUpgrade: false,
      isPackageDowngrade: false,
      isPackageSwap: false,
      isAddOnChange: true,
      isPackageItemUpgradeChange: false,
      isPhotoChange: false,
      isSessionConfigurationChange: false,
      isLinkedProductChange: false,
      isFinanciallyRelevant: true,
      isOperationallyMeaningful: true,
    },
  };
}

function lineSummary(input: {
  label: string;
  lineTotal: number;
  parentLabel?: string;
  lineKind?: OrderCommitSnapshotLineV1["lineKind"];
  orderEntityId?: string;
  parentOrderPackageId?: string | null;
}) {
  return {
    stableKey: "summary-1",
    lineId: "summary-1",
    lineKind: input.lineKind ?? ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_ADD_ON,
    orderEntityId: input.orderEntityId ?? "addon-1",
    parentOrderPackageId:
      input.parentOrderPackageId === undefined
        ? "order-package-1"
        : input.parentOrderPackageId,
    catalogEntityId: "product-1",
    label: input.label,
    quantity: 1,
    unitPrice: input.lineTotal,
    lineTotal: input.lineTotal,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: input.parentLabel ? { parentLabel: input.parentLabel } : {},
  };
}

function activeFinancialCase(
  input: Partial<Extract<FinancialCaseSummary, { stage: "active" }>> = {}
): Extract<FinancialCaseSummary, { stage: "active" }> {
  return {
    stage: "active",
    financialCaseId: "financial-case-1",
    orderId: "order-1",
    bookingId: "booking-1",
    depositInvoice: {
      id: "deposit-1",
      invoiceNumber: "DEP-1",
      total: 50,
      status: InvoiceStatus.PAID,
      isLocked: true,
      paidAmount: 50,
    },
    finalInvoice: {
      id: "final-1",
      invoiceNumber: "INV-1",
      invoiceType: InvoiceType.FINAL,
      total: 300,
      remaining: 176,
      status: InvoiceStatus.ISSUED,
      isLocked: true,
      depositPaidAmount: 50,
    },
    finalizedAdjustments: [],
    creditNotes: [],
    refunds: [],
    customerTotal: 300,
    effectivePaid: 124,
    paidSoFar: 124,
    depositApplied: 50,
    remaining: 176,
    totalAdjustments: 0,
    finalTotal: 300,
    overpaymentCapacity: 0,
    creditNoteCapacity: 0,
    linkedDocuments: [],
    paymentStatusEnum: "PARTIAL",
    ...input,
  };
}

function bookingFinancialCase(): Extract<FinancialCaseSummary, { stage: "booking" }> {
  return {
    stage: "booking",
    financialCaseId: "financial-case-booking",
    bookingId: "booking-1",
    depositInvoice: null,
    depositPaid: false,
    awaitingFinalInvoiceAfterCheckIn: false,
    finalInvoicePending: true,
    linkedDocuments: [],
  };
}
