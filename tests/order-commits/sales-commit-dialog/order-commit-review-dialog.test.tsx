import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import test from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ORDER_COMMIT_PREVIEW_BASELINE_SOURCE,
  ORDER_COMMIT_PREVIEW_COMMIT_KIND,
  ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND,
  ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND,
  ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND,
} from "@/modules/order-commits";
import type {
  SalesPageDraftState,
  SalesPageFinancialPreview,
  SalesPagePreviewState,
  SalesPageStagedChangesRow,
} from "@/modules/order-commits/projections/sales-page-view.types";
import type { POSMutationActionState } from "@/modules/orders/pos-handlers.types";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

type DialogModule = {
  OrderCommitReviewDialog: ComponentType<{
    orderId: string;
    draft: SalesPageDraftState | null;
    preview: SalesPagePreviewState | null;
    stagedChanges: SalesPageStagedChangesRow[];
    financialPreview: SalesPageFinancialPreview;
    commitAction?: (
      orderId: string,
      expectedDraftVersion: number,
      approvalActorUserId?: string
    ) => Promise<POSMutationActionState>;
  }>;
  OrderCommitReviewDialogBody: ComponentType<{
    preview: SalesPagePreviewState;
    stagedChanges: SalesPageStagedChangesRow[];
    financialPreview: SalesPageFinancialPreview;
    actionState?: POSMutationActionState;
    approvalActorUserId: string;
    onApprovalActorUserIdChange: (value: string) => void;
  }>;
  getOrderCommitReviewTotals: (
    preview: SalesPagePreviewState,
    financialPreview: SalesPageFinancialPreview
  ) => { previousTotal: number; pendingDelta: number; pendingTotal: number };
  commitDialogInlineMessages: (state: POSMutationActionState) => string[];
  previewRequiresApproval: (
    preview: SalesPagePreviewState | null,
    state: POSMutationActionState
  ) => boolean;
};

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };

test("OrderCommitReviewDialog renders no submit-capable control without a draft or preview", async () => {
  const { OrderCommitReviewDialog } = await loadDialogModule();

  const noDraftMarkup = renderToStaticMarkup(
    createElement(OrderCommitReviewDialog, {
      orderId: "order-1",
      draft: null,
      preview: previewFixture(),
      stagedChanges: stagedRowsFixture(),
      financialPreview: financialPreviewFixture(),
    })
  );
  assert.match(noDraftMarkup, /Review &amp; commit/);
  assert.match(noDraftMarkup, /disabled/);
  assert.doesNotMatch(noDraftMarkup, /Commit changes/);

  const noPreviewMarkup = renderToStaticMarkup(
    createElement(OrderCommitReviewDialog, {
      orderId: "order-1",
      draft: draftFixture(),
      preview: null,
      stagedChanges: stagedRowsFixture(),
      financialPreview: financialPreviewFixture(),
    })
  );
  assert.match(noPreviewMarkup, /Review &amp; commit/);
  assert.match(noPreviewMarkup, /disabled/);
  assert.doesNotMatch(noPreviewMarkup, /Commit changes/);
});

test("OrderCommitReviewDialogBody renders canonical totals and preview consequences", async () => {
  const { OrderCommitReviewDialogBody, getOrderCommitReviewTotals } =
    await loadDialogModule();
  const preview = previewFixture({
    netDelta: -35,
    totals: {
      baselineTotal: 510,
      netDelta: -35,
      pendingTotal: 475,
    },
    requiresApproval: true,
    approvalReasons: [
      {
        code: "MANAGER_REVIEW",
        message: "Manager review required for reductions.",
      },
    ],
  });
  const financialPreview = financialPreviewFixture();

  const totals = getOrderCommitReviewTotals(preview, financialPreview);
  assert.deepEqual(totals, {
    previousTotal: 510,
    pendingDelta: -35,
    pendingTotal: 475,
  });

  const markup = renderToStaticMarkup(
    createElement(OrderCommitReviewDialogBody, {
      preview,
      stagedChanges: stagedRowsFixture(),
      financialPreview,
      approvalActorUserId: "",
      onApprovalActorUserIdChange: () => undefined,
    })
  );

  assert.match(markup, /Previous total/);
  assert.match(markup, /510\.000 KD/);
  assert.match(markup, /Pending delta/);
  assert.match(markup, /-35\.000 KD/);
  assert.match(markup, /After commit/);
  assert.match(markup, /475\.000 KD/);
  assert.match(markup, /Premium album/);
  assert.match(markup, /Canvas removed/);
  assert.match(markup, /Document plan/);
  assert.match(markup, /Credit Note/);
  assert.match(markup, /Payment impact/);
  assert.match(markup, /Credit Available/);
  assert.match(markup, /Refund impact/);
  assert.match(markup, /Review needed/);
  assert.match(markup, /Manager review required for reductions/);
  assert.match(markup, /Manager\/admin user ID/);
});

