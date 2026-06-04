import assert from "node:assert/strict";
import test from "node:test";
import {
  InvoiceStatus,
  InvoiceType,
  PaymentMethod,
  PaymentType,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import type { AdjustmentWorkspaceEdit } from "@/modules/adjustment-workspace/adjustment-workspace.types";
import { ORDER_COMMIT_KIND } from "@/modules/order-commits/order-commit.constants";
import type { OrderCommitDraftStagingChange } from "@/modules/order-commits/order-commit-draft.types";
import {
  firstOrderPackageId,
  type Spec126Harness,
  withSpec126Harness,
} from "../spec-126/test-helpers";

type LockedPhotoWorkflow = {
  orderId: string;
  financialCaseId: string;
  finalInvoiceId: string;
  orderPackageId: string;
  finalBefore: FinalInvoiceSnapshot;
};

type FinalInvoiceSnapshot = {
  id: string;
  totalAmount: string;
  paidAmount: string;
  remainingAmount: string;
  status: InvoiceStatus;
  isLocked: boolean;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
    causeOrderEntityKind: string | null;
    causeOrderEntityId: string | null;
  }>;
};

type PathOutcome = {
  financialCaseNetEffect: string;
  netDocumentEffect: string;
  reductionAmount: string;
  refundPending: boolean;
  finalBefore: FinalInvoiceSnapshot;
  finalAfter: FinalInvoiceSnapshot;
  documents: Array<{
    invoiceType: InvoiceType;
    parentInvoiceId: string | null;
    totalAmount: string;
    role: string | null;
    lineCauses: string[];
  }>;
};

