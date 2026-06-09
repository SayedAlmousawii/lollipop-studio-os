import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test from "node:test";
import {
  CreditOrigin,
  DocumentApplicationKind,
  InvoiceType,
  OrderEntityKind,
  PaymentDirection,
  PaymentMethod,
  PaymentType,
  Prisma,
  ProductCategory,
  type PrismaClient,
} from "@prisma/client";
import {
  addOrderAddOnChange,
  commitOrderEditForTest,
  removeOrderAddOnChange,
  updateOrderAddOnQuantityChange,
  updateOrderPackageItemUpgradeQuantityChange,
  upgradeOrderPackageItemChange,
} from "../order-commits/helpers/commit-order-edit";
import { withIsolatedBackendInvariantSchema } from "../backend-invariants/harness";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };
const originalModuleLoad = moduleWithLoader._load;
moduleWithLoader._load = function loadWithServerOnlyShim(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalModuleLoad.call(this, request, parent, isMain);
};

type TestContext = Awaited<ReturnType<typeof buildContext>>;

async function withFinancialHarness(
  run: (ctx: TestContext) => Promise<void>
): Promise<void> {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      await run(await buildContext());
    } finally {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });
}

async function buildContext() {
  const [
    { db },
    { seedPhaseBFixtures, buildFinalInvoiceWorkflowFixture, buildLockedFinalInvoiceWorkflowFixture },
    { recordPayment },
  ] = await Promise.all([
    import("@/lib/db"),
    import("../financial-phase-b/fixtures"),
    import("@/modules/payments/payment.service"),
  ]);
  const fixtures = await seedPhaseBFixtures(db);

  return {
    db,
    fixtures,
    recordPayment,
    buildLockedWorkflow: (suffix: string) =>
      buildLockedFinalInvoiceWorkflowFixture(db, fixtures, suffix),
    buildFinalWorkflowWithOriginalAddOn: (suffix: string) =>
      buildFinalInvoiceWorkflowFixture(db, fixtures, suffix, {
        issue: true,
        finalPaymentAmounts: [530],
        preInvoiceAddOnQuantity: 1,
      }),
  };
}