test("OrderCommitReviewDialogBody falls back to preview totals without row arithmetic", async () => {
  const { getOrderCommitReviewTotals } = await loadDialogModule();
  const preview = previewFixture();
  const totals = getOrderCommitReviewTotals(preview, financialPreviewFixture());

  assert.deepEqual(totals, {
    previousTotal: 100,
    pendingDelta: -15,
    pendingTotal: 85,
  });
});

test("OrderCommitReviewDialogBody keeps stale/concurrent/approval/capacity states inline with preview visible", async () => {
  const {
    OrderCommitReviewDialogBody,
    commitDialogInlineMessages,
    previewRequiresApproval,
  } = await loadDialogModule();
  const preview = previewFixture();
  const financialPreview = financialPreviewFixture();
  const rows = stagedRowsFixture();

  const states: POSMutationActionState[] = [
    {
      kind: "error",
      errors: {
        _global: [
          "Draft changed since you opened it. Refresh to see the latest.",
          "commit.stale",
        ],
      },
    },
    {
      kind: "error",
      errors: {
        _global: [
          "Another commit just landed. Refresh and try again.",
          "commit.concurrent",
        ],
      },
    },
    {
      kind: "approval-required",
      errors: {
        _global: ["commit.approvalRequired"],
        approvalActorUserId: ["Manager/admin user ID is required."],
      },
    },
    {
      kind: "error",
      errors: {
        _global: [
          "Credit/refund capacity changed. Refresh and review this order before committing.",
          "commit.creditCapacity",
        ],
      },
    },
  ];

  for (const state of states) {
    const markup = renderToStaticMarkup(
      createElement(OrderCommitReviewDialogBody, {
        preview,
        stagedChanges: rows,
        financialPreview,
        actionState: state,
        approvalActorUserId: "",
        onApprovalActorUserIdChange: () => undefined,
      })
    );

    assert.match(markup, /Previous total/);
    assert.match(markup, /Premium album/);
    assert.match(markup, /Canvas removed/);
    assert.match(markup, /Document plan/);
    assert.equal(previewRequiresApproval(preview, state), state.kind === "approval-required");
  }

  assert.deepEqual(commitDialogInlineMessages(states[0] ?? {}), [
    "Draft changed since you opened it. Refresh to see the latest.",
    "commit.stale",
  ]);
  assert.deepEqual(commitDialogInlineMessages(states[2] ?? {}), [
    "Manager/admin approval is required before this commit can finish.",
  ]);
});

test("OrderCommitReviewDialogBody renders no-op and audit preview copy when no staged rows exist", async () => {
  const { OrderCommitReviewDialogBody } = await loadDialogModule();
  const markup = renderToStaticMarkup(
    createElement(OrderCommitReviewDialogBody, {
      preview: previewFixture({
        zeroNetReason: "MEANINGFUL_ZERO_NET_OPERATIONAL_CHANGE",
        documentPlanKind:
          ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.ZERO_NET_AUDIT_COMMIT,
      }),
      stagedChanges: [],
      financialPreview: financialPreviewFixture(),
      approvalActorUserId: "",
      onApprovalActorUserIdChange: () => undefined,
    })
  );

  assert.match(markup, /Meaningful Zero Net Operational Change/);
  assert.match(markup, /Zero Net Audit Commit/);
});

