import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  buildOrderCommitApprovalAndDocumentPreview,
  ORDER_COMMIT_PREVIEW_BASELINE_SOURCE,
  ORDER_COMMIT_PREVIEW_COMMIT_KIND,
  ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND,
  ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND,
  type OrderCommitPreviewClassification,
  type OrderCommitPreviewOperationalFlags,
} from "@/modules/order-commits";

test("approval preview maps first positive delta to base invoice payment due", () => {
  const preview = buildOrderCommitApprovalAndDocumentPreview({
    baselineSource: ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.ORIGINAL_ORDER_COMPOSITION,
    classification: classificationFixture({
      commitKind: ORDER_COMMIT_PREVIEW_COMMIT_KIND.ADJUSTMENT_INVOICE,
      netDelta: 80,
    }),
    paymentState: paymentStateFixture({ currentRemainingAmount: 0 }),
  });

  assert.equal(preview.requiresApproval, false);
  assert.deepEqual(preview.approvalReasons, []);
  assert.equal(
    preview.documentPlan.kind,
    ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.BASE_INVOICE
  );
  assert.equal(preview.documentPlan.amount, 80);
  assert.equal(preview.documentPlan.requiresPaymentCollection, true);
  assert.equal(
    preview.paymentImpact.kind,
    ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND.PAYMENT_DUE
  );
  assert.equal(preview.paymentImpact.amountDue, 80);
  assert.equal(preview.paymentImpact.remainingAfterCommit, 80);
  assert.equal(preview.refundImpact.refundRequired, false);
});

test("approval preview maps later positive delta to adjustment invoice", () => {
  const preview = buildOrderCommitApprovalAndDocumentPreview({
    baselineSource: ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT,
    classification: classificationFixture({
      commitKind: ORDER_COMMIT_PREVIEW_COMMIT_KIND.ADJUSTMENT_INVOICE,
      netDelta: 25,
    }),
    paymentState: paymentStateFixture({ currentRemainingAmount: 10 }),
  });

  assert.equal(
    preview.documentPlan.kind,
    ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.ADJUSTMENT_INVOICE
  );
  assert.equal(preview.documentPlan.amount, 25);
  assert.equal(preview.paymentImpact.amountDue, 25);
  assert.equal(preview.paymentImpact.remainingAfterCommit, 35);
});

test("approval preview maps reduction within remaining balance to credit note", () => {
  const preview = buildOrderCommitApprovalAndDocumentPreview({
    baselineSource: ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT,
    classification: classificationFixture({
      commitKind: ORDER_COMMIT_PREVIEW_COMMIT_KIND.CREDIT_NOTE,
      netDelta: -40,
    }),
    paymentState: paymentStateFixture({ currentRemainingAmount: 100 }),
  });

  assert.equal(preview.requiresApproval, true);
  assert.equal(preview.approvalReasons.length, 1);
  assert.equal(
    preview.approvalReasons[0]?.code,
    "ORDER_COMMIT_REDUCTION_REQUIRES_APPROVAL"
  );
  assert.equal(
    preview.documentPlan.kind,
    ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.CREDIT_NOTE
  );
  assert.equal(preview.documentPlan.requiresRefundReview, false);
  assert.equal(
    preview.paymentImpact.kind,
    ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND.CREDIT_AVAILABLE
  );
  assert.equal(preview.paymentImpact.creditAmount, 40);
  assert.equal(preview.paymentImpact.remainingAfterCommit, 60);
  assert.equal(preview.refundImpact.creditNoteAmount, 40);
  assert.equal(preview.refundImpact.refundRequired, false);
});

test("approval preview maps reduction beyond remaining balance to refund-needed", () => {
  const preview = buildOrderCommitApprovalAndDocumentPreview({
    baselineSource: ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT,
    classification: classificationFixture({
      commitKind: ORDER_COMMIT_PREVIEW_COMMIT_KIND.CREDIT_NOTE,
      netDelta: -80,
    }),
    paymentState: paymentStateFixture({
      alreadyPaidAmount: 120,
      currentRemainingAmount: 30,
      overpaymentCapacity: 50,
    }),
  });

  assert.equal(preview.requiresApproval, true);
  assert.equal(
    preview.documentPlan.kind,
    ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.REFUND_NEEDED
  );
  assert.equal(preview.documentPlan.amount, 80);
  assert.equal(preview.documentPlan.requiresRefundReview, true);
  assert.equal(
    preview.paymentImpact.kind,
    ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND.REFUND_REVIEW_NEEDED
  );
  assert.equal(preview.paymentImpact.creditAmount, 80);
  assert.equal(preview.paymentImpact.remainingAfterCommit, -50);
  assert.equal(preview.refundImpact.refundRequired, true);
  assert.equal(preview.refundImpact.refundableAmount, 50);
  assert.equal(preview.refundImpact.creditNoteAmount, 80);
});