test("adjustment reversal regressions A-E", async () => {
  await withFinancialHarness(async (ctx) => {
    {
    const workflow = await ctx.buildLockedWorkflow("a");
    await commitOrderEditForTest(ctx.db, {
      orderId: workflow.orderId,
      change: addOrderAddOnChange(ctx.fixtures.addOnProductId),
      actorContext: ctx.fixtures.adminActor,
    });
    const adjustment = await firstAdjustmentWithLine(ctx.db, workflow.orderId);
    await payInvoice(ctx, adjustment.id, adjustment.totalAmount);
    const addOn = await firstOrderAddOn(ctx.db, workflow.orderId, ctx.fixtures.addOnProductId);

    await commitOrderEditForTest(ctx.db, {
      orderId: workflow.orderId,
      change: removeOrderAddOnChange(addOn.id),
      actorContext: ctx.fixtures.adminActor,
      approvalActorUserId: ctx.fixtures.managerId,
    });

    await assertAdjustmentReversal(ctx.db, {
      orderId: workflow.orderId,
      adjustmentInvoiceId: adjustment.id,
      adjustmentLineId: adjustment.lineItems[0].id,
      amount: "50.000",
      expectRefund: true,
    });
    await assertFinalUnchanged(ctx.db, workflow.finalInvoiceId, "500.000");
    }

    {
    const workflow = await ctx.buildLockedWorkflow("b");
    await commitOrderEditForTest(ctx.db, {
      orderId: workflow.orderId,
      change: addOrderAddOnChange(ctx.fixtures.addOnProductId),
      actorContext: ctx.fixtures.adminActor,
    });
    const adjustment = await firstAdjustmentWithLine(ctx.db, workflow.orderId);
    const addOn = await firstOrderAddOn(ctx.db, workflow.orderId, ctx.fixtures.addOnProductId);

    await commitOrderEditForTest(ctx.db, {
      orderId: workflow.orderId,
      change: removeOrderAddOnChange(addOn.id),
      actorContext: ctx.fixtures.adminActor,
      approvalActorUserId: ctx.fixtures.managerId,
    });

    await assertAdjustmentReversal(ctx.db, {
      orderId: workflow.orderId,
      adjustmentInvoiceId: adjustment.id,
      adjustmentLineId: adjustment.lineItems[0].id,
      amount: "50.000",
      expectRefund: false,
    });
    }

    await assertDirectUnpaidReversalSweepsSeparateReceivable(ctx);

    {
    const workflow = await ctx.buildLockedWorkflow("c");
    const packageItem = await ctx.db.packageItem.findFirstOrThrow({
      where: { packageId: ctx.fixtures.basePackageId },
      select: { id: true, product: { select: { category: true } } },
    });
    await ctx.db.packageItem.update({
      where: { id: packageItem.id },
      data: { quantity: 3 },
    });
    const replacement = await createReplacementProduct(ctx.db, "c", packageItem.product.category);

    const orderPackageId = await firstOrderPackageId(ctx.db, workflow.orderId);
    await commitOrderEditForTest(ctx.db, {
      orderId: workflow.orderId,
      change: upgradeOrderPackageItemChange({
        orderPackageId,
        packageItemId: packageItem.id,
        newProductId: replacement.id,
        quantity: 3,
      }),
      actorContext: ctx.fixtures.adminActor,
    });
    const adjustment = await firstAdjustmentWithLine(ctx.db, workflow.orderId);
    await payInvoice(ctx, adjustment.id, adjustment.totalAmount);
    const upgrade = await ctx.db.orderPackageItemUpgrade.findFirstOrThrow({
      where: { orderId: workflow.orderId },
      select: { id: true },
    });

    await commitOrderEditForTest(ctx.db, {
      orderId: workflow.orderId,
      change: updateOrderPackageItemUpgradeQuantityChange({
        orderPackageId,
        orderPackageItemUpgradeId: upgrade.id,
        quantity: 2,
      }),
      actorContext: ctx.fixtures.managerActor,
      approvalActorUserId: ctx.fixtures.managerId,
    });

    await assertAdjustmentReversal(ctx.db, {
      orderId: workflow.orderId,
      adjustmentInvoiceId: adjustment.id,
      adjustmentLineId: adjustment.lineItems[0].id,
      amount: "20.000",
      expectRefund: true,
    });
    const finalCreditApplications = await finalCreditApplicationCount(
      ctx.db,
      workflow.finalInvoiceId
    );
    assert.equal(finalCreditApplications, 0);
    const adjustmentCount = await ctx.db.invoice.count({
      where: { orderId: workflow.orderId, invoiceType: InvoiceType.ADJUSTMENT },
    });
    assert.equal(adjustmentCount, 1, "partial reduction must not reissue remaining upgrade");
    }

    {
    const workflow = await ctx.buildFinalWorkflowWithOriginalAddOn("d");
    const addOn = await firstOrderAddOn(ctx.db, workflow.orderId, ctx.fixtures.addOnProductId);

    await commitOrderEditForTest(ctx.db, {
      orderId: workflow.orderId,
      change: removeOrderAddOnChange(addOn.id),
      actorContext: ctx.fixtures.adminActor,
      approvalActorUserId: ctx.fixtures.managerId,
    });

    const creditNote = await ctx.db.invoice.findFirstOrThrow({
      where: {
        orderId: workflow.orderId,
        invoiceType: InvoiceType.CREDIT_NOTE,
        parentInvoiceId: workflow.finalInvoiceId,
        creditOrigin: CreditOrigin.REMOVAL,
      },
      include: { documentApplicationsAsSource: true },
    });
    assert.equal(creditNote.totalAmount.toFixed(3), "50.000");
    assert.equal(creditNote.documentApplicationsAsSource.length, 0);
    const adjustmentCount = await ctx.db.invoice.count({
      where: { orderId: workflow.orderId, invoiceType: InvoiceType.ADJUSTMENT },
    });
    assert.equal(adjustmentCount, 0);
    }

    {
    const workflow = await ctx.buildLockedWorkflow("e");
    const secondProduct = await createAddOnProduct(ctx.db, "e-second", "Test E second addon", 30);

    await commitOrderEditForTest(ctx.db, {
      orderId: workflow.orderId,
      change: addOrderAddOnChange(ctx.fixtures.addOnProductId),
      actorContext: ctx.fixtures.adminActor,
    });
    const firstAdjustment = await firstAdjustmentWithLine(ctx.db, workflow.orderId);
    await payInvoice(ctx, firstAdjustment.id, firstAdjustment.totalAmount);
    const firstAddOn = await firstOrderAddOn(
      ctx.db,
      workflow.orderId,
      ctx.fixtures.addOnProductId
    );

    await commitOrderEditForTest(ctx.db, {
      orderId: workflow.orderId,
      change: addOrderAddOnChange(secondProduct.id),
      actorContext: ctx.fixtures.adminActor,
    });
    const secondAdjustment = await latestAdjustmentWithLine(ctx.db, workflow.orderId);
    await payInvoice(ctx, secondAdjustment.id, secondAdjustment.totalAmount);

    await commitOrderEditForTest(ctx.db, {
      orderId: workflow.orderId,
      change: removeOrderAddOnChange(firstAddOn.id),
      actorContext: ctx.fixtures.adminActor,
      approvalActorUserId: ctx.fixtures.managerId,
    });

    await assertAdjustmentReversal(ctx.db, {
      orderId: workflow.orderId,
      adjustmentInvoiceId: firstAdjustment.id,
      adjustmentLineId: firstAdjustment.lineItems[0].id,
      amount: "50.000",
      expectRefund: true,
    });
    const secondApplications = await ctx.db.documentApplication.count({
      where: { targetInvoiceLineId: secondAdjustment.lineItems[0].id },
    });
    assert.equal(secondApplications, 0, "removing addon1 must not reverse addon2");

    await assertSameCauseReversalConsumesAllOpenLines(ctx);
    await assertSharedInvoiceMultiLineReversalProvenance(ctx);
    }
  });
});