test("locked OrderCommit parity normalizes AW finalize outcomes", async (t) => {
  await withSpec126Harness(async (ctx) => {
    await t.test("additive change emits matching adjustment outcome", async () => {
      const aw = await runAwPhotoPath(ctx, "131-add-aw", {
        startingCounts: { selectedPhotoCount: 10, extraDigitalCount: 0, extraPrintCount: 0 },
        nextCounts: { selectedPhotoCount: 12, extraDigitalCount: 2, extraPrintCount: 0 },
        finalRemainingAfterPayment: "0",
      });
      const oc = await runOrderCommitPhotoPath(ctx, "131-add-oc", {
        startingCounts: { selectedPhotoCount: 10, extraDigitalCount: 0, extraPrintCount: 0 },
        nextCounts: { selectedPhotoCount: 12, extraDigitalCount: 2, extraPrintCount: 0 },
        finalRemainingAfterPayment: "0",
        expectedPreviewNetDelta: "10.000",
      });

      assertNormalizedParity(aw, oc, {
        expectedEffect: "10.000",
        expectedReduction: "0.000",
        expectedRefundPending: false,
      });
      assert.deepEqual(documentTypes(aw), [InvoiceType.ADJUSTMENT]);
      assert.deepEqual(documentTypes(oc), [InvoiceType.ADJUSTMENT]);
      assert.deepEqual(documentRoles(oc), ["ADJUSTMENT_INVOICE"]);
    });

    await t.test(
      "reductive change treats AW negative ADJUSTMENT and OrderCommit CREDIT_NOTE as equivalent",
      async () => {
        const aw = await runAwPhotoPath(ctx, "131-red-aw", {
          startingCounts: {
            selectedPhotoCount: 12,
            extraDigitalCount: 2,
            extraPrintCount: 0,
          },
          nextCounts: { selectedPhotoCount: 10, extraDigitalCount: 0, extraPrintCount: 0 },
          finalRemainingAfterPayment: "20",
        });
        const oc = await runOrderCommitPhotoPath(ctx, "131-red-oc", {
          startingCounts: {
            selectedPhotoCount: 12,
            extraDigitalCount: 2,
            extraPrintCount: 0,
          },
          nextCounts: { selectedPhotoCount: 10, extraDigitalCount: 0, extraPrintCount: 0 },
          finalRemainingAfterPayment: "20",
          seedOrderCommitBaseline: true,
          expectedPreviewNetDelta: "-10.000",
        });

        assertNormalizedParity(aw, oc, {
          expectedEffect: "-10.000",
          expectedReduction: "10.000",
          expectedRefundPending: false,
        });
        assert.deepEqual(documentTypes(aw), [InvoiceType.ADJUSTMENT]);
        assert.deepEqual(documentTypes(oc), [InvoiceType.CREDIT_NOTE]);
        assert.deepEqual(documentRoles(oc), ["CREDIT_NOTE"]);
      }
    );

    await t.test(
      "credit-capacity exhaustion parity sets refundPending when both paths agree",
      async () => {
        const aw = await runAwPhotoPath(ctx, "131-refund-aw", {
          startingCounts: {
            selectedPhotoCount: 12,
            extraDigitalCount: 2,
            extraPrintCount: 0,
          },
          nextCounts: { selectedPhotoCount: 10, extraDigitalCount: 0, extraPrintCount: 0 },
          finalRemainingAfterPayment: "0",
        });
        const oc = await runOrderCommitPhotoPath(ctx, "131-refund-oc", {
          startingCounts: {
            selectedPhotoCount: 12,
            extraDigitalCount: 2,
            extraPrintCount: 0,
          },
          nextCounts: { selectedPhotoCount: 10, extraDigitalCount: 0, extraPrintCount: 0 },
          finalRemainingAfterPayment: "0",
          seedOrderCommitBaseline: true,
          expectedPreviewNetDelta: "-10.000",
        });

        assertNormalizedParity(aw, oc, {
          expectedEffect: "-10.000",
          expectedReduction: "10.000",
          expectedRefundPending: true,
        });
        assert.deepEqual(documentTypes(aw), [InvoiceType.ADJUSTMENT]);
        assert.deepEqual(documentTypes(oc), [InvoiceType.CREDIT_NOTE]);
        assert.deepEqual(documentRoles(oc), ["CREDIT_NOTE"]);
      }
    );

    await t.test("no-op proposal rejects without unnecessary document", async () => {
      const aw = await runAwNoOpPath(ctx, "131-noop-aw");
      const oc = await runOrderCommitNoOpPath(ctx, "131-noop-oc");

      assertNormalizedParity(aw, oc, {
        expectedEffect: "0.000",
        expectedReduction: "0.000",
        expectedRefundPending: false,
      });
      assert.deepEqual(aw.documents, []);
      assert.deepEqual(oc.documents, []);
    });

    await t.test(
      "legacy divergence documents AW refundPending threshold versus OrderCommit target rule",
      async () => {
        const aw = await runAwPhotoPath(ctx, "131-threshold-aw", {
          startingCounts: {
            selectedPhotoCount: 12,
            extraDigitalCount: 2,
            extraPrintCount: 0,
          },
          nextCounts: { selectedPhotoCount: 10, extraDigitalCount: 0, extraPrintCount: 0 },
          finalRemainingAfterPayment: "5",
        });
        const oc = await runOrderCommitPhotoPath(ctx, "131-threshold-oc", {
          startingCounts: {
            selectedPhotoCount: 12,
            extraDigitalCount: 2,
            extraPrintCount: 0,
          },
          nextCounts: { selectedPhotoCount: 10, extraDigitalCount: 0, extraPrintCount: 0 },
          finalRemainingAfterPayment: "5",
          seedOrderCommitBaseline: true,
          expectedPreviewNetDelta: "-10.000",
        });

        assert.equal(aw.financialCaseNetEffect, "-10.000");
        assert.equal(oc.financialCaseNetEffect, "-10.000");
        assert.equal(aw.reductionAmount, "10.000");
        assert.equal(oc.reductionAmount, "10.000");
        assert.equal(aw.refundPending, false);
        assert.equal(oc.refundPending, true);
        assert.deepEqual(documentTypes(aw), [InvoiceType.ADJUSTMENT]);
        assert.deepEqual(documentTypes(oc), [InvoiceType.CREDIT_NOTE]);
        assert.deepEqual(documentRoles(oc), ["CREDIT_NOTE"]);
      }
    );
  });
});

async function runAwPhotoPath(
  ctx: Spec126Harness,
  suffix: string,
  input: PhotoPathInput
): Promise<PathOutcome> {
  const workflow = await buildLockedPhotoWorkflow(ctx, suffix, input);
  const workspace = await ctx.adjustmentWorkspaceServices.openWorkspace(
    workflow.finalInvoiceId,
    ctx.fixtures.adminActor
  );
  const view = await ctx.adjustmentWorkspaceServices.applyEdit(
    workspace.id,
    {
      version: 0,
      edit: photoWorkspaceEdit(workflow.orderPackageId, suffix, input.nextCounts),
    },
    ctx.fixtures.adminActor
  );
  await ctx.adjustmentWorkspaceServices.finalizeWorkspace(
    workspace.id,
    {
      version: view.version,
      managerApprovedReductionByUserId: ctx.fixtures.managerId,
    },
    ctx.fixtures.adminActor
  );

  return captureOutcome(ctx.db, workflow);
}

