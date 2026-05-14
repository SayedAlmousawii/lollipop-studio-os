import {
  InvoiceLineType,
  InvoiceStatus,
  InvoiceType,
  MediaType,
  OrderActivityType,
  OrderStatus,
  Prisma,
  UserRole,
  type Invoice,
} from "@prisma/client";
import type { ActorContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import { dualRead, LockedInvoiceEditError } from "@/modules/financial/dual-read";
import {
  BlockedEditError,
  classifyEditDelta,
  PendingCreditNoteApprovalError,
} from "@/modules/financial/edit-classifier";
import { FINANCIAL_REARCH_PHASE_2_AUTO_ADJUSTMENT } from "@/modules/financial/feature-flags";
import { assertFinancialCaseInvariants } from "@/modules/financial/invariants";
import { formatCustomerPhone } from "@/modules/customers/customer.utils";
import { PUBLIC_ID_KIND } from "@/modules/identifiers/identifier.constants";
import { generatePublicId } from "@/modules/identifiers/identifier.service";
import { computeOrderEditDelta } from "@/modules/orders/order.delta";
import { recordOrderActivity } from "@/modules/orders/order-activity.service";
import { getExtraPhotoUnitPriceWithClient } from "@/modules/pricing/pricing.service";
import { computeEffectivePaidFromAllocations } from "./invoice.calculation";
import type {
  CreateAdjustmentInvoiceInput,
  CreateCreditNoteInput,
  CreateRefundInvoiceInput,
} from "./invoice.schema";
import type {
  InvoiceDetail,
  InvoiceLineItem,
  InvoiceListItem,
  InvoiceStatusLabel,
} from "./invoice.types";

type DbClient = typeof db | Prisma.TransactionClient;
type InvoiceNumberData = { invoiceSeq: number; invoiceNumber: string };
type OrderAddOnLine = { productId?: string; name: string; price: number };
type SnapshotInvoiceLineItem = Omit<
  Prisma.InvoiceLineItemCreateManyInput,
  "invoiceId"
>;

export interface OrderInvoiceSyncInput {
  orderId: string;
  previousAddOns: OrderAddOnLine[];
  previousSelectedPhotoCount?: number | null;
  previousIncludedPhotoCount?: number | null;
  previousExtraPhotoCharge?: Prisma.Decimal;
  managerApprovedReductionByUserId?: string;
  managerApprovedReason?: string;
}

export interface OrderInvoiceSyncSummary {
  invoiceId: string;
  invoiceNumber: string;
  totalAmount: string;
  paidAmount: string;
  remainingAmount: string;
  status: InvoiceStatusLabel;
  packageAdjustmentAmount: Prisma.Decimal;
  addOnAdjustmentAmount: Prisma.Decimal;
  totalAdjustmentAmount: Prisma.Decimal;
  packageAdjustmentBaseline: Prisma.Decimal;
  createdInvoice: boolean;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

async function updateUnlockedInvoiceTotal(
  client: DbClient,
  id: string,
  totalAmount: Prisma.Decimal
) {
  const updateResult = await client.invoice.updateMany({
    where: {
      id,
      isLocked: false,
      lineItems: { none: {} },
    },
    data: { totalAmount },
  });
  if (updateResult.count === 0) {
    throw new Error("Only unsnapshotted unlocked invoices can be recalculated");
  }

  const invoice = await client.invoice.findUnique({
    where: { id },
    select: {
      id: true,
      invoiceNumber: true,
      totalAmount: true,
      paidAmount: true,
      remainingAmount: true,
      status: true,
    },
  });
  if (!invoice) {
    throw new Error("Invoice not found after update");
  }

  return invoice;
}

export async function createInvoiceForOrder(
  orderId: string,
  actorContext: ActorContext = {}
): Promise<{ id: string }> {
  return withRetry(
    () =>
      db.$transaction((tx) =>
        createInvoiceForOrderWithClient(tx, orderId, actorContext)
      ),
    "Failed to create invoice"
  );
}

export async function createInvoiceForOrderWithClient(
  client: DbClient,
  orderId: string,
  actorContext: ActorContext = {}
): Promise<{ id: string; status: InvoiceStatus }> {
  const order = await client.order.findUnique({
    where: { id: orderId },
    include: {
      customer: { select: { id: true } },
      booking: { select: { financialCase: { select: { id: true } } } },
      packages: {
        include: { package: { select: { price: true } } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
      orderAddOns: {
        select: { productId: true, nameSnapshot: true, priceSnapshot: true, quantity: true },
        orderBy: { createdAt: "asc" },
      },
      packageItemUpgrades: {
        select: { nameSnapshot: true, priceSnapshot: true, quantity: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!order) throw new Error("Order not found");
  const financialCaseId = order.booking.financialCase?.id;
  if (!financialCaseId) {
    throw new Error("Order financial case is required to create a final invoice");
  }
  const existingInvoice = await findPrimaryWorkflowInvoiceForOrder(client, {
    financialCaseId,
  });
  if (existingInvoice) return existingInvoice;

  if (order.packages.length === 0) throw new Error("Order has no package lines");
  const packageAmount = order.packages.reduce(
    (sum, line) =>
      sum.plus(line.finalPackagePriceSnapshot ?? line.package.price),
    new Prisma.Decimal(0)
  );
  const extraPhotoCharge = await calculateOrderPackageExtraPhotoTotal(client, order.id);
  const totalAmount = packageAmount
    .plus(
      sumAddOns(
        mapOrderAddOnRows(
          combineOrderAddOnRows(order.orderAddOns, order.packageItemUpgrades)
        )
      )
    )
    .plus(extraPhotoCharge);

  const invoiceNumberData = await generateInvoiceNumber(client, InvoiceType.FINAL);
  let invoice: { id: string; status: InvoiceStatus };
  try {
    invoice = await client.invoice.create({
      data: {
        publicId: await generatePublicId(client, PUBLIC_ID_KIND.INVOICE),
        financialCaseId,
        invoiceType: InvoiceType.FINAL,
        jobId: order.jobId,
        jobNumber: order.jobNumber,
        orderId: order.id,
        bookingId: order.bookingId,
        customerId: order.customer.id,
        ...invoiceNumberData,
        totalAmount,
        remainingAmount: totalAmount,
        status: InvoiceStatus.DRAFT,
      },
      select: { id: true, status: true },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    const racedInvoice = await findPrimaryWorkflowInvoiceForOrder(client, {
      financialCaseId,
    });
    if (!racedInvoice) throw error;

    return racedInvoice;
  }

  await applyDepositToFinalIfPresent(financialCaseId, invoice.id, client);
  await recalculateInvoiceStatus(invoice.id, client);
  invoice = await client.invoice.findUniqueOrThrow({
    where: { id: invoice.id },
    select: { id: true, status: true },
  });

  await recordOrderActivity(client, {
    orderId: order.id,
    userId: actorContext.actorUserId ?? null,
    type: OrderActivityType.INVOICE_ADJUSTED,
    title: "Invoice created",
    description: "Invoice was created for the order.",
    metadata: {
      invoiceId: invoice.id,
      totalAmount: totalAmount.toFixed(3),
      status: invoice.status,
    },
  });

  return invoice;
}

export async function syncOrderInvoiceForFinancialEdit(
  client: DbClient,
  input: OrderInvoiceSyncInput
): Promise<OrderInvoiceSyncSummary> {
  const order = await client.order.findUnique({
    where: { id: input.orderId },
    include: {
      customer: { select: { id: true } },
      booking: { select: { financialCase: { select: { id: true } } } },
      packages: {
        include: { package: { select: { price: true } } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
      orderAddOns: {
        select: { productId: true, nameSnapshot: true, priceSnapshot: true, quantity: true },
        orderBy: { createdAt: "asc" },
      },
      packageItemUpgrades: {
        select: { nameSnapshot: true, priceSnapshot: true, quantity: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!order) throw new Error("Order not found");
  const financialCaseId = order.booking.financialCase?.id;
  if (!financialCaseId) {
    throw new Error("Order financial case is required to sync a final invoice");
  }

  if (order.packages.length === 0) throw new Error("Order has no package lines");
  const packagePrice = order.packages.reduce(
    (sum, line) =>
      sum.plus(line.finalPackagePriceSnapshot ?? line.package.price),
    new Prisma.Decimal(0)
  );

  const existingWorkflowInvoice = await findPrimaryWorkflowInvoiceForOrder(client, {
    financialCaseId,
  });
  const existingInvoice = existingWorkflowInvoice
    ? await client.invoice.findUnique({
        where: { id: existingWorkflowInvoice.id },
        select: {
          id: true,
          invoiceNumber: true,
          totalAmount: true,
          paidAmount: true,
          remainingAmount: true,
          status: true,
          isLocked: true,
          _count: { select: { lineItems: true } },
        },
      })
    : null;
  if (existingWorkflowInvoice && !existingInvoice) {
    throw new Error("Invoice not found after ownership normalization");
  }

  const nextAddOns = mapOrderAddOnRows(
    combineOrderAddOnRows(order.orderAddOns, order.packageItemUpgrades)
  );
  const previousAddOnTotal = sumAddOns(input.previousAddOns);
  const nextAddOnTotal = sumAddOns(nextAddOns);
  const nextExtraPhotoCharge = await calculateOrderPackageExtraPhotoTotal(client, order.id);
  const previousExtraPhotoCharge =
    input.previousExtraPhotoCharge ??
    nextExtraPhotoCharge;
  const previousSelectionAddOnTotal = previousAddOnTotal.plus(previousExtraPhotoCharge);
  const nextSelectionAddOnTotal = nextAddOnTotal.plus(nextExtraPhotoCharge);
  const targetTotalAmount = packagePrice.plus(nextSelectionAddOnTotal);
  const packageAdjustmentBaseline = order.packages.reduce(
    (sum, line) =>
      sum.plus(line.originalPackagePriceSnapshot ?? line.package.price),
    new Prisma.Decimal(0)
  );
  const packageAdjustmentAmount = packagePrice.minus(packageAdjustmentBaseline);
  const addOnAdjustmentAmount = nextSelectionAddOnTotal.minus(previousSelectionAddOnTotal);
  const totalAdjustmentAmount = packageAdjustmentAmount.plus(addOnAdjustmentAmount);

  if (existingInvoice?.isLocked) {
    return dualRead({
      phase: "phase-2-classifier",
      path: "invoice.syncOrderInvoiceForFinancialEdit",
      entityId: order.id,
      flagKey: FINANCIAL_REARCH_PHASE_2_AUTO_ADJUSTMENT,
      authoritative: "old",
      oldFn: async () => {
        throw new LockedInvoiceEditError();
      },
      newFn: async () => {
        const delta = await computeOrderEditDelta(order.id, client);
        const result = classifyEditDelta(delta);

        if (result.blocked.length > 0) {
          throw new BlockedEditError(result.blocked);
        }

        if (result.netZero && result.adjustmentLines.length === 0) {
          await recordOrderActivity(client, {
            orderId: order.id,
            userId: null,
            type: OrderActivityType.INVOICE_ADJUSTED,
            title: "Upgrade swapped (equal price)",
            description: "Upgrade swapped (equal price).",
            metadata: {
              swaps: delta.swaps.map((swap) => ({
                removedName: swap.removedLineSnapshot.name,
                addedName: swap.addedLineSnapshot.name,
                amount: swap.addedPriceSnapshot.toFixed(3),
              })),
            },
          });

          return buildOrderInvoiceSyncSummary({
            invoice: existingInvoice,
            packageAdjustmentAmount,
            addOnAdjustmentAmount,
            totalAdjustmentAmount: new Prisma.Decimal(0),
            packageAdjustmentBaseline,
            createdInvoice: false,
          });
        }

        let creditNoteInvoice: Invoice | null = null;
        let adjustmentInvoice: Invoice | null = null;
        if (result.creditNoteRequired.length > 0) {
          if (!input.managerApprovedReductionByUserId) {
            throw new PendingCreditNoteApprovalError(
              result.creditNoteRequired,
              result.adjustmentLines
            );
          }

          const creditReason =
            input.managerApprovedReason?.trim() || "Reduction from order edit";
          creditNoteInvoice = await createCreditNote(
            {
              targetFinalInvoiceId: existingInvoice.id,
              lines: result.creditNoteRequired.map((requirement) => ({
                description: `Reduction: ${requirement.lineSnapshot.name}`,
                quantity: 1,
                unitPrice: requirement.amount,
              })),
              reason: creditReason,
              notes: `Auto-CREDIT_NOTE from order edit on ${new Date().toISOString()}`,
              createdByUserId: input.managerApprovedReductionByUserId,
            },
            client
          );
        }

        if (result.adjustmentLines.length > 0) {
          adjustmentInvoice = await createAdjustmentInvoice(
            {
              parentFinalInvoiceId: existingInvoice.id,
              lines: result.adjustmentLines,
              notes: `Auto-ADJUSTMENT from order edit on ${new Date().toISOString()}`,
              createdByUserId: input.managerApprovedReductionByUserId,
            },
            client
          );
        }

        if (creditNoteInvoice) {
          await recordOrderActivity(client, {
            orderId: order.id,
            userId: input.managerApprovedReductionByUserId ?? null,
            type: OrderActivityType.INVOICE_ADJUSTED,
            title: "Classifier reduction credit note issued",
            description: adjustmentInvoice
              ? `Credit note issued: ${creditNoteInvoice.invoiceNumber} for ${formatMoney(creditNoteInvoice.totalAmount)} (paired with ${adjustmentInvoice.invoiceNumber}).`
              : `Credit note issued: ${creditNoteInvoice.invoiceNumber} for ${formatMoney(creditNoteInvoice.totalAmount)}.`,
            metadata: {
              parentInvoiceId: existingInvoice.id,
              creditNoteInvoiceId: creditNoteInvoice.id,
              creditNoteInvoiceNumber: creditNoteInvoice.invoiceNumber,
              pairedAdjustmentInvoiceId: adjustmentInvoice?.id ?? null,
              pairedAdjustmentInvoiceNumber: adjustmentInvoice?.invoiceNumber ?? null,
              totalAmount: creditNoteInvoice.totalAmount.toFixed(3),
              pairedWithAdjustment: Boolean(adjustmentInvoice),
              reductions: result.creditNoteRequired.map((requirement) => ({
                reason: requirement.reason,
                amount: requirement.amount.toFixed(3),
                lineName: requirement.lineSnapshot.name,
              })),
            },
          });
        }

        if (adjustmentInvoice) {
          await recordOrderActivity(client, {
            orderId: order.id,
            userId: input.managerApprovedReductionByUserId ?? null,
            type: OrderActivityType.INVOICE_ADJUSTED,
            title: "Auto-adjustment issued",
            description: creditNoteInvoice
              ? `Auto-adjustment issued: ${adjustmentInvoice.invoiceNumber} for ${formatMoney(adjustmentInvoice.totalAmount)} (paired with ${creditNoteInvoice.invoiceNumber}).`
              : `Auto-adjustment issued: ${adjustmentInvoice.invoiceNumber} for ${formatMoney(adjustmentInvoice.totalAmount)}.`,
            metadata: {
              parentInvoiceId: existingInvoice.id,
              adjustmentInvoiceId: adjustmentInvoice.id,
              adjustmentInvoiceNumber: adjustmentInvoice.invoiceNumber,
              pairedCreditNoteInvoiceId: creditNoteInvoice?.id ?? null,
              pairedCreditNoteInvoiceNumber: creditNoteInvoice?.invoiceNumber ?? null,
              totalAmount: adjustmentInvoice.totalAmount.toFixed(3),
              lines: result.adjustmentLines.map((line) => ({
                description: line.description,
                quantity: line.quantity,
                unitPrice: line.unitPrice.toFixed(3),
              })),
            },
          });
        }

        return buildOrderInvoiceSyncSummary({
          invoice: existingInvoice,
          packageAdjustmentAmount,
          addOnAdjustmentAmount,
          totalAdjustmentAmount,
          packageAdjustmentBaseline,
          createdInvoice: false,
        });
      },
    });
  }
  if (existingInvoice && existingInvoice._count.lineItems > 0) {
    if (order.status === OrderStatus.DELIVERED) {
      throw new Error("Delivered order invoices cannot be recalculated from order edits");
    }
    await client.invoiceLineItem.deleteMany({
      where: { invoiceId: existingInvoice.id },
    });
  }

  const invoice = existingInvoice
    ? await updateUnlockedInvoiceTotal(client, existingInvoice.id, targetTotalAmount)
    : await createSyncedOrderInvoice(client, {
        orderId: order.id,
        bookingId: order.bookingId,
        financialCaseId,
        customerId: order.customer.id,
        jobId: order.jobId,
        jobNumber: order.jobNumber,
        totalAmount: targetTotalAmount,
      });

  await recalculateInvoiceStatus(invoice.id, client);

  const recalculated = await client.invoice.findUnique({
    where: { id: invoice.id },
    select: {
      id: true,
      invoiceNumber: true,
      totalAmount: true,
      paidAmount: true,
      remainingAmount: true,
      status: true,
    },
  });
  if (!recalculated) throw new Error("Invoice not found after recalculation");

  return buildOrderInvoiceSyncSummary({
    invoice: recalculated,
    packageAdjustmentAmount,
    addOnAdjustmentAmount,
    totalAdjustmentAmount,
    packageAdjustmentBaseline,
    createdInvoice: !existingInvoice,
  });
}

function buildOrderInvoiceSyncSummary({
  invoice,
  packageAdjustmentAmount,
  addOnAdjustmentAmount,
  totalAdjustmentAmount,
  packageAdjustmentBaseline,
  createdInvoice,
}: {
  invoice: {
    id: string;
    invoiceNumber: string;
    totalAmount: Prisma.Decimal;
    paidAmount: Prisma.Decimal;
    remainingAmount: Prisma.Decimal;
    status: InvoiceStatus;
  };
  packageAdjustmentAmount: Prisma.Decimal;
  addOnAdjustmentAmount: Prisma.Decimal;
  totalAdjustmentAmount: Prisma.Decimal;
  packageAdjustmentBaseline: Prisma.Decimal;
  createdInvoice: boolean;
}): OrderInvoiceSyncSummary {
  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    totalAmount: formatMoney(invoice.totalAmount),
    paidAmount: formatMoney(invoice.paidAmount),
    remainingAmount: formatMoney(invoice.remainingAmount),
    status: mapInvoiceStatus(invoice.status),
    packageAdjustmentAmount,
    addOnAdjustmentAmount,
    totalAdjustmentAmount,
    packageAdjustmentBaseline,
    createdInvoice,
  };
}

export async function getInvoices({
  page = 1,
  pageSize = 50,
  search,
}: {
  page?: number;
  pageSize?: number;
  search?: string;
} = {}): Promise<InvoiceListItem[]> {
  const safePage = Math.max(1, page);
  const safePageSize = Math.min(Math.max(1, pageSize), 100);
  const rows = await withRetry(
    () =>
      db.invoice.findMany({
        where: buildInvoiceWhere(search),
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
        include: {
          customer: { select: { phone: true } },
          order: { select: { jobNumber: true } },
          booking: { select: { publicId: true, jobNumber: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
    "Failed to fetch invoices"
  );

  return rows.map((row) => {
    const displayJobNumber = resolveInvoiceDisplayJobNumber(row);

    return {
      id: row.id,
      jobNumber: displayJobNumber ?? "Pending",
      invoiceNumber: row.invoiceNumber,
      invoiceType: row.invoiceType,
      customerPhone: formatCustomerPhone(row.customer.phone),
      orderId: row.orderId,
      bookingId: row.bookingId,
      referenceLabel: formatInvoiceReference(row.booking?.publicId),
      totalAmount: formatMoney(row.totalAmount),
      paidAmount: formatMoney(row.paidAmount),
      remainingAmount: formatMoney(row.remainingAmount),
      status: mapInvoiceStatus(row.status),
      isLocked: row.isLocked,
      createdAt: formatDate(row.createdAt),
    };
  });
}

export async function getInvoiceById(id: string): Promise<InvoiceDetail | null> {
  return getInvoiceWithLineItems(id);
}

export async function getInvoiceWithLineItems(id: string): Promise<InvoiceDetail | null> {
  const row = await withRetry(
    () =>
      db.invoice.findUnique({
        where: { id },
        include: {
          customer: { select: { phone: true } },
          order: { select: { jobNumber: true } },
          booking: { select: { publicId: true, jobNumber: true } },
          parentInvoice: { select: { id: true, invoiceNumber: true } },
          payments: { orderBy: { paidAt: "desc" } },
          lineItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
          adjustments: {
            where: { invoiceType: InvoiceType.ADJUSTMENT },
            select: { id: true, invoiceNumber: true, totalAmount: true, status: true },
            orderBy: { createdAt: "desc" },
          },
        },
      }),
    "Failed to fetch invoice"
  );

  if (!row) return null;

  const displayJobNumber = resolveInvoiceDisplayJobNumber(row);
  const lineItemsAreComputed =
    !row.isLocked &&
    row.lineItems.length === 0 &&
    row.orderId !== null &&
    row.invoiceType === InvoiceType.FINAL;
  const computedLineItems =
    lineItemsAreComputed && row.orderId
      ? await buildInvoiceLineItems(db, row.orderId)
      : null;
  const depositInvoice =
    row.invoiceType === InvoiceType.FINAL && row.financialCaseId
      ? await findDepositInvoiceForFinancialCase(row.financialCaseId)
      : null;
  const refundableAmount =
    row.isLocked &&
    (row.invoiceType === InvoiceType.FINAL ||
      row.invoiceType === InvoiceType.ADJUSTMENT)
      ? await computeRefundableAmountForInvoice(row.id, db)
      : null;
  const creditNoteCapacity =
    row.isLocked && row.invoiceType === InvoiceType.FINAL
      ? await computeCreditNoteCapacityForFinal(row.id, db)
      : null;
  const effectivePaidAmount = await computeEffectivePaidFromAllocations(row.id, db);
  const overpaidAmount = Prisma.Decimal.max(
    effectivePaidAmount.minus(row.totalAmount),
    0
  );

  return {
    id: row.id,
    jobNumber: displayJobNumber ?? "Pending",
    invoiceNumber: row.invoiceNumber,
    invoiceType: row.invoiceType,
    customerPhone: formatCustomerPhone(row.customer.phone),
    orderId: row.orderId,
    bookingId: row.bookingId,
    referenceLabel: formatInvoiceReference(row.booking?.publicId),
    totalAmount: formatMoney(row.totalAmount),
    paidAmount: formatMoney(row.paidAmount),
    remainingAmount: formatMoney(row.remainingAmount),
    depositInvoiceNumber: depositInvoice?.invoiceNumber ?? null,
    depositPaidAmount: depositInvoice ? formatMoney(depositInvoice.paidAmount) : null,
    refundableAmount: refundableAmount ? formatMoney(refundableAmount) : null,
    creditNoteCapacity: creditNoteCapacity ? formatMoney(creditNoteCapacity) : null,
    isOverpaid: overpaidAmount.greaterThan(0),
    overpaidAmount: overpaidAmount.greaterThan(0) ? formatMoney(overpaidAmount) : null,
    lineItemsAreComputed,
    status: mapInvoiceStatus(row.status),
    isLocked: row.isLocked,
    createdAt: formatDate(row.createdAt),
    notes: row.notes ?? "—",
    parentInvoiceId: row.parentInvoice?.id ?? null,
    parentInvoiceNumber: row.parentInvoice?.invoiceNumber ?? null,
    payments: row.payments.map((payment) => ({
      id: payment.id,
      publicId: payment.publicId,
      jobNumber: payment.jobNumber ?? "Pending",
      amount: formatMoney(payment.amount),
      method: formatEnum(payment.method),
      paymentType: formatEnum(payment.paymentType),
      paidAt: formatDate(payment.paidAt),
      reference: payment.reference ?? "—",
      notes: payment.notes ?? "—",
      direction: payment.direction,
      refundOfPaymentId: payment.refundOfPaymentId,
    })),
    adjustments: row.adjustments.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      totalAmount: formatMoney(invoice.totalAmount),
      status: mapInvoiceStatus(invoice.status),
    })),
    lineItems:
      computedLineItems?.map((item, index) => mapComputedInvoiceLineItem(item, index)) ??
      row.lineItems.map(mapInvoiceLineItem),
  };
}

export async function issueInvoice(
  id: string,
  actorContext: ActorContext = {}
): Promise<void> {
  await withRetry(
    () =>
      db.$transaction((tx) => issueInvoiceWithClient(tx, id, actorContext)),
    "Failed to issue invoice"
  );
}

export async function issueInvoiceWithClient(
  client: DbClient,
  id: string,
  actorContext: ActorContext = {}
): Promise<void> {
  const invoice = await client.invoice.findUnique({
    where: { id },
    select: {
      id: true,
      invoiceNumber: true,
      orderId: true,
      isLocked: true,
    },
  });
  if (!invoice) {
    throw new Error("Invoice not found");
  }
  if (invoice.isLocked) {
    throw new Error("Invoice is locked or not found");
  }

  const result = await client.invoice.updateMany({
    where: { id, isLocked: false },
    data: { status: InvoiceStatus.ISSUED, issuedAt: new Date() },
  });
  if (result.count === 0) {
    throw new Error("Invoice is locked or not found");
  }

  if (invoice.orderId) {
    await recordOrderActivity(client, {
      orderId: invoice.orderId,
      userId: actorContext.actorUserId ?? null,
      type: OrderActivityType.INVOICE_ADJUSTED,
      title: "Invoice issued",
      description: `Invoice ${invoice.invoiceNumber} was issued.`,
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: InvoiceStatus.ISSUED,
      },
    });
  }
}

export async function snapshotInvoiceLineItems(
  invoiceId: string,
  orderId: string
): Promise<void> {
  await withRetry(
    () =>
      db.$transaction((tx) =>
        snapshotInvoiceLineItemsWithClient(tx, invoiceId, orderId)
      ),
    "Failed to snapshot invoice line items"
  );
}

export async function snapshotInvoiceLineItemsWithClient(
  client: DbClient,
  invoiceId: string,
  orderId: string
): Promise<void> {
  const existingLineCount = await client.invoiceLineItem.count({
    where: { invoiceId },
  });
  if (existingLineCount > 0) return;

  const invoice = await client.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, orderId: true, isLocked: true },
  });
  if (!invoice) {
    throw new Error("Invoice not found");
  }
  if (invoice.isLocked) {
    throw new Error("Invoice is locked or not found");
  }
  if (invoice.orderId !== orderId) {
    throw new Error("Invoice does not belong to this order");
  }

  const lineItems = await buildInvoiceLineItems(client, orderId);
  if (lineItems.length === 0) return;

  await client.invoiceLineItem.createMany({
    data: lineItems.map((item) => ({ invoiceId, ...item })),
    skipDuplicates: true,
  });
}

export async function closeInvoice(
  id: string,
  actorContext: ActorContext = {}
): Promise<void> {
  await withRetry(
    () =>
      db.$transaction(async (tx) => {
        const invoice = await tx.invoice.findUnique({
          where: { id },
          select: {
            id: true,
            invoiceNumber: true,
            orderId: true,
            isLocked: true,
          },
        });
        if (!invoice) {
          throw new Error("Invoice not found");
        }
        if (invoice.isLocked) {
          throw new Error("Invoice is already locked");
        }

        if (invoice.orderId) {
          await snapshotInvoiceLineItemsWithClient(tx, invoice.id, invoice.orderId);
        }

        await tx.invoice.update({
          where: { id },
          data: {
            status: InvoiceStatus.CLOSED,
            isLocked: true,
            closedAt: new Date(),
          },
        });

        if (invoice.orderId) {
          await recordOrderActivity(tx, {
            orderId: invoice.orderId,
            userId: actorContext.actorUserId ?? null,
            type: OrderActivityType.INVOICE_ADJUSTED,
            title: "Invoice closed",
            description: `Invoice ${invoice.invoiceNumber} was closed and locked.`,
            metadata: {
              invoiceId: invoice.id,
              invoiceNumber: invoice.invoiceNumber,
              status: InvoiceStatus.CLOSED,
              locked: true,
            },
          });
        }
      }),
    "Failed to close invoice"
  );
}

export async function recalculateInvoiceStatus(id: string, client: DbClient = db): Promise<void> {
  const invoice = await client.invoice.findUnique({
    where: { id },
    include: { payments: { select: { amount: true } } },
  });
  if (!invoice) throw new Error("Invoice not found");

  const directPaidAmount = invoice.payments.reduce(
    (sum, payment) => sum.plus(payment.amount),
    new Prisma.Decimal(0)
  );
  const effectivePaidAmount = await computeEffectivePaidFromAllocations(
    invoice.id,
    client
  );
  const remainingAmount = Prisma.Decimal.max(
    invoice.totalAmount.minus(effectivePaidAmount),
    0
  );
  let status: InvoiceStatus = invoice.status;
  if (
    invoice.status !== InvoiceStatus.CLOSED &&
    invoice.status !== InvoiceStatus.DRAFT
  ) {
    status = InvoiceStatus.ISSUED;
    if (
      effectivePaidAmount.greaterThan(0) &&
      effectivePaidAmount.lessThan(invoice.totalAmount)
    ) {
      status = InvoiceStatus.PARTIAL;
    }
    if (effectivePaidAmount.greaterThanOrEqualTo(invoice.totalAmount)) {
      status = InvoiceStatus.PAID;
    }
  }

  await client.invoice.update({
    where: { id },
    data: { paidAmount: directPaidAmount, remainingAmount, status },
  });
}

async function createSyncedOrderInvoice(
  client: DbClient,
  data: {
    orderId: string;
    bookingId: string;
    customerId: string;
    financialCaseId: string;
    jobId: string;
    jobNumber: string;
    totalAmount: Prisma.Decimal;
  }
) {
  const existingInvoice = await findPrimaryWorkflowInvoiceForOrder(client, {
    financialCaseId: data.financialCaseId,
  });
  if (existingInvoice) {
    const updateResult = await client.invoice.updateMany({
      where: {
        id: existingInvoice.id,
        isLocked: false,
        lineItems: { none: {} },
      },
      data: { totalAmount: data.totalAmount },
    });
    if (updateResult.count === 0) {
      throw new Error("Only unsnapshotted unlocked invoices can be recalculated");
    }

    const refreshedInvoice = await client.invoice.findUnique({
      where: { id: existingInvoice.id },
      select: {
        id: true,
        invoiceNumber: true,
        totalAmount: true,
        paidAmount: true,
        remainingAmount: true,
        status: true,
      },
    });
    if (!refreshedInvoice) {
      throw new Error("Invoice not found after update");
    }

    return refreshedInvoice;
  }

  const invoiceNumberData = await generateInvoiceNumber(client, InvoiceType.FINAL);
  try {
    const createdInvoice = await client.invoice.create({
      data: {
        publicId: await generatePublicId(client, PUBLIC_ID_KIND.INVOICE),
        financialCaseId: data.financialCaseId,
        invoiceType: InvoiceType.FINAL,
        jobId: data.jobId,
        jobNumber: data.jobNumber,
        orderId: data.orderId,
        bookingId: data.bookingId,
        customerId: data.customerId,
        ...invoiceNumberData,
        totalAmount: data.totalAmount,
        remainingAmount: data.totalAmount,
        status: InvoiceStatus.DRAFT,
      },
      select: {
        id: true,
        invoiceNumber: true,
        totalAmount: true,
        paidAmount: true,
        remainingAmount: true,
        status: true,
      },
    });

    await applyDepositToFinalIfPresent(
      data.financialCaseId,
      createdInvoice.id,
      client
    );

    return createdInvoice;
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    const racedInvoice = await findPrimaryWorkflowInvoiceForOrder(client, {
      financialCaseId: data.financialCaseId,
    });
    if (!racedInvoice) throw error;

    const refreshedInvoice = await client.invoice.findUnique({
      where: { id: racedInvoice.id },
      select: {
        id: true,
        invoiceNumber: true,
        totalAmount: true,
        paidAmount: true,
        remainingAmount: true,
        status: true,
      },
    });
    if (!refreshedInvoice) {
      throw new Error("Invoice not found after duplicate-create recovery");
    }

    return refreshedInvoice;
  }
}

async function findPrimaryWorkflowInvoiceForOrder(
  client: DbClient,
  input: {
    financialCaseId: string;
  }
): Promise<{ id: string; status: InvoiceStatus } | null> {
  const invoices = await client.invoice.findMany({
    where: {
      parentInvoiceId: null,
      financialCaseId: input.financialCaseId,
      invoiceType: InvoiceType.FINAL,
    },
    select: { id: true, status: true },
    orderBy: { createdAt: "asc" },
  });

  if (invoices.length === 0) return null;
  if (invoices.length > 1) {
    throw new Error("Duplicate final invoices found for this financial case");
  }

  return invoices[0];
}

export async function applyDepositToFinalIfPresent(
  financialCaseId: string,
  finalInvoiceId: string,
  client: DbClient
): Promise<void> {
  const depositInvoice = await client.invoice.findFirst({
    where: {
      financialCaseId,
      invoiceType: InvoiceType.DEPOSIT,
      parentInvoiceId: null,
    },
    select: { id: true, paidAmount: true },
    orderBy: { createdAt: "asc" },
  });

  if (!depositInvoice || depositInvoice.paidAmount.lessThanOrEqualTo(0)) {
    return;
  }

  const existingApplication = await client.documentApplication.findUnique({
    where: {
      sourceInvoiceId_targetInvoiceId: {
        sourceInvoiceId: depositInvoice.id,
        targetInvoiceId: finalInvoiceId,
      },
    },
    select: { id: true },
  });
  if (existingApplication) {
    return;
  }

  try {
    await client.documentApplication.create({
      data: {
        sourceInvoiceId: depositInvoice.id,
        targetInvoiceId: finalInvoiceId,
        amountApplied: depositInvoice.paidAmount,
        notes: "Phase 1: deposit auto-application",
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
  }
}

function mapOrderAddOnRows(
  rows: Array<{
    productId: string | null;
    nameSnapshot: string;
    priceSnapshot: Prisma.Decimal;
    quantity: number;
  }>
): OrderAddOnLine[] {
  return rows.flatMap((row) => {
    const line: OrderAddOnLine = {
      ...(row.productId ? { productId: row.productId } : {}),
      name: row.nameSnapshot,
      price: row.priceSnapshot.toNumber(),
    };
    return Array.from({ length: row.quantity }, () => line);
  });
}

function combineOrderAddOnRows(
  addOns: Array<{
    productId?: string | null;
    nameSnapshot: string;
    priceSnapshot: Prisma.Decimal;
    quantity: number;
  }>,
  packageItemUpgrades: Array<{
    nameSnapshot: string;
    priceSnapshot: Prisma.Decimal;
    quantity: number;
  }>
) {
  return [
    ...addOns.map((addOn) => ({
      productId: addOn.productId ?? null,
      nameSnapshot: addOn.nameSnapshot,
      priceSnapshot: addOn.priceSnapshot,
      quantity: addOn.quantity,
    })),
    ...packageItemUpgrades.map((upgrade) => ({
      productId: null,
      nameSnapshot: upgrade.nameSnapshot,
      priceSnapshot: upgrade.priceSnapshot,
      quantity: upgrade.quantity,
    })),
  ];
}

function sumAddOns(addOns: OrderAddOnLine[]): Prisma.Decimal {
  return addOns.reduce(
    (sum, addOn) => sum.plus(new Prisma.Decimal(addOn.price)),
    new Prisma.Decimal(0)
  );
}

async function buildInvoiceLineItems(
  client: DbClient,
  orderId: string
): Promise<SnapshotInvoiceLineItem[]> {
  const order = await client.order.findUnique({
    where: { id: orderId },
    include: {
      packages: {
        include: {
          package: {
            select: {
              id: true,
              name: true,
              price: true,
            },
          },
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
      orderAddOns: {
        select: { nameSnapshot: true, priceSnapshot: true, quantity: true },
        orderBy: { createdAt: "asc" },
      },
      packageItemUpgrades: {
        select: { nameSnapshot: true, priceSnapshot: true, quantity: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!order) throw new Error("Order not found");

  if (order.packages.length === 0) throw new Error("Order has no package lines");
  const lines: SnapshotInvoiceLineItem[] = [];
  let sortOrder = 0;

  for (const orderPackage of order.packages) {
    const packageRow = orderPackage.package;
    const finalSnapshot =
      orderPackage.finalPackagePriceSnapshot ?? packageRow.price;
    lines.push(
      createLineItem({
        lineType: InvoiceLineType.PACKAGE_BASE,
        description: packageRow.name,
        unitPrice: finalSnapshot,
        sortOrder: sortOrder++,
      })
    );

    for (const mediaType of [MediaType.DIGITAL, MediaType.PRINT] as const) {
      const quantity =
        mediaType === MediaType.DIGITAL
          ? orderPackage.extraDigitalCount
          : orderPackage.extraPrintCount;
      if (quantity <= 0) continue;
      const unitPrice = await getExtraPhotoUnitPriceWithClient(
        client,
        orderPackage.sessionTypeId,
        mediaType
      );
      lines.push(
        createLineItem({
          lineType: InvoiceLineType.EXTRA_PHOTOS,
          description: `Extra photos - ${formatEnum(mediaType)} (${packageRow.name})`,
          quantity,
          unitPrice,
          sortOrder: sortOrder++,
        })
      );
    }
  }

  for (const addOn of combineOrderAddOnRows(
    order.orderAddOns,
    order.packageItemUpgrades
  )) {
    lines.push(
      createLineItem({
        lineType: InvoiceLineType.ADD_ON,
        description: addOn.nameSnapshot,
        quantity: addOn.quantity,
        unitPrice: addOn.priceSnapshot,
        sortOrder: sortOrder++,
      })
    );
  }

  return lines;
}

function createLineItem({
  lineType,
  description,
  quantity = 1,
  unitPrice,
  sortOrder,
}: {
  lineType: InvoiceLineType;
  description: string;
  quantity?: number;
  unitPrice: Prisma.Decimal;
  sortOrder: number;
}): SnapshotInvoiceLineItem {
  return {
    lineType,
    description,
    quantity,
    unitPrice,
    lineTotal: unitPrice.mul(quantity),
    sortOrder,
  };
}

async function calculateOrderPackageExtraPhotoTotal(
  client: DbClient,
  orderId: string
): Promise<Prisma.Decimal> {
  const lines = await client.orderPackage.findMany({
    where: { orderId },
    select: {
      sessionTypeId: true,
      extraDigitalCount: true,
      extraPrintCount: true,
    },
  });
  if (lines.length === 0) return new Prisma.Decimal(0);

  let total = new Prisma.Decimal(0);
  for (const line of lines) {
    if (line.extraDigitalCount > 0) {
      const unitPrice = await getExtraPhotoUnitPriceWithClient(
        client,
        line.sessionTypeId,
        MediaType.DIGITAL
      );
      total = total.plus(unitPrice.mul(line.extraDigitalCount));
    }
    if (line.extraPrintCount > 0) {
      const unitPrice = await getExtraPhotoUnitPriceWithClient(
        client,
        line.sessionTypeId,
        MediaType.PRINT
      );
      total = total.plus(unitPrice.mul(line.extraPrintCount));
    }
  }
  return total;
}

function mapInvoiceLineItem(row: {
  id: string;
  lineType: InvoiceLineType;
  description: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  sortOrder: number;
  createdAt: Date;
}): InvoiceLineItem {
  return {
    id: row.id,
    lineType: row.lineType,
    description: row.description,
    quantity: row.quantity,
    unitPrice: formatMoney(row.unitPrice),
    lineTotal: formatMoney(row.lineTotal),
    sortOrder: row.sortOrder,
    createdAt: formatDate(row.createdAt),
  };
}

function mapComputedInvoiceLineItem(
  row: SnapshotInvoiceLineItem,
  index: number
): InvoiceLineItem {
  return {
    id: `computed-${row.sortOrder}-${index}`,
    lineType: row.lineType,
    description: row.description,
    quantity: row.quantity ?? 1,
    unitPrice: formatComputedMoney(row.unitPrice),
    lineTotal: formatComputedMoney(row.lineTotal),
    sortOrder: row.sortOrder ?? index,
    createdAt: "",
  };
}

function formatComputedMoney(value: SnapshotInvoiceLineItem["unitPrice"]): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "toFixed" in value &&
    typeof value.toFixed === "function"
  ) {
    return formatMoney(value);
  }

  return `${Number(value).toFixed(3)} KD`;
}

export async function createAdjustmentInvoice(
  input: CreateAdjustmentInvoiceInput,
  tx?: DbClient
): Promise<Invoice> {
  if (tx) {
    return createAdjustmentInvoiceWithClient(input, tx);
  }

  return withRetry(
    () => db.$transaction((transaction) =>
      createAdjustmentInvoiceWithClient(input, transaction)
    ),
    "Failed to create adjustment invoice"
  );
}

async function createAdjustmentInvoiceWithClient(
  input: CreateAdjustmentInvoiceInput,
  client: DbClient
): Promise<Invoice> {
  if (input.lines.length === 0) {
    throw new Error("Adjustment invoice requires at least one line");
  }

  const lineItems = input.lines.map((line, index) => {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error("Adjustment line quantity must be a positive whole number");
    }

    const unitPrice = new Prisma.Decimal(line.unitPrice);
    const lineTotal = unitPrice.mul(line.quantity);
    if (lineTotal.lessThanOrEqualTo(0)) {
      throw new Error("Adjustment line total must be greater than 0");
    }

    const description = line.description.trim();
    if (!description) {
      throw new Error("Adjustment line description is required");
    }

    return createLineItem({
      lineType: line.lineType,
      description,
      quantity: line.quantity,
      unitPrice,
      sortOrder: index,
    });
  });

  const parent = await client.invoice.findUnique({
    where: { id: input.parentFinalInvoiceId },
    select: {
      id: true,
      financialCaseId: true,
      invoiceType: true,
      orderId: true,
      bookingId: true,
      customerId: true,
      jobId: true,
      jobNumber: true,
      isLocked: true,
    },
  });
  if (!parent) throw new Error("Parent final invoice not found");
  if (parent.invoiceType !== InvoiceType.FINAL) {
    throw new Error("Adjustment invoices can only be created for final invoices");
  }
  if (!parent.isLocked) {
    throw new Error("Adjustment invoices can only be created for locked final invoices");
  }

  const totalAmount = input.lines.reduce(
    (sum, line) =>
      sum.plus(new Prisma.Decimal(line.unitPrice).mul(line.quantity)),
    new Prisma.Decimal(0)
  );
  const invoiceNumberData = await generateInvoiceNumber(client, InvoiceType.ADJUSTMENT);
  const invoice = await client.invoice.create({
    data: {
      publicId: await generatePublicId(client, PUBLIC_ID_KIND.INVOICE),
      financialCaseId: parent.financialCaseId,
      invoiceType: InvoiceType.ADJUSTMENT,
      jobId: parent.jobId,
      jobNumber: parent.jobNumber,
      orderId: parent.orderId,
      bookingId: parent.bookingId,
      customerId: parent.customerId,
      parentInvoiceId: parent.id,
      ...invoiceNumberData,
      totalAmount,
      remainingAmount: totalAmount,
      status: InvoiceStatus.ISSUED,
      notes: input.notes?.trim() || null,
      issuedAt: new Date(),
      lineItems: {
        create: lineItems,
      },
    },
  });

  if (parent.orderId) {
    await recordOrderActivity(client, {
      orderId: parent.orderId,
      userId: input.createdByUserId ?? null,
      type: OrderActivityType.INVOICE_ADJUSTED,
      title: "Adjustment invoice created",
      description: "Adjustment invoice was created from a locked final invoice.",
      metadata: {
        parentInvoiceId: parent.id,
        adjustmentInvoiceId: invoice.id,
        totalAmount: totalAmount.toFixed(3),
        lineCount: lineItems.length,
        notesPresent: Boolean(input.notes?.trim()),
      },
    });
  }

  await assertFinancialCaseInvariants(parent.financialCaseId, client);

  return invoice;
}

export async function computeRefundableAmountForInvoice(
  sourceInvoiceId: string,
  client: DbClient = db
): Promise<Prisma.Decimal> {
  const [inboundAllocations, priorRefunds] = await Promise.all([
    client.paymentAllocation.aggregate({
      _sum: { amount: true },
      where: {
        invoiceId: sourceInvoiceId,
        payment: { direction: "IN" },
      },
    }),
    client.invoice.aggregate({
      _sum: { totalAmount: true },
      where: {
        parentInvoiceId: sourceInvoiceId,
        invoiceType: InvoiceType.REFUND,
      },
    }),
  ]);

  const inboundTotal =
    inboundAllocations._sum.amount ?? new Prisma.Decimal(0);
  const refundedTotal = priorRefunds._sum.totalAmount ?? new Prisma.Decimal(0);

  return Prisma.Decimal.max(inboundTotal.minus(refundedTotal), 0);
}

export async function computeCreditNoteCapacityForFinal(
  targetFinalInvoiceId: string,
  client: DbClient = db
): Promise<Prisma.Decimal> {
  const target = await client.invoice.findUnique({
    where: { id: targetFinalInvoiceId },
    select: { id: true, totalAmount: true, invoiceType: true },
  });
  if (!target) throw new Error("Target final invoice not found");
  if (target.invoiceType !== InvoiceType.FINAL) {
    throw new Error("Credit notes can only target final invoices");
  }

  const priorCredits = await client.documentApplication.aggregate({
    _sum: { amountApplied: true },
    where: {
      targetInvoiceId: targetFinalInvoiceId,
      sourceInvoice: { invoiceType: InvoiceType.CREDIT_NOTE },
    },
  });
  const creditedTotal = priorCredits._sum.amountApplied ?? new Prisma.Decimal(0);

  return Prisma.Decimal.max(target.totalAmount.minus(creditedTotal), 0);
}

export async function createCreditNote(
  input: CreateCreditNoteInput,
  tx?: DbClient
): Promise<Invoice> {
  if (tx) {
    return createCreditNoteWithClient(input, tx);
  }

  return withRetry(
    () =>
      db.$transaction(
        (transaction) => createCreditNoteWithClient(input, transaction),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      ),
    "Failed to create credit note"
  );
}

async function createCreditNoteWithClient(
  input: CreateCreditNoteInput,
  client: DbClient
): Promise<Invoice> {
  if (input.lines.length === 0) {
    throw new Error("Credit note requires at least one line");
  }

  const reason = input.reason.trim();
  if (!reason) {
    throw new Error("Credit note reason is required");
  }

  const lineItems = input.lines.map((line, index) => {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error("Credit note line quantity must be a positive whole number");
    }

    const unitPrice = new Prisma.Decimal(line.unitPrice);
    const lineTotal = unitPrice.mul(line.quantity);
    if (lineTotal.lessThanOrEqualTo(0)) {
      throw new Error("Credit note line total must be greater than 0");
    }

    const description = line.description.trim();
    if (!description) {
      throw new Error("Credit note line description is required");
    }

    return createLineItem({
      lineType: InvoiceLineType.MANUAL_DISCOUNT,
      description,
      quantity: line.quantity,
      unitPrice,
      sortOrder: index,
    });
  });

  const totalAmount = lineItems.reduce(
    (sum, line) => sum.plus(new Prisma.Decimal(String(line.lineTotal))),
    new Prisma.Decimal(0)
  );
  if (totalAmount.lessThanOrEqualTo(0)) {
    throw new Error("Credit note total must be greater than 0");
  }

  const actor = await client.user.findUnique({
    where: { id: input.createdByUserId },
    select: { id: true, role: true },
  });
  if (
    !actor ||
    (actor.role !== UserRole.ADMIN && actor.role !== UserRole.MANAGER)
  ) {
    throw new Error("Manager permission is required to issue a credit note");
  }

  const target = await client.invoice.findUnique({
    where: { id: input.targetFinalInvoiceId },
    select: {
      id: true,
      financialCaseId: true,
      invoiceType: true,
      invoiceNumber: true,
      orderId: true,
      bookingId: true,
      customerId: true,
      jobId: true,
      jobNumber: true,
      totalAmount: true,
      isLocked: true,
    },
  });
  if (!target) throw new Error("Target final invoice not found");
  if (target.invoiceType !== InvoiceType.FINAL) {
    throw new Error("Credit notes can only target final invoices");
  }
  if (!target.isLocked) {
    throw new Error("Credit notes can only target locked final invoices");
  }

  const creditCapacity = await computeCreditNoteCapacityForFinal(target.id, client);
  if (totalAmount.greaterThan(creditCapacity)) {
    throw new Error(
      `Credit note amount cannot exceed remaining credit capacity (${creditCapacity.toFixed(3)} KD)`
    );
  }

  const now = new Date();
  const invoiceNumberData = await generateInvoiceNumber(
    client,
    InvoiceType.CREDIT_NOTE
  );
  const creditNote = await client.invoice.create({
    data: {
      publicId: await generatePublicId(client, PUBLIC_ID_KIND.INVOICE),
      financialCaseId: target.financialCaseId,
      invoiceType: InvoiceType.CREDIT_NOTE,
      jobId: target.jobId,
      jobNumber: target.jobNumber,
      orderId: target.orderId,
      bookingId: target.bookingId,
      customerId: target.customerId,
      parentInvoiceId: target.id,
      ...invoiceNumberData,
      totalAmount,
      paidAmount: new Prisma.Decimal(0),
      remainingAmount: new Prisma.Decimal(0),
      status: InvoiceStatus.CLOSED,
      isLocked: true,
      notes: input.notes?.trim() || reason,
      issuedAt: now,
      closedAt: now,
      lineItems: { create: lineItems },
    },
  });

  await client.documentApplication.create({
    data: {
      sourceInvoiceId: creditNote.id,
      targetInvoiceId: target.id,
      amountApplied: totalAmount,
      appliedAt: now,
      appliedByUserId: input.createdByUserId,
      notes: `Credit note for reason: ${reason}`,
    },
  });

  await recalculateInvoiceStatus(target.id, client);
  const effectivePaidAmount = await computeEffectivePaidFromAllocations(
    target.id,
    client
  );
  const refreshedTarget = await client.invoice.findUnique({
    where: { id: target.id },
    select: { totalAmount: true },
  });
  if (!refreshedTarget) {
    throw new Error("Target final invoice not found after credit note issuance");
  }
  const overpaidAmount = Prisma.Decimal.max(
    effectivePaidAmount.minus(refreshedTarget.totalAmount),
    0
  );

  if (target.orderId) {
    await recordOrderActivity(client, {
      orderId: target.orderId,
      userId: input.createdByUserId,
      type: OrderActivityType.INVOICE_ADJUSTED,
      title: "Credit note issued",
      description: `Credit note ${creditNote.invoiceNumber} issued against ${target.invoiceNumber}: ${totalAmount.toFixed(3)} KD for reason '${reason}'.`,
      metadata: {
        targetInvoiceId: target.id,
        targetInvoiceNumber: target.invoiceNumber,
        creditNoteId: creditNote.id,
        creditNoteNumber: creditNote.invoiceNumber,
        amount: totalAmount.toFixed(3),
        reason,
      },
    });

    if (overpaidAmount.greaterThan(0)) {
      await recordOrderActivity(client, {
        orderId: target.orderId,
        userId: input.createdByUserId,
        type: OrderActivityType.INVOICE_ADJUSTED,
        title: "Refund available",
        description: `FINAL ${target.invoiceNumber} is now overpaid by ${overpaidAmount.toFixed(3)} KD — refund available.`,
        metadata: {
          targetInvoiceId: target.id,
          targetInvoiceNumber: target.invoiceNumber,
          creditNoteId: creditNote.id,
          overpaidAmount: overpaidAmount.toFixed(3),
        },
      });
    }
  }

  await assertFinancialCaseInvariants(target.financialCaseId, client);

  return creditNote;
}

export async function createRefundInvoice(
  input: CreateRefundInvoiceInput,
  tx?: DbClient
): Promise<Invoice> {
  if (tx) {
    return createRefundInvoiceWithClient(input, tx);
  }

  return withRetry(
    () =>
      db.$transaction(
        (transaction) => createRefundInvoiceWithClient(input, transaction),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      ),
    "Failed to create refund invoice"
  );
}

async function createRefundInvoiceWithClient(
  input: CreateRefundInvoiceInput,
  client: DbClient
): Promise<Invoice> {
  const amount = new Prisma.Decimal(input.amount);
  if (amount.lessThanOrEqualTo(0)) {
    throw new Error("Refund amount must be greater than 0");
  }

  const reason = input.reason.trim();
  if (!reason) {
    throw new Error("Refund reason is required");
  }

  const actor = await client.user.findUnique({
    where: { id: input.createdByUserId },
    select: { id: true, role: true },
  });
  if (
    !actor ||
    (actor.role !== UserRole.ADMIN && actor.role !== UserRole.MANAGER)
  ) {
    throw new Error("Manager permission is required to issue a refund");
  }

  const source = await client.invoice.findUnique({
    where: { id: input.sourceInvoiceId },
    select: {
      id: true,
      financialCaseId: true,
      invoiceType: true,
      invoiceNumber: true,
      orderId: true,
      bookingId: true,
      customerId: true,
      jobId: true,
      jobNumber: true,
      isLocked: true,
    },
  });
  if (!source) throw new Error("Source invoice not found");
  if (
    source.invoiceType !== InvoiceType.FINAL &&
    source.invoiceType !== InvoiceType.ADJUSTMENT
  ) {
    throw new Error("Refunds can only be issued for final or adjustment invoices");
  }
  if (!source.isLocked) {
    throw new Error("Refunds can only be issued for locked invoices");
  }

  const refundableAmount = await computeRefundableAmountForInvoice(source.id, client);
  if (amount.greaterThan(refundableAmount)) {
    throw new Error(
      `Refund amount cannot exceed refundable balance (${refundableAmount.toFixed(3)} KD)`
    );
  }

  const invoiceNumberData = await generateInvoiceNumber(client, InvoiceType.REFUND);
  const invoice = await client.invoice.create({
    data: {
      publicId: await generatePublicId(client, PUBLIC_ID_KIND.INVOICE),
      financialCaseId: source.financialCaseId,
      invoiceType: InvoiceType.REFUND,
      jobId: source.jobId,
      jobNumber: source.jobNumber,
      orderId: source.orderId,
      bookingId: source.bookingId,
      customerId: source.customerId,
      parentInvoiceId: source.id,
      ...invoiceNumberData,
      totalAmount: amount,
      remainingAmount: amount,
      status: InvoiceStatus.ISSUED,
      notes: input.notes?.trim() || reason,
      issuedAt: new Date(),
      lineItems: {
        create: [
          createLineItem({
            lineType: InvoiceLineType.MANUAL_DISCOUNT,
            description: reason,
            quantity: 1,
            unitPrice: amount,
            sortOrder: 0,
          }),
        ],
      },
    },
  });

  if (source.orderId) {
    await recordOrderActivity(client, {
      orderId: source.orderId,
      userId: input.createdByUserId,
      type: OrderActivityType.INVOICE_ADJUSTED,
      title: "Refund invoice issued",
      description: `Refund invoice ${invoice.invoiceNumber} issued: ${amount.toFixed(3)} KD for reason '${reason}'.`,
      metadata: {
        sourceInvoiceId: source.id,
        sourceInvoiceNumber: source.invoiceNumber,
        refundInvoiceId: invoice.id,
        refundInvoiceNumber: invoice.invoiceNumber,
        amount: amount.toFixed(3),
        reason,
      },
    });
  }

  await assertFinancialCaseInvariants(source.financialCaseId, client);

  return invoice;
}

function buildInvoiceWhere(search: string | undefined): Prisma.InvoiceWhereInput | undefined {
  const trimmed = search?.trim();
  if (!trimmed) return undefined;
  const normalizedPhone = normalizePhoneSearch(trimmed);
  const identifierFilter = {
    startsWith: trimmed,
    mode: Prisma.QueryMode.insensitive,
  };

  return {
    OR: [
      { jobNumber: identifierFilter },
      { invoiceNumber: identifierFilter },
      ...(normalizedPhone
        ? [
            {
              customer: {
                is: {
                  phone: {
                    contains: normalizedPhone,
                    mode: Prisma.QueryMode.insensitive,
                  },
                },
              },
            },
          ]
        : []),
    ],
  };
}

function normalizePhoneSearch(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!/^\+?[\d\s\-().]+$/.test(trimmed)) {
    return undefined;
  }

  const normalized = trimmed.replace(/[\s\-().]/g, "");
  return normalized && normalized !== "+" ? normalized : undefined;
}

export async function generateInvoiceNumber(
  client: DbClient,
  invoiceType: InvoiceType = InvoiceType.FINAL
): Promise<InvoiceNumberData> {
  const rows = await client.$queryRaw<Array<{ invoice_seq: number | bigint }>>`
    SELECT nextval('"invoice_number_seq"') AS invoice_seq
  `;
  const nextValue = rows[0]?.invoice_seq;
  if (nextValue === undefined) {
    throw new Error("Unable to generate invoice number");
  }
  const invoiceSeq = Number(nextValue);
  return {
    invoiceSeq,
    invoiceNumber: `${getInvoiceNumberPrefix(invoiceType)}-${String(invoiceSeq).padStart(5, "0")}`,
  };
}

function getInvoiceNumberPrefix(invoiceType: InvoiceType): string {
  switch (invoiceType) {
    case InvoiceType.DEPOSIT:
      return "DEP";
    case InvoiceType.FINAL:
      return "INV";
    case InvoiceType.ADJUSTMENT:
      return "ADJ";
    case InvoiceType.REFUND:
      return "REF";
    case InvoiceType.CREDIT_NOTE:
      return "CN";
    case InvoiceType.SALE:
      return "SALE";
  }
}

function mapInvoiceStatus(status: InvoiceStatus): InvoiceStatusLabel {
  switch (status) {
    case InvoiceStatus.DRAFT:
      return "Draft";
    case InvoiceStatus.ISSUED:
      return "Issued";
    case InvoiceStatus.PARTIAL:
      return "Partial";
    case InvoiceStatus.PAID:
      return "Paid";
    case InvoiceStatus.CLOSED:
      return "Closed";
  }
}

function formatMoney(value: { toFixed(dp: number): string }): string {
  return `${value.toFixed(3)} KD`;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatEnum(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveInvoiceDisplayJobNumber(invoice: {
  jobNumber: string | null;
  order: { jobNumber: string | null } | null;
  booking: { jobNumber: string | null } | null;
}): string | null {
  return invoice.jobNumber ?? invoice.order?.jobNumber ?? invoice.booking?.jobNumber ?? null;
}

async function findDepositInvoiceForFinancialCase(
  financialCaseId: string
): Promise<{ invoiceNumber: string; paidAmount: Prisma.Decimal } | null> {
  return db.invoice.findFirst({
    where: {
      financialCaseId,
      invoiceType: InvoiceType.DEPOSIT,
      parentInvoiceId: null,
    },
    select: {
      invoiceNumber: true,
      paidAmount: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

function formatInvoiceReference(
  bookingReference: string | null | undefined
): string {
  if (bookingReference) {
    return bookingReference;
  }
  return "Pending";
}