async function assertDirectUnpaidReversalSweepsSeparateReceivable(
  ctx: TestContext
) {
  const { syncOrderInvoiceForFinancialEdit } = await import(
    "@/modules/invoices/invoice.service"
  );
  const workflow = await ctx.buildLockedWorkflow("direct-r2");
  const firstProduct = await createAddOnProduct(
    ctx.db,
    "direct-r2-first",
    "Direct R2 first open add-on",
    50
  );
  const secondProduct = await createAddOnProduct(
    ctx.db,
    "direct-r2-second",
    "Direct R2 reversed add-on",
    30
  );

  await ctx.db.orderAddOn.create({
    data: {
      orderId: workflow.orderId,
      productId: firstProduct.id,
      nameSnapshot: firstProduct.name,
      priceSnapshot: firstProduct.canonicalPrice,
      quantity: 1,
    },
  });
  await syncOrderInvoiceForFinancialEdit(ctx.db, {
    orderId: workflow.orderId,
    actorContext: ctx.fixtures.adminActor,
    previousAddOns: [],
  });
  const firstAdjustment = await firstAdjustmentWithLine(ctx.db, workflow.orderId);

  const beforeSecondAdd = await orderAddOnsForSync(ctx.db, workflow.orderId);
  await ctx.db.orderAddOn.create({
    data: {
      orderId: workflow.orderId,
      productId: secondProduct.id,
      nameSnapshot: secondProduct.name,
      priceSnapshot: secondProduct.canonicalPrice,
      quantity: 1,
    },
  });
  await syncOrderInvoiceForFinancialEdit(ctx.db, {
    orderId: workflow.orderId,
    actorContext: ctx.fixtures.adminActor,
    previousAddOns: beforeSecondAdd,
  });
  const secondAdjustment = await latestAdjustmentWithLine(
    ctx.db,
    workflow.orderId
  );

  const beforeRemoval = await orderAddOnsForSync(ctx.db, workflow.orderId);
  const secondAddOn = await ctx.db.orderAddOn.findFirstOrThrow({
    where: { orderId: workflow.orderId, productId: secondProduct.id },
    select: { id: true },
  });
  await ctx.db.orderAddOn.delete({ where: { id: secondAddOn.id } });
  await syncOrderInvoiceForFinancialEdit(ctx.db, {
    orderId: workflow.orderId,
    actorContext: ctx.fixtures.managerActor,
    previousAddOns: beforeRemoval,
    managerApprovedReductionByUserId: ctx.fixtures.managerId,
    managerApprovedReason: "Direct R2 unpaid reversal sweep",
  });

  const reversalCreditNote = await ctx.db.invoice.findFirstOrThrow({
    where: {
      orderId: workflow.orderId,
      invoiceType: InvoiceType.CREDIT_NOTE,
      parentInvoiceId: secondAdjustment.id,
      creditOrigin: CreditOrigin.REVERSAL,
      reversesInvoiceLineId: secondAdjustment.lineItems[0].id,
    },
    include: { documentApplicationsAsSource: true },
  });
  assert.equal(reversalCreditNote.totalAmount.toFixed(3), "30.000");
  assert.deepEqual(
    reversalCreditNote.documentApplicationsAsSource.map((application) => ({
      kind: application.kind,
      targetInvoiceId: application.targetInvoiceId,
      targetInvoiceLineId: application.targetInvoiceLineId,
      amount: application.amountApplied.toFixed(3),
    })),
    [
      {
        kind: DocumentApplicationKind.SETTLEMENT,
        targetInvoiceId: firstAdjustment.id,
        targetInvoiceLineId: null,
        amount: "30.000",
      },
    ]
  );

  const manufacturedOverpaymentApplications = await ctx.db.documentApplication.count({
    where: {
      targetInvoiceId: secondAdjustment.id,
      targetInvoiceLineId: secondAdjustment.lineItems[0].id,
      kind: DocumentApplicationKind.CAUSE_REVERSAL,
    },
  });
  assert.equal(manufacturedOverpaymentApplications, 0);
}

