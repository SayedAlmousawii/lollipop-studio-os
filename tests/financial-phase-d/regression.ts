import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  InvoiceLineType,
  InvoiceStatus,
  InvoiceType,
  OrderEditingStatus,
  OrderSelectionStatus,
  PaymentDirection,
  PaymentMethod,
  PaymentType,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { computeEffectivePaidFromAllocations } from "@/modules/invoices/invoice.calculation";
import {
  createAdjustmentInvoice,
  createCreditNote,
  createInvoiceForOrder,
  getInvoiceById,
  snapshotInvoiceLineItems,
  syncOrderInvoiceForFinancialEdit,
} from "@/modules/invoices/invoice.service";
import { getOrderEditingWorkflowById, updateOrderPackage } from "@/modules/orders/order.service";
import { recordPayment } from "@/modules/payments/payment.service";
import { issueRefundWithPayment } from "@/modules/refunds/refund.service";
import { runAllInvariants } from "@/modules/financial/invariants";
import { assertMoney, assertSinglePaymentAllocation } from "../financial-phase-b/assertions";
import {
  addSecondPackageLine,
  buildCheckedInWorkflowFixture,
  buildFinalInvoiceWorkflowFixture,
  buildLockedFinalInvoiceWorkflowFixture,
  seedPhaseDFixtures,
  type PhaseDFixtures,
} from "./fixtures";

type CaseRunner = {
  id: string;
  run: (db: PrismaClient, fixtures: PhaseDFixtures) => Promise<void>;
};

export async function runPhaseDRegressionSuite(db: PrismaClient): Promise<void> {
  const fixtures = await seedPhaseDFixtures(db);
  const cases: CaseRunner[] = [
    { id: "REG-74-01", run: runReg7401InvoiceDetailUsesCanonicalApplications },
    { id: "REG-74-02", run: runReg7402BackfilledShapeStillPresent },
    { id: "REG-74-03", run: runReg7403PureReadsDoNotEmitDualReadWarning },
    { id: "REG-75-01", run: runReg7501AdjustmentCreationAndSettlement },
    { id: "REG-75-02", run: runReg7502SettlementPanelSeesAdjustmentOutstanding },
    { id: "REG-76-01", run: runReg7601CreditNoteRoleAndOverpaymentFlag },
    { id: "REG-76-02", run: runReg7602RefundDirectionAndAllocation },
    { id: "REG-76-03", run: runReg7603MixedEditCreatesPairedDocuments },
    { id: "REG-70-01", run: runReg7001MultiPackageInvoiceMath },
    { id: "REG-70-02", run: runReg7002CrossSessionPackageBlocked },
    { id: "REG-70-03", run: runReg7003PackageScopedAddonCascade },
    { id: "REG-LEGACY-01", run: runRegLegacy01EditingWorkflowLegacyDepositCharacterization },
  ];

  for (const testCase of cases) {
    await testCase.run(db, fixtures);
  }

  await runStaticFinancialArchitectureSearch();
  await runAllInvariants(db);
}

async function runReg7401InvoiceDetailUsesCanonicalApplications(
  db: PrismaClient,
  fixtures: PhaseDFixtures
): Promise<void> {
  const workflow = await buildFinalInvoiceWorkflowFixture(db, fixtures, "reg7401");
  const detail = await getInvoiceById(workflow.finalInvoiceId);
  const effectivePaid = await computeEffectivePaidFromAllocations(workflow.finalInvoiceId, db);

  assert.ok(detail, "invoice detail must be available");
  assertMoney(effectivePaid, "20", "effective paid amount must include deposit application");
  assert.equal(detail?.paidAmount, "0.000 KD");
  assert.equal(detail?.depositPaidAmount, "20.000 KD");
  assert.equal(detail?.remainingAmount, "480.000 KD");
  assert.equal(detail?.isOverpaid, false);
}