async function runOrderCommitPhotoPath(
  ctx: Spec126Harness,
  suffix: string,
  input: PhotoPathInput
): Promise<PathOutcome> {
  const workflow = await buildLockedPhotoWorkflow(ctx, suffix, input);
  const stageResult = await ctx.salesActions.stageSalesChangeAction(
    workflow.orderId,
    0,
    photoOrderCommitChange(workflow.orderPackageId, input.nextCounts)
  );
  assert.equal(stageResult.kind, "success");
  const draft = await ctx.orderCommitServices.getOrderCommitDraft({
    orderId: workflow.orderId,
  });
  assert.ok(draft, "OrderCommit draft should exist after staging");
  if (input.expectedPreviewNetDelta) {
    const { getOrderCommitPreview } = await import("@/modules/order-commits");
    const preview = await getOrderCommitPreview({
      orderId: workflow.orderId,
    });
    assert.equal(
      moneyString(preview.netDelta),
      input.expectedPreviewNetDelta,
      "OrderCommit preview net delta should match the parity fixture"
    );
  }
  const commitResult = await ctx.salesActions.commitSalesChangesAction(
    workflow.orderId,
    draft.draft.version,
    ctx.fixtures.managerId
  );
  assert.equal(commitResult.kind, "success");

  return captureOutcome(ctx.db, workflow);
}

async function runAwNoOpPath(
  ctx: Spec126Harness,
  suffix: string
): Promise<PathOutcome> {
  const workflow = await buildLockedPhotoWorkflow(ctx, suffix, {
    startingCounts: { selectedPhotoCount: 10, extraDigitalCount: 0, extraPrintCount: 0 },
    nextCounts: { selectedPhotoCount: 10, extraDigitalCount: 0, extraPrintCount: 0 },
    finalRemainingAfterPayment: "0",
  });
  const workspace = await ctx.adjustmentWorkspaceServices.openWorkspace(
    workflow.finalInvoiceId,
    ctx.fixtures.adminActor
  );
  await ctx.adjustmentWorkspaceServices.finalizeWorkspace(
    workspace.id,
    { version: 0 },
    ctx.fixtures.adminActor
  );

  return captureOutcome(ctx.db, workflow);
}

async function runOrderCommitNoOpPath(
  ctx: Spec126Harness,
  suffix: string
): Promise<PathOutcome> {
  const workflow = await buildLockedPhotoWorkflow(ctx, suffix, {
    startingCounts: { selectedPhotoCount: 10, extraDigitalCount: 0, extraPrintCount: 0 },
    nextCounts: { selectedPhotoCount: 10, extraDigitalCount: 0, extraPrintCount: 0 },
    finalRemainingAfterPayment: "0",
  });
  const draft = await ctx.orderCommitServices.getOrCreateOrderCommitDraft({
    orderId: workflow.orderId,
    actorContext: ctx.fixtures.adminActor,
  });
  const commitResult = await ctx.salesActions.commitSalesChangesAction(
    workflow.orderId,
    draft.draft.version
  );
  assert.equal(commitResult.kind, "error");
  assert.deepEqual(commitResult.errors?._global?.at(-1), "commit.noOp");

  return captureOutcome(ctx.db, workflow);
}

type PhotoCounts = {
  selectedPhotoCount: number;
  extraDigitalCount: number;
  extraPrintCount: number;
};

type PhotoPathInput = {
  startingCounts: PhotoCounts;
  nextCounts: PhotoCounts;
  finalRemainingAfterPayment: string;
  seedOrderCommitBaseline?: boolean;
  expectedPreviewNetDelta?: string;
};