async function assertSameCauseReversalConsumesAllOpenLines(ctx: TestContext) {
  const workflow = await ctx.buildLockedWorkflow("e-same-cause");
  await commitOrderEditForTest(ctx.db, {
    orderId: workflow.orderId,
    change: addOrderAddOnChange(ctx.fixtures.addOnProductId),
    actorContext: ctx.fixtures.adminActor,
  });
  const firstAdjustment = await firstAdjustmentWithLine(ctx.db, workflow.orderId);
  await payInvoice(ctx, firstAdjustment.id, firstAdjustment.totalAmount);
  const addOn = await firstOrderAddOn(ctx.db, workflow.orderId, ctx.fixtures.addOnProductId);

  await commitOrderEditForTest(ctx.db, {
    orderId: workflow.orderId,
    change: updateOrderAddOnQuantityChange(addOn.id, 2),
    actorContext: ctx.fixtures.adminActor,
  });
  const secondAdjustment = await latestAdjustmentWithLine(ctx.db, workflow.orderId);
  await payInvoice(ctx, secondAdjustment.id, secondAdjustment.totalAmount);

  await commitOrderEditForTest(ctx.db, {
    orderId: workflow.orderId,
    change: removeOrderAddOnChange(addOn.id),
    actorContext: ctx.fixtures.managerActor,
    approvalActorUserId: ctx.fixtures.managerId,
  });

  const creditNotes = await ctx.db.invoice.findMany({
    where: { orderId: workflow.orderId, invoiceType: InvoiceType.CREDIT_NOTE },
    include: { documentApplicationsAsSource: true, lineItems: true },
  });
  assert.equal(
    creditNotes.length,
    2,
    "same-cause removal should credit both adjustment invoices"
  );
  assert.equal(
    creditNotes.reduce((sum, creditNote) => sum + creditNote.lineItems.length, 0),
    2
  );
  assert.deepEqual(
    creditNotes.flatMap((creditNote) => creditNote.documentApplicationsAsSource),
    []
  );
  assert.equal(await finalCreditApplicationCount(ctx.db, workflow.finalInvoiceId), 0);
}