async function runReg7402BackfilledShapeStillPresent(
  db: PrismaClient,
  fixtures: PhaseDFixtures
): Promise<void> {
  const workflow = await buildFinalInvoiceWorkflowFixture(db, fixtures, "reg7402");
  const depositPayment = await db.payment.findFirstOrThrow({
    where: { invoiceId: workflow.depositInvoiceId },
    select: { id: true },
  });
  const application = await db.documentApplication.findFirst({
    where: {
      sourceInvoiceId: workflow.depositInvoiceId,
      targetInvoiceId: workflow.finalInvoiceId,
    },
    select: { amountApplied: true },
  });

  await assertSinglePaymentAllocation(db, depositPayment.id, workflow.depositInvoiceId, "20");
  assert.ok(application, "deposit must be bound to final invoice through DocumentApplication");
  assertMoney(application?.amountApplied ?? new Prisma.Decimal(0), "20", "deposit application");
}

async function runReg7403PureReadsDoNotEmitDualReadWarning(
  db: PrismaClient,
  fixtures: PhaseDFixtures
): Promise<void> {
  const workflow = await buildFinalInvoiceWorkflowFixture(db, fixtures, "reg7403");
  const warnings = await captureWarnings(async () => {
    await getInvoiceById(workflow.finalInvoiceId);
    await computeEffectivePaidFromAllocations(workflow.finalInvoiceId, db);
  });

  assert.equal(
    warnings.filter((line) => line.includes("financial.rearch.dual_read.discrepancy")).length,
    0,
    "pure invoice reads must not emit dual-read discrepancy warnings"
  );
}

async function runReg7501AdjustmentCreationAndSettlement(
  db: PrismaClient,
  fixtures: PhaseDFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "reg7501");
  const adjustment = await createAdjustmentInvoice({
    parentFinalInvoiceId: workflow.finalInvoiceId,
    lines: [
      {
        lineType: InvoiceLineType.ADD_ON,
        description: "Phase D adjustment",
        quantity: 1,
        unitPrice: 50,
      },
    ],
    notes: "Phase D adjustment regression",
    createdByUserId: fixtures.managerId,
  });
  const payment = await recordPayment(
    adjustment.id,
    { amount: 50, method: PaymentMethod.CASH, paymentType: PaymentType.ADJUSTMENT },
    fixtures.managerActor
  );
  const stored = await db.invoice.findUniqueOrThrow({
    where: { id: adjustment.id },
    select: { invoiceType: true, parentInvoiceId: true, status: true, isLocked: true },
  });

  assert.equal(stored.invoiceType, InvoiceType.ADJUSTMENT);
  assert.equal(stored.parentInvoiceId, workflow.finalInvoiceId);
  assert.equal(stored.status, InvoiceStatus.CLOSED);
  assert.equal(stored.isLocked, true);
  await assertSinglePaymentAllocation(db, payment.id, adjustment.id, "50");
}

async function runReg7502SettlementPanelSeesAdjustmentOutstanding(
  db: PrismaClient,
  fixtures: PhaseDFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "reg7502");
  const adjustment = await createAdjustmentInvoice({
    parentFinalInvoiceId: workflow.finalInvoiceId,
    lines: [
      {
        lineType: InvoiceLineType.ADD_ON,
        description: "Phase D open adjustment",
        quantity: 1,
        unitPrice: 30,
      },
    ],
    notes: "Phase D open adjustment regression",
    createdByUserId: fixtures.managerId,
  });
  const finalDetail = await getInvoiceById(workflow.finalInvoiceId);

  assert.ok(
    finalDetail?.adjustments.some(
      (row) => row.id === adjustment.id && row.status === "Issued" && row.totalAmount === "30.000 KD"
    ),
    "final invoice detail must expose outstanding adjustment invoices"
  );
}

async function runReg7601CreditNoteRoleAndOverpaymentFlag(
  db: PrismaClient,
  fixtures: PhaseDFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "reg7601");
  const beforeCount = await db.invoice.count({
    where: { orderId: workflow.orderId, invoiceType: InvoiceType.CREDIT_NOTE },
  });

  await assert.rejects(
    () =>
      createCreditNote({
        targetFinalInvoiceId: workflow.finalInvoiceId,
        lines: [{ description: "Receptionist reduction", quantity: 1, unitPrice: 50 }],
        reason: "Phase D receptionist reduction",
        createdByUserId: fixtures.receptionistId,
      }),
    /Manager permission is required/
  );

  const afterRejectedCount = await db.invoice.count({
    where: { orderId: workflow.orderId, invoiceType: InvoiceType.CREDIT_NOTE },
  });
  assert.equal(afterRejectedCount, beforeCount, "rejected credit note must not write");

  const creditNote = await createCreditNote({
    targetFinalInvoiceId: workflow.finalInvoiceId,
    lines: [{ description: "Manager reduction", quantity: 1, unitPrice: 50 }],
    reason: "Phase D manager reduction",
    createdByUserId: fixtures.managerId,
  });
  const finalDetail = await getInvoiceById(workflow.finalInvoiceId);
  const storedCreditNote = await db.invoice.findUniqueOrThrow({
    where: { id: creditNote.id },
    include: { documentApplicationsAsSource: true },
  });

  assert.equal(storedCreditNote.status, InvoiceStatus.CLOSED);
  assert.equal(storedCreditNote.isLocked, true);
  assert.equal(storedCreditNote.documentApplicationsAsSource[0]?.targetInvoiceId, workflow.finalInvoiceId);
  assert.equal(finalDetail?.isOverpaid, true);
  assert.equal(finalDetail?.overpaidAmount, "50.000 KD");
}