async function buildLockedPhotoWorkflow(
  ctx: Spec126Harness,
  suffix: string,
  input: PhotoPathInput
): Promise<LockedPhotoWorkflow> {
  const workflow = await ctx.buildCheckedInWorkflow(suffix);
  const orderPackageId = await firstOrderPackageId(ctx.db, workflow.orderId);
  await ctx.db.orderPackage.update({
    where: { id: orderPackageId },
    data: input.startingCounts,
  });
  await ctx.db.order.update({
    where: { id: workflow.orderId },
    data: { selectedPhotoCount: input.startingCounts.selectedPhotoCount },
  });
  if (input.seedOrderCommitBaseline) {
    await ctx.orderCommitServices.createOrderCommitSnapshot({
      orderId: workflow.orderId,
      kind: ORDER_COMMIT_KIND.BASELINE,
      actorContext: ctx.fixtures.adminActor,
      metadata: { reason: "spec_131_locked_parity_baseline" },
    });
  }

  const { closeInvoice, createInvoiceForOrder, issueInvoice } = await import(
    "@/modules/invoices/invoice.service"
  );
  const { recordPayment } = await import("@/modules/payments/payment.service");
  const createdInvoice = await createInvoiceForOrder(
    workflow.orderId,
    ctx.fixtures.adminActor
  );
  await issueInvoice(createdInvoice.id, ctx.fixtures.adminActor);

  const issued = await ctx.db.invoice.findUniqueOrThrow({
    where: { id: createdInvoice.id },
    select: { remainingAmount: true },
  });
  const desiredRemaining = new Prisma.Decimal(input.finalRemainingAfterPayment);
  const paymentAmount = issued.remainingAmount.minus(desiredRemaining);
  if (paymentAmount.greaterThan(0)) {
    await recordPayment(
      createdInvoice.id,
      {
        amount: paymentAmount.toNumber(),
        method: PaymentMethod.CASH,
        paymentType: PaymentType.FINAL,
      },
      ctx.fixtures.adminActor
    );
  }
  if (desiredRemaining.greaterThan(0)) {
    await closeInvoice(createdInvoice.id, ctx.fixtures.adminActor);
  }

  const finalBefore = await captureFinalInvoice(ctx.db, createdInvoice.id);
  assert.equal(finalBefore.isLocked, true);
  assert.equal(finalBefore.remainingAmount, moneyString(desiredRemaining));

  return {
    ...workflow,
    finalInvoiceId: createdInvoice.id,
    orderPackageId,
    finalBefore,
  };
}

async function captureOutcome(
  db: PrismaClient,
  workflow: LockedPhotoWorkflow
): Promise<PathOutcome> {
  const order = await db.order.findUniqueOrThrow({
    where: { id: workflow.orderId },
    select: { refundPending: true },
  });
  const invoices = await db.invoice.findMany({
    where: {
      orderId: workflow.orderId,
      financialCaseId: workflow.financialCaseId,
      parentInvoiceId: workflow.finalInvoiceId,
      invoiceType: { in: [InvoiceType.ADJUSTMENT, InvoiceType.CREDIT_NOTE] },
    },
    orderBy: { createdAt: "asc" },
    include: { lineItems: { orderBy: { sortOrder: "asc" } } },
  });
  const links =
    invoices.length === 0
      ? []
      : await db.orderCommitDocument.findMany({
          where: { invoiceId: { in: invoices.map((invoice) => invoice.id) } },
          select: { invoiceId: true, role: true },
          orderBy: { createdAt: "asc" },
        });
  const documents = invoices.map((invoice) => ({
    invoiceType: invoice.invoiceType,
    parentInvoiceId: invoice.parentInvoiceId,
    totalAmount: invoice.totalAmount.toFixed(3),
    role: links.find((link) => link.invoiceId === invoice.id)?.role ?? null,
    lineCauses: invoice.lineItems
      .map((line) =>
        line.causeOrderEntityKind && line.causeOrderEntityId
          ? `${line.causeOrderEntityKind}:${line.causeOrderEntityId}`
          : null
      )
      .filter((cause): cause is string => cause !== null)
      .sort(),
  }));
  const netDocumentEffect = moneyString(
    documents.reduce(
      (sum, document) => sum.plus(signedDocumentAmount(document)),
      new Prisma.Decimal(0)
    )
  );
  const finalAfter = await captureFinalInvoice(db, workflow.finalInvoiceId);

  return {
    financialCaseNetEffect: netDocumentEffect,
    netDocumentEffect,
    reductionAmount: reductionAmount(netDocumentEffect),
    refundPending: order.refundPending,
    finalBefore: workflow.finalBefore,
    finalAfter,
    documents,
  };
}