async function assertSharedInvoiceMultiLineReversalProvenance(ctx: TestContext) {
  const { runAllInvariants } = await import("@/modules/financial/invariants");
  const workflow = await ctx.buildLockedWorkflow("shared-invoice-multi-line");
  const firstProduct = await createAddOnProduct(
    ctx.db,
    "shared-invoice-first",
    "Shared invoice first add-on",
    30
  );
  const secondProduct = await createAddOnProduct(
    ctx.db,
    "shared-invoice-second",
    "Shared invoice second add-on",
    20
  );

  await commitOrderEditForTest(ctx.db, {
    orderId: workflow.orderId,
    changes: [
      addOrderAddOnChange(firstProduct.id),
      addOrderAddOnChange(secondProduct.id),
    ],
    actorContext: ctx.fixtures.adminActor,
  });
  const adjustment = await firstAdjustmentWithLine(ctx.db, workflow.orderId);
  assert.equal(adjustment.lineItems.length, 2);
  await payInvoice(ctx, adjustment.id, adjustment.totalAmount);

  const [firstAddOn, secondAddOn] = await Promise.all([
    firstOrderAddOn(ctx.db, workflow.orderId, firstProduct.id),
    firstOrderAddOn(ctx.db, workflow.orderId, secondProduct.id),
  ]);
  await commitOrderEditForTest(ctx.db, {
    orderId: workflow.orderId,
    changes: [
      removeOrderAddOnChange(firstAddOn.id),
      removeOrderAddOnChange(secondAddOn.id),
    ],
    actorContext: ctx.fixtures.managerActor,
    approvalActorUserId: ctx.fixtures.managerId,
  });

  const reversalCreditNotes = await ctx.db.invoice.findMany({
    where: {
      orderId: workflow.orderId,
      invoiceType: InvoiceType.CREDIT_NOTE,
      parentInvoiceId: adjustment.id,
      creditOrigin: CreditOrigin.REVERSAL,
    },
    include: { lineItems: { orderBy: { sortOrder: "asc" } } },
  });
  assert.equal(reversalCreditNotes.length, 1);
  assert.equal(reversalCreditNotes[0]?.lineItems.length, 2);
  assert.deepEqual(
    reversalCreditNotes[0]?.lineItems.map((line) => ({
      causeOrderEntityKind: line.causeOrderEntityKind,
      causeOrderEntityId: line.causeOrderEntityId,
      lineTotal: line.lineTotal.toFixed(3),
    })),
    [
      {
        causeOrderEntityKind: OrderEntityKind.ADDON,
        causeOrderEntityId: firstAddOn.id,
        lineTotal: "30.000",
      },
      {
        causeOrderEntityKind: OrderEntityKind.ADDON,
        causeOrderEntityId: secondAddOn.id,
        lineTotal: "20.000",
      },
    ]
  );

  const causeReversalCount = await ctx.db.documentApplication.count({
    where: {
      kind: DocumentApplicationKind.CAUSE_REVERSAL,
      sourceInvoice: { orderId: workflow.orderId },
    },
  });
  assert.equal(causeReversalCount, 0);
  const refundInvoiceCount = await ctx.db.invoice.count({
    where: { orderId: workflow.orderId, invoiceType: InvoiceType.REFUND },
  });
  assert.equal(refundInvoiceCount, 0);
  const outPaymentCount = await ctx.db.payment.count({
    where: {
      direction: PaymentDirection.OUT,
      invoice: { orderId: workflow.orderId },
    },
  });
  assert.equal(outPaymentCount, 0);
  const order = await ctx.db.order.findUniqueOrThrow({
    where: { id: workflow.orderId },
    select: { refundPending: true },
  });
  assert.equal(order.refundPending, true);

  const violations = await runAllInvariants(ctx.db);
  assert.deepEqual(
    violations.filter(
      (violation) =>
        violation.invariant ===
        "paid-adjustment-line-removal-must-have-reversal"
    ),
    []
  );
}

async function payInvoice(
  ctx: TestContext,
  invoiceId: string,
  amount: Prisma.Decimal
) {
  await ctx.recordPayment(
    invoiceId,
    {
      amount: amount.toNumber(),
      method: PaymentMethod.CASH,
      paymentType: PaymentType.ADJUSTMENT,
    },
    ctx.fixtures.adminActor
  );
}