test("OrderCommitReviewDialog source guards protect Spec 128 boundaries", () => {
  const helperSource = readFileSync(
    "src/modules/order-commits/sales-commit-actions.ts",
    "utf8"
  );
  const dialogSource = readFileSync(
    "src/components/orders/order-commit-review-dialog.tsx",
    "utf8"
  );
  const forbiddenLegacyName = ["Adjustment", "Workspace"].join("");

  assert.doesNotMatch(helperSource, /@\/lib\/db/);
  assert.doesNotMatch(dialogSource, /@\/lib\/db/);
  assert.doesNotMatch(dialogSource, /commitOrderChanges/);
  assert.equal(helperSource.includes(forbiddenLegacyName), false);
  assert.equal(dialogSource.includes(forbiddenLegacyName), false);
});

async function loadDialogModule(): Promise<DialogModule> {
  const originalModuleLoad = moduleWithLoader._load;
  moduleWithLoader._load = function loadWithDialogStubs(request, parent, isMain) {
    if (request === "next/navigation") {
      return { useRouter: () => ({ refresh: () => undefined }) };
    }
    if (request === "sonner") {
      return { toast: { success: () => undefined } };
    }
    if (request === "@/app/(app)/orders/[orderId]/sales/actions") {
      return {
        commitSalesChangesAction: async () => ({ kind: "success" }),
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };

  try {
    return await import(
      "../../../src/components/orders/order-commit-review-dialog.tsx"
    );
  } finally {
    moduleWithLoader._load = originalModuleLoad;
  }
}

function draftFixture(): SalesPageDraftState {
  return {
    id: "draft-1",
    version: 3,
    ownerUserId: "staff-1",
    openedByUserId: "staff-1",
    lastTouchedByUserId: "staff-1",
    updatedAt: new Date("2026-06-02T08:00:00.000Z"),
    baseCommitId: "commit-1",
  };
}

function previewFixture(
  overrides: Partial<SalesPagePreviewState> & {
    documentPlanKind?: SalesPagePreviewState["documentPlan"]["kind"];
  } = {}
): SalesPagePreviewState {
  const documentPlanKind =
    overrides.documentPlanKind ??
    ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.CREDIT_NOTE;

  return {
    baselineSource: ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT,
    baselineCommitId: "commit-1",
    baselineSequence: 1,
    draftId: "draft-1",
    draftVersion: 3,
    commitKind: ORDER_COMMIT_PREVIEW_COMMIT_KIND.CREDIT_NOTE,
    lineDiffs: [],
    netDelta: -15,
    totals: {
      baselineTotal: 100,
      netDelta: -15,
      pendingTotal: 85,
    },
    requiresApproval: overrides.requiresApproval ?? false,
    approvalReasons: overrides.approvalReasons ?? [],
    documentPlan: {
      kind: documentPlanKind,
      amount: 15,
      requiresPaymentCollection: false,
      requiresRefundReview: true,
      reason: "Reduction creates credit note",
    },
    paymentImpact: {
      kind: ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND.CREDIT_AVAILABLE,
      amountDue: 0,
      creditAmount: 15,
      alreadyPaidAmount: 100,
      remainingAfterCommit: -15,
    },
    refundImpact: {
      refundRequired: true,
      refundableAmount: 15,
      creditNoteAmount: 15,
      reason: "Refund review required",
    },
    zeroNetReason: overrides.zeroNetReason ?? null,
    ...overrides,
  };
}

function stagedRowsFixture(): SalesPageStagedChangesRow[] {
  return [
    {
      id: "row-1",
      changeKind: ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.PRICE_CHANGED,
      label: "Premium album",
      netDelta: 10,
      parentLabel: "Portrait package",
    },
    {
      id: "row-2",
      changeKind: ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.REMOVED,
      label: "Canvas removed",
      netDelta: -25,
      parentLabel: null,
    },
  ];
}

function financialPreviewFixture(_input: unknown = {}): SalesPageFinancialPreview {
  void _input;

  return {
    stage: "active",
    financialCaseId: "case-1",
    settlement: {
      mode: "draft",
      financialCaseId: "case-1",
      netCustomerTotal: 100,
      cashPaid: 100,
      remainingDue: 0,
      previousTotal: 100,
      pendingDelta: -15,
      afterCommitTotal: 85,
      amountDueAfterCommit: 0,
    },
    isFullySettled: true,
    paymentStatusEnum: null,
    collectPaymentTargetInvoiceId: null,
  };
}
