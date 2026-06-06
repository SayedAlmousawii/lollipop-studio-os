import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test from "node:test";
import {
  InvoiceType,
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

    const application = await ctx.db.documentApplication.findFirstOrThrow({
      where: {
        targetInvoiceId: workflow.finalInvoiceId,
        targetInvoiceLineId: null,
        sourceInvoice: { invoiceType: InvoiceType.CREDIT_NOTE },
      },
      include: { sourceInvoice: true },
    });
    assert.equal(application.amountApplied.toFixed(3), "50.000");
    assert.equal(application.sourceInvoice.parentInvoiceId, workflow.finalInvoiceId);
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
    }
  });
});

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
  const targetLineIds = new Set(
    creditNotes.flatMap((creditNote) =>
      creditNote.documentApplicationsAsSource.map(
        (application) => application.targetInvoiceLineId
      )
    )
  );
  assert.deepEqual(
    targetLineIds,
    new Set([firstAdjustment.lineItems[0].id, secondAdjustment.lineItems[0].id])
  );
  assert.equal(await finalCreditApplicationCount(ctx.db, workflow.finalInvoiceId), 0);
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
  const application = await db.documentApplication.findFirstOrThrow({
    where: {
      targetInvoiceId: input.adjustmentInvoiceId,
      targetInvoiceLineId: input.adjustmentLineId,
      sourceInvoice: { invoiceType: InvoiceType.CREDIT_NOTE },
    },
    include: { sourceInvoice: { include: { lineItems: true } } },
  });
  assert.equal(application.amountApplied.toFixed(3), input.amount);
  assert.equal(application.sourceInvoice.parentInvoiceId, input.adjustmentInvoiceId);
  assert.equal(application.sourceInvoice.lineItems.length >= 1, true);

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