async function orderAddOnsForSync(db: PrismaClient, orderId: string) {
  const addOns = await db.orderAddOn.findMany({
    where: { orderId },
    select: {
      productId: true,
      nameSnapshot: true,
      priceSnapshot: true,
      quantity: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return addOns.map((addOn) => ({
    productId: addOn.productId ?? undefined,
    name: addOn.nameSnapshot,
    price: addOn.priceSnapshot.toNumber(),
    quantity: addOn.quantity,
  }));
}

async function firstAdjustmentWithLine(db: PrismaClient, orderId: string) {
  return db.invoice.findFirstOrThrow({
    where: { orderId, invoiceType: InvoiceType.ADJUSTMENT },
    include: { lineItems: { orderBy: { sortOrder: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
}

async function latestAdjustmentWithLine(db: PrismaClient, orderId: string) {
  return db.invoice.findFirstOrThrow({
    where: { orderId, invoiceType: InvoiceType.ADJUSTMENT },
    include: { lineItems: { orderBy: { sortOrder: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
}

async function firstOrderAddOn(db: PrismaClient, orderId: string, productId: string) {
  return db.orderAddOn.findFirstOrThrow({
    where: { orderId, productId },
    orderBy: { createdAt: "asc" },
  });
}

async function firstOrderPackageId(db: PrismaClient, orderId: string): Promise<string> {
  const orderPackage = await db.orderPackage.findFirstOrThrow({
    where: { orderId },
    select: { id: true },
  });
  return orderPackage.id;
}

async function createReplacementProduct(
  db: PrismaClient,
  suffix: string,
  category: ProductCategory
) {
  return db.product.create({
    data: {
      id: `adjustment-reversal-replacement-${suffix}`,
      name: `Adjustment Reversal Replacement ${suffix}`,
      category,
      canonicalPrice: new Prisma.Decimal(60),
      isPackageDeliverable: true,
    },
  });
}

async function createAddOnProduct(
  db: PrismaClient,
  suffix: string,
  name: string,
  price: number
) {
  return db.product.create({
    data: {
      id: `adjustment-reversal-addon-${suffix}`,
      name,
      category: ProductCategory.OTHER,
      canonicalPrice: new Prisma.Decimal(price),
      isAddOn: true,
    },
  });
}

async function assertAdjustmentReversal(
  db: PrismaClient,
  input: {
    orderId: string;
    adjustmentInvoiceId: string;
    adjustmentLineId: string;
    amount: string;
    expectRefund: boolean;
  }
) {
  const creditNote = await db.invoice.findFirstOrThrow({
    where: {
      orderId: input.orderId,
      invoiceType: InvoiceType.CREDIT_NOTE,
      parentInvoiceId: input.adjustmentInvoiceId,
      creditOrigin: CreditOrigin.REVERSAL,
      reversesInvoiceLineId: input.adjustmentLineId,
    },
    include: {
      lineItems: true,
      documentApplicationsAsSource: true,
    },
  });
  assert.equal(creditNote.totalAmount.toFixed(3), input.amount);
  assert.equal(creditNote.lineItems.length >= 1, true);
  assert.equal(
    creditNote.documentApplicationsAsSource.some(
      (application) =>
        application.kind === DocumentApplicationKind.CAUSE_REVERSAL ||
        application.targetInvoiceLineId === input.adjustmentLineId
    ),
    false,
    "adjustment reversal must not create a line-targeted CAUSE_REVERSAL application"
  );

  const refundInvoiceCount = await db.invoice.count({
    where: { orderId: input.orderId, invoiceType: InvoiceType.REFUND },
  });
  assert.equal(refundInvoiceCount, 0);
  const outPaymentCount = await db.payment.count({
    where: {
      direction: PaymentDirection.OUT,
      invoice: { orderId: input.orderId },
    },
  });
  assert.equal(outPaymentCount, 0);

  const order = await db.order.findUniqueOrThrow({
    where: { id: input.orderId },
    select: { refundPending: true },
  });
  assert.equal(order.refundPending, input.expectRefund);
}

async function assertFinalUnchanged(
  db: PrismaClient,
  finalInvoiceId: string,
  expectedTotal: string
) {
  const finalInvoice = await db.invoice.findUniqueOrThrow({
    where: { id: finalInvoiceId },
    select: { totalAmount: true, remainingAmount: true },
  });
  assert.equal(finalInvoice.totalAmount.toFixed(3), expectedTotal);
  assert.equal(finalInvoice.remainingAmount.toFixed(3), "0.000");
}

async function finalCreditApplicationCount(
  db: PrismaClient,
  finalInvoiceId: string
): Promise<number> {
  return db.documentApplication.count({
    where: {
      targetInvoiceId: finalInvoiceId,
      sourceInvoice: { invoiceType: InvoiceType.CREDIT_NOTE },
    },
  });
}