async function captureFinalInvoice(
  db: PrismaClient,
  invoiceId: string
): Promise<FinalInvoiceSnapshot> {
  const invoice = await db.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { lineItems: { orderBy: { sortOrder: "asc" } } },
  });
  return {
    id: invoice.id,
    totalAmount: invoice.totalAmount.toFixed(3),
    paidAmount: invoice.paidAmount.toFixed(3),
    remainingAmount: invoice.remainingAmount.toFixed(3),
    status: invoice.status,
    isLocked: invoice.isLocked,
    lineItems: invoice.lineItems.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice.toFixed(3),
      lineTotal: line.lineTotal.toFixed(3),
      causeOrderEntityKind: line.causeOrderEntityKind,
      causeOrderEntityId: line.causeOrderEntityId,
    })),
  };
}

function assertNormalizedParity(
  aw: PathOutcome,
  oc: PathOutcome,
  expected: {
    expectedEffect: string;
    expectedReduction: string;
    expectedRefundPending: boolean;
  }
) {
  assert.equal(aw.financialCaseNetEffect, expected.expectedEffect);
  assert.equal(oc.financialCaseNetEffect, expected.expectedEffect);
  assert.equal(aw.netDocumentEffect, expected.expectedEffect);
  assert.equal(oc.netDocumentEffect, expected.expectedEffect);
  assert.equal(aw.reductionAmount, expected.expectedReduction);
  assert.equal(oc.reductionAmount, expected.expectedReduction);
  assert.equal(aw.refundPending, expected.expectedRefundPending);
  assert.equal(oc.refundPending, expected.expectedRefundPending);
  assertLockedFinalImmutable(aw);
  assertLockedFinalImmutable(oc);
  assert.ok(
    aw.documents.every(
      (document) => document.parentInvoiceId === aw.finalBefore.id
    )
  );
  assert.ok(
    oc.documents.every(
      (document) => document.parentInvoiceId === oc.finalBefore.id
    )
  );
  const awCauses = aw.documents.flatMap((document) => document.lineCauses);
  const ocCauses = oc.documents.flatMap((document) => document.lineCauses);
  if (awCauses.length > 0 && ocCauses.length > 0) {
    assert.deepEqual(causeKinds(awCauses), causeKinds(ocCauses));
  }
}

function assertLockedFinalImmutable(outcome: PathOutcome) {
  assert.deepEqual(
    immutableFinalSnapshot(outcome.finalAfter),
    immutableFinalSnapshot(outcome.finalBefore)
  );
}

function immutableFinalSnapshot(snapshot: FinalInvoiceSnapshot) {
  return {
    id: snapshot.id,
    totalAmount: snapshot.totalAmount,
    status: snapshot.status,
    isLocked: snapshot.isLocked,
    lineItems: snapshot.lineItems,
  };
}

function photoWorkspaceEdit(
  orderPackageId: string,
  suffix: string,
  counts: PhotoCounts
): AdjustmentWorkspaceEdit {
  return {
    id: `spec-131-photo-${suffix}`,
    op: "change_selected_photo_count",
    orderPackageId,
    ...counts,
  };
}

function photoOrderCommitChange(
  orderPackageId: string,
  counts: PhotoCounts
): OrderCommitDraftStagingChange {
  return {
    domain: "PHOTO",
    action: "SET_COUNTS",
    target: {
      stableKey: `order-package:${orderPackageId}`,
      orderEntityId: orderPackageId,
    },
    ...counts,
  };
}

function signedDocumentAmount(document: {
  invoiceType: InvoiceType;
  totalAmount: string;
}): Prisma.Decimal {
  const amount = new Prisma.Decimal(document.totalAmount);
  if (document.invoiceType === InvoiceType.CREDIT_NOTE) return amount.negated();
  return amount;
}

function reductionAmount(netDocumentEffect: string): string {
  const amount = new Prisma.Decimal(netDocumentEffect);
  return amount.lessThan(0) ? moneyString(amount.abs()) : "0.000";
}

function documentTypes(outcome: PathOutcome): InvoiceType[] {
  return outcome.documents.map((document) => document.invoiceType);
}

function documentRoles(outcome: PathOutcome): Array<string | null> {
  return outcome.documents.map((document) => document.role);
}

function causeKinds(causes: string[]): string[] {
  return [...new Set(causes.map((cause) => cause.split(":")[0] ?? cause))].sort();
}

function moneyString(value: Prisma.Decimal.Value): string {
  return new Prisma.Decimal(value).toFixed(3);
}