async function runReg7602RefundDirectionAndAllocation(
  db: PrismaClient,
  fixtures: PhaseDFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "reg7602");
  const finalPayment = await db.payment.findFirstOrThrow({
    where: { invoiceId: workflow.finalInvoiceId, paymentType: PaymentType.FINAL },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  await createCreditNote({
    targetFinalInvoiceId: workflow.finalInvoiceId,
    lines: [{ description: "Refundable reduction", quantity: 1, unitPrice: 40 }],
    reason: "Phase D refundable reduction",
    createdByUserId: fixtures.managerId,
  });
  const refund = await issueRefundWithPayment({
    sourceInvoiceId: workflow.finalInvoiceId,
    amount: 20,
    reason: "Phase D refund",
    createdByUserId: fixtures.managerId,
    method: PaymentMethod.CASH,
    refundOfPaymentId: finalPayment.id,
  });
  const refundInvoice = await db.invoice.findUniqueOrThrow({
    where: { id: refund.refundInvoiceId },
    include: { payments: { include: { allocations: true } } },
  });
  const refundPayment = refundInvoice.payments[0];

  assert.equal(refundInvoice.invoiceType, InvoiceType.REFUND);
  assert.equal(refundInvoice.status, InvoiceStatus.CLOSED);
  assert.equal(refundInvoice.isLocked, true);
  assert.equal(refundPayment?.direction, PaymentDirection.OUT);
  assert.equal(refundPayment?.paymentType, PaymentType.REFUND);
  assertMoney(refundPayment?.amount ?? new Prisma.Decimal(0), "20", "refund payment amount");
  await assertSinglePaymentAllocation(db, refundPayment?.id ?? "", refundInvoice.id, "20");
}

async function runReg7603MixedEditCreatesPairedDocuments(
  db: PrismaClient,
  fixtures: PhaseDFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "reg7603", {
    preInvoiceAddOns: [
      {
        productId: fixtures.addOnProductId,
        name: "Phase D Add-on",
        price: 50,
        quantity: 1,
      },
    ],
  });

  const warnings = await captureWarnings(async () => {
    await db.$transaction(async (tx) => {
      const existingAddOn = await tx.orderAddOn.findFirstOrThrow({
        where: { orderId: workflow.orderId, productId: fixtures.addOnProductId },
        select: { id: true },
      });
      await tx.orderAddOn.delete({ where: { id: existingAddOn.id } });
      await tx.orderAddOn.create({
        data: {
          orderId: workflow.orderId,
          productId: fixtures.secondAddOnProductId,
          nameSnapshot: "Phase D Second Add-on",
          priceSnapshot: new Prisma.Decimal(30),
          quantity: 1,
        },
      });
      await syncOrderInvoiceForFinancialEdit(tx, {
        orderId: workflow.orderId,
        actorContext: fixtures.managerActor,
        previousAddOns: [],
        managerApprovedReductionByUserId: fixtures.managerId,
        managerApprovedReason: "Phase D mixed edit reduction",
      });
    });
  });

  assert.ok(
    warnings.every((line) => line.includes("financial.rearch.dual_read.discrepancy")),
    "mixed locked edit warnings, when present, must be the known dual-read metric"
  );

  const [creditNotes, adjustments] = await Promise.all([
    db.invoice.findMany({
      where: { orderId: workflow.orderId, invoiceType: InvoiceType.CREDIT_NOTE },
      orderBy: { createdAt: "asc" },
    }),
    db.invoice.findMany({
      where: { orderId: workflow.orderId, invoiceType: InvoiceType.ADJUSTMENT },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  assert.equal(creditNotes.length, 1);
  assert.equal(adjustments.length, 1);
  assert.equal(creditNotes[0]?.parentInvoiceId, workflow.finalInvoiceId);
  assert.equal(adjustments[0]?.parentInvoiceId, workflow.finalInvoiceId);

  const pairedActivities = await db.orderActivity.findMany({
    where: {
      orderId: workflow.orderId,
      title: { in: ["Classifier reduction credit note issued", "Auto-adjustment issued"] },
    },
    select: { title: true, metadata: true },
  });
  const creditActivity = pairedActivities.find(
    (activity) => activity.title === "Classifier reduction credit note issued"
  );
  const adjustmentActivity = pairedActivities.find(
    (activity) => activity.title === "Auto-adjustment issued"
  );
  const creditMetadata = asMetadata(creditActivity?.metadata);
  const adjustmentMetadata = asMetadata(adjustmentActivity?.metadata);

  assert.equal(creditMetadata.pairedAdjustmentInvoiceId, adjustments[0]?.id);
  assert.equal(adjustmentMetadata.pairedCreditNoteInvoiceId, creditNotes[0]?.id);
}

async function runReg7001MultiPackageInvoiceMath(
  db: PrismaClient,
  fixtures: PhaseDFixtures
): Promise<void> {
  const workflow = await buildCheckedInWorkflowFixture(db, fixtures, "reg7001");
  const secondPackageId = await addSecondPackageLine(db, fixtures, workflow.orderId);
  await db.orderPackage.update({
    where: { id: secondPackageId },
    data: { extraDigitalCount: 2, extraPrintCount: 1 },
  });
  const invoice = await createInvoiceForOrder(workflow.orderId, fixtures.adminActor);
  await snapshotInvoiceLineItems(invoice.id, workflow.orderId);
  const storedInvoice = await db.invoice.findUniqueOrThrow({
    where: { id: invoice.id },
    include: { lineItems: true },
  });

  assert.equal(
    storedInvoice.lineItems.filter((line) => line.lineType === InvoiceLineType.PACKAGE_BASE).length,
    2
  );
  assert.equal(
    storedInvoice.lineItems.filter((line) => line.lineType === InvoiceLineType.EXTRA_PHOTOS).length,
    2
  );
  assertMoney(
    storedInvoice.totalAmount,
    "766",
    "multi-package total must include all package lines and session extra pricing"
  );
}

async function runReg7002CrossSessionPackageBlocked(
  db: PrismaClient,
  fixtures: PhaseDFixtures
): Promise<void> {
  const workflow = await buildCheckedInWorkflowFixture(db, fixtures, "reg7002");
  const orderPackage = await db.orderPackage.findFirstOrThrow({
    where: { orderId: workflow.orderId },
    select: { id: true },
  });

  await assert.rejects(
    () =>
      updateOrderPackage(
        workflow.orderId,
        {
          orderPackageId: orderPackage.id,
          packageId: fixtures.otherSessionPackageId,
        },
        fixtures.adminActor
      ),
    /session type/
  );
}

async function runReg7003PackageScopedAddonCascade(
  db: PrismaClient,
  fixtures: PhaseDFixtures
): Promise<void> {
  const workflow = await buildCheckedInWorkflowFixture(db, fixtures, "reg7003");
  const packageOne = await db.orderPackage.findFirstOrThrow({
    where: { orderId: workflow.orderId },
    select: { id: true },
  });
  const packageTwoId = await addSecondPackageLine(db, fixtures, workflow.orderId);
  await db.orderAddOn.createMany({
    data: [
      {
        orderId: workflow.orderId,
        orderPackageId: packageOne.id,
        productId: fixtures.addOnProductId,
        nameSnapshot: "Phase D scoped add-on one",
        priceSnapshot: new Prisma.Decimal(50),
        quantity: 1,
      },
      {
        orderId: workflow.orderId,
        orderPackageId: packageTwoId,
        productId: fixtures.secondAddOnProductId,
        nameSnapshot: "Phase D scoped add-on two",
        priceSnapshot: new Prisma.Decimal(30),
        quantity: 1,
      },
    ],
  });

  await db.orderPackage.delete({ where: { id: packageOne.id } });
  const remaining = await db.orderAddOn.findMany({
    where: { orderId: workflow.orderId },
    select: { orderPackageId: true, productId: true },
  });

  assert.equal(remaining.length, 1);
  assert.equal(remaining[0]?.orderPackageId, packageTwoId);
  assert.equal(remaining[0]?.productId, fixtures.secondAddOnProductId);
}

async function runRegLegacy01EditingWorkflowLegacyDepositCharacterization(
  db: PrismaClient,
  fixtures: PhaseDFixtures
): Promise<void> {
  const workflow = await buildFinalInvoiceWorkflowFixture(db, fixtures, "reglegacy01", {
    issue: true,
    finalPaymentAmounts: [460],
  });
  await db.order.update({
    where: { id: workflow.orderId },
    data: { selectionStatus: OrderSelectionStatus.COMPLETED },
  });
  await db.editingJob.update({
    where: { orderId: workflow.orderId },
    data: {
      assignedEditorId: fixtures.editorId,
      status: OrderEditingStatus.ASSIGNED,
      editingAssignedAt: new Date(),
    },
  });
  const storedFinal = await db.invoice.findUniqueOrThrow({
    where: { id: workflow.finalInvoiceId },
    select: { remainingAmount: true },
  });
  const editingWorkflow = await getOrderEditingWorkflowById(workflow.orderId);

  assertMoney(storedFinal.remainingAmount, "20", "fixture must leave canonical final balance due");
  assert.equal(
    editingWorkflow?.outstandingBalanceAmount,
    20,
    "editing workflow must read canonical final remaining without deposit subtraction"
  );
  assert.equal(
    editingWorkflow?.canMarkStarted,
    false,
    "editing workflow must stay blocked while canonical final balance remains due"
  );
}

async function runStaticFinancialArchitectureSearch(): Promise<void> {
  const files = await listSourceFiles(["src", "app"]);
  const hits = await collectPatternHits(files, [
    {
      name: "retired PaymentType.BASE",
      pattern: /PaymentType\.BASE|paymentType:\s*["']BASE["']/,
      allow: () => false,
    },
    {
      name: "direct payment.create outside payment service",
      pattern: /\.payment\.create\s*\(/,
      allow: (file) => file.endsWith("src/modules/payments/payment.service.ts"),
    },
    {
      name: "direct paymentAllocation.create outside payment service",
      pattern: /\.paymentAllocation\.create\s*\(/,
      allow: (file) => file.endsWith("src/modules/payments/payment.service.ts"),
    },
  ]);

  assert.deepEqual(hits, [], `financial architecture static search found forbidden paths: ${JSON.stringify(hits)}`);

  const invoiceService = await readFile(
    path.join(process.cwd(), "src/modules/invoices/invoice.service.ts"),
    "utf8"
  );
  assert.ok(
    invoiceService.includes("computeEffectivePaidFromAllocations"),
    "invoice service must keep canonical allocation/application balance calculation wired"
  );
}

async function captureWarnings(action: () => Promise<void>): Promise<string[]> {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    await action();
  } finally {
    console.warn = originalWarn;
  }
  return warnings;
}

function asMetadata(value: Prisma.JsonValue | undefined): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

async function listSourceFiles(roots: string[]): Promise<string[]> {
  const allFiles: string[] = [];
  for (const root of roots) {
    allFiles.push(...(await walk(path.join(process.cwd(), root))));
  }
  return allFiles.filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return walk(entryPath);
      }
      return [entryPath];
    })
  );
  return files.flat();
}

async function collectPatternHits(
  files: string[],
  checks: Array<{
    name: string;
    pattern: RegExp;
    allow: (file: string) => boolean;
  }>
): Promise<Array<{ check: string; file: string; line: number }>> {
  const hits: Array<{ check: string; file: string; line: number }> = [];
  for (const file of files) {
    const relativeFile = path.relative(process.cwd(), file);
    const content = await readFile(file, "utf8");
    const lines = content.split("\n");
    for (const check of checks) {
      if (check.allow(relativeFile)) continue;
      lines.forEach((line, index) => {
        if (check.pattern.test(line)) {
          hits.push({ check: check.name, file: relativeFile, line: index + 1 });
        }
      });
    }
  }
  return hits;
}