test("approval preview maps no-op to no document plan", () => {
  const preview = buildOrderCommitApprovalAndDocumentPreview({
    baselineSource: ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.EMPTY,
    classification: classificationFixture({
      commitKind: ORDER_COMMIT_PREVIEW_COMMIT_KIND.NO_OP,
      netDelta: 0,
      flags: emptyFlags(),
    }),
    paymentState: paymentStateFixture({ currentRemainingAmount: 15 }),
  });

  assert.equal(
    preview.documentPlan.kind,
    ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.NO_OP
  );
  assert.equal(preview.documentPlan.amount, 0);
  assert.equal(preview.documentPlan.requiresPaymentCollection, false);
  assert.equal(
    preview.paymentImpact.kind,
    ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND.NONE
  );
  assert.equal(preview.paymentImpact.remainingAfterCommit, 15);
  assert.equal(preview.refundImpact.refundRequired, false);
});

test("approval preview maps meaningful zero-net change to audit commit", () => {
  const preview = buildOrderCommitApprovalAndDocumentPreview({
    baselineSource: ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT,
    classification: classificationFixture({
      commitKind: ORDER_COMMIT_PREVIEW_COMMIT_KIND.ZERO_NET_AUDIT,
      netDelta: 0,
      zeroNetReason: "MEANINGFUL_ZERO_NET_OPERATIONAL_CHANGE",
    }),
    paymentState: paymentStateFixture({ currentRemainingAmount: 0 }),
  });

  assert.equal(preview.requiresApproval, false);
  assert.equal(
    preview.documentPlan.kind,
    ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.ZERO_NET_AUDIT_COMMIT
  );
  assert.equal(preview.documentPlan.amount, 0);
  assert.equal(
    preview.paymentImpact.kind,
    ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND.NONE
  );
  assert.equal(preview.refundImpact.refundableAmount, 0);
});

test("approval document preview source stays pure", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "src/modules/order-commits/order-commit-approval-document-preview.service.ts"
    ),
    "utf8"
  );

  assert.equal(/@\/lib\/db/.test(source), false);
  assert.equal(/pendingOpsJson/.test(source), false);
  assert.equal(/invoiceLineItem/i.test(source), false);
  assert.equal(
    /from\s+["'][^"']*(adjustment-workspace|invoice\.service|payment\.service|refund|get-order-commit-preview)[^"']*["']/i.test(
      source
    ),
    false
  );
});

function classificationFixture(input: {
  commitKind: OrderCommitPreviewClassification["commitKind"];
  netDelta: number;
  zeroNetReason?: string | null;
  flags?: OrderCommitPreviewOperationalFlags;
}): OrderCommitPreviewClassification {
  return {
    commitKind: input.commitKind,
    lineDiffs: [],
    netDelta: input.netDelta,
    operationalFlags: input.flags ?? meaningfulFlags(),
    zeroNetReason: input.zeroNetReason ?? null,
  };
}

function paymentStateFixture(input: {
  alreadyPaidAmount?: number;
  currentRemainingAmount: number;
  creditNoteCapacity?: number;
  overpaymentCapacity?: number;
}) {
  return {
    alreadyPaidAmount: input.alreadyPaidAmount ?? 0,
    currentRemainingAmount: input.currentRemainingAmount,
    creditNoteCapacity: input.creditNoteCapacity ?? 0,
    overpaymentCapacity: input.overpaymentCapacity ?? 0,
  };
}

function meaningfulFlags(): OrderCommitPreviewOperationalFlags {
  return {
    ...emptyFlags(),
    isFinanciallyRelevant: true,
    isOperationallyMeaningful: true,
  };
}

function emptyFlags(): OrderCommitPreviewOperationalFlags {
  return {
    isPackageChange: false,
    isPackageUpgrade: false,
    isPackageDowngrade: false,
    isPackageSwap: false,
    isAddOnChange: false,
    isPackageItemUpgradeChange: false,
    isPhotoChange: false,
    isSessionConfigurationChange: false,
    isLinkedProductChange: false,
    isFinanciallyRelevant: false,
    isOperationallyMeaningful: false,
  };
}
