import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PREVIEW_BASELINE_SOURCE,
  ORDER_COMMIT_PREVIEW_COMMIT_KIND,
  ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND,
  ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND,
  ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
  orderCommitPreviewBaselineSchema,
  orderCommitPreviewClassificationSchema,
  orderCommitPreviewLineDiffSchema,
  orderCommitPreviewSchema,
  orderCommitSnapshotDiffSchema,
} from "@/modules/order-commits";

const operationalFlags = {
  isPackageChange: true,
  isPackageUpgrade: true,
  isPackageDowngrade: false,
  isPackageSwap: true,
  isAddOnChange: false,
  isPackageItemUpgradeChange: false,
  isPhotoChange: false,
  isSessionConfigurationChange: false,
  isLinkedProductChange: false,
  isFinanciallyRelevant: true,
  isOperationallyMeaningful: true,
};

test("order commit preview baseline contract exposes Phase 3 source metadata", () => {
  const parsed = orderCommitPreviewBaselineSchema.parse({
    baselineSource: ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT,
    baselineCommitId: "commit-1",
    baselineSequence: 3,
    snapshot: snapshot({ netTotal: 100 }),
  });

  assert.equal(parsed.baselineSource, "LATEST_ORDER_COMMIT");
  assert.equal(parsed.baselineCommitId, "commit-1");
  assert.equal(parsed.snapshot.lines.length, 1);
});

test("order commit preview line diff contract uses snapshot identity and raw money", () => {
  const parsed = orderCommitPreviewLineDiffSchema.parse(lineDiff());

  assert.equal(parsed.stableKey, "order-package:order-package-1");
  assert.equal(parsed.changeKind, "PACKAGE_CHANGED");
  assert.equal(parsed.moneyDelta, 80);
  assert.equal(parsed.operationalFlags.isPackageUpgrade, true);
});

test("order commit snapshot diff contract has no pending operation source field", () => {
  const parsed = orderCommitSnapshotDiffSchema.parse({
    orderId: "order-1",
    financialCaseId: "financial-case-1",
    currency: "KWD",
    lineDiffs: [lineDiff()],
    netDelta: 80,
    zeroNetReason: null,
  });

  assert.equal(parsed.netDelta, 80);
  assert.equal("pendingOpsJson" in parsed, false);
});

test("order commit preview classification contract separates operational output", () => {
  const parsed = orderCommitPreviewClassificationSchema.parse({
    commitKind: ORDER_COMMIT_PREVIEW_COMMIT_KIND.ADJUSTMENT_INVOICE,
    lineDiffs: [lineDiff()],
    netDelta: 80,
    operationalFlags,
    zeroNetReason: null,
  });

  assert.equal(parsed.commitKind, "ADJUSTMENT_INVOICE");
  assert.equal(parsed.lineDiffs[0]?.operationalFlags.isPackageChange, true);
});

test("order commit preview DTO includes approval, document, payment, and refund contracts", () => {
  const parsed = orderCommitPreviewSchema.parse({
    baselineSource: ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.ORIGINAL_ORDER_COMPOSITION,
    baselineCommitId: null,
    baselineSequence: null,
    draftId: "draft-1",
    draftVersion: 2,
    commitKind: ORDER_COMMIT_PREVIEW_COMMIT_KIND.BASE_INVOICE,
    lineDiffs: [lineDiff()],
    netDelta: 80,
    requiresApproval: false,
    approvalReasons: [],
    documentPlan: {
      kind: ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.BASE_INVOICE,
      amount: 80,
      requiresPaymentCollection: true,
      requiresRefundReview: false,
      reason: null,
    },
    paymentImpact: {
      kind: ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND.PAYMENT_DUE,
      amountDue: 80,
      creditAmount: 0,
      alreadyPaidAmount: 0,
      remainingAfterCommit: 80,
    },
    refundImpact: {
      refundRequired: false,
      refundableAmount: 0,
      creditNoteAmount: 0,
      reason: null,
    },
    zeroNetReason: null,
  });

  assert.equal(parsed.draftId, "draft-1");
  assert.equal(parsed.documentPlan.kind, "BASE_INVOICE");
  assert.equal(parsed.paymentImpact.amountDue, 80);
});

test("preview contract modules avoid invoice lines, mutation services, and legacy public naming", () => {
  const sources = listSourceFiles("src/modules/order-commits")
    .filter((file) => /preview/.test(file))
    .map((file) => ({
      file,
      source: readFileSync(join(process.cwd(), file), "utf8"),
    }));

  const invoiceLineReads = sources
    .filter(({ source }) => /invoiceLineItem/i.test(source))
    .map(({ file }) => file);
  const forbiddenMutationImports = sources
    .filter(({ source }) =>
      /from\s+["'][^"']*(adjustment-workspace|invoice\.service|payment\.service|refund)[^"']*["']/i.test(
        source
      )
    )
    .map(({ file }) => file);
  const publicWorkspaceNaming = sources
    .filter(({ source }) => /AdjustmentWorkspace/.test(source))
    .map(({ file }) => file);

  assert.deepEqual(invoiceLineReads, []);
  assert.deepEqual(forbiddenMutationImports, []);
  assert.deepEqual(publicWorkspaceNaming, []);
});

function snapshot({ netTotal }: { netTotal: number }) {
  return {
    schemaVersion: "order_commit_snapshot_v1",
    orderId: "order-1",
    financialCaseId: "financial-case-1",
    capturedAt: "2026-06-02T10:00:00.000Z",
    currency: "KWD",
    lines: [lineSummary({ lineTotal: netTotal })],
    totals: {
      subtotal: netTotal,
      discountTotal: 0,
      netTotal,
    },
  };
}

function lineDiff() {
  return {
    stableKey: "order-package:order-package-1",
    lineId: "line-package-1",
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
    changeKind: ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.PACKAGE_CHANGED,
    baselineLine: lineSummary({ label: "Basic Package", lineTotal: 100 }),
    pendingLine: lineSummary({ label: "Premium Package", lineTotal: 180 }),
    quantityDelta: 0,
    moneyDelta: 80,
    operationalFlags,
  };
}

function lineSummary({
  label = "Basic Package",
  lineTotal,
}: {
  label?: string;
  lineTotal: number;
}) {
  return {
    stableKey: "order-package:order-package-1",
    lineId: "line-package-1",
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE,
    orderEntityId: "order-package-1",
    parentOrderPackageId: null,
    catalogEntityId: "package-1",
    label,
    quantity: 1,
    unitPrice: lineTotal,
    lineTotal,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: { sortOrder: 0 },
  };
}

function listSourceFiles(relativePath: string): string[] {
  const absolutePath = join(process.cwd(), relativePath);
  const stat = statSync(absolutePath);
  if (stat.isFile()) {
    return /\.(?:ts|tsx)$/.test(relativePath) ? [relativePath] : [];
  }

  return readdirSync(absolutePath).flatMap((entry) =>
    listSourceFiles(join(relativePath, entry))
  );
}
