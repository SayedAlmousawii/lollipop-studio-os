import {
  InvoiceLineType,
  InvoiceStatus,
  InvoiceType,
  OrderActivityType,
  OrderStatus,
  Prisma,
} from "@prisma/client";
import type { ActorContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import { formatCustomerPhone } from "@/modules/customers/customer.utils";
import { PUBLIC_ID_KIND } from "@/modules/identifiers/identifier.constants";
import { generatePublicId } from "@/modules/identifiers/identifier.service";
import { recordOrderActivity } from "@/modules/orders/order-activity.service";
import type { CreateAdjustmentInvoiceInput } from "./invoice.schema";
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
      finalPackage: { select: { price: true, photoCount: true } },
      originalPackage: { select: { price: true, photoCount: true } },
      orderAddOns: {
        select: { productId: true, nameSnapshot: true, priceSnapshot: true, quantity: true },
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

  const packageAmount = order.finalPackage?.price ?? order.originalPackage?.price;
  if (!packageAmount) throw new Error("Order has no package price");
  const includedPhotoCount =
    order.finalPackage?.photoCount ?? order.originalPackage?.photoCount ?? 0;
  const extraPhotoCharge = await calculateExtraPhotoCharge(client, {
    selectedPhotoCount: order.selectedPhotoCount,
    includedPhotoCount,
  });
  const totalAmount = packageAmount
    .plus(sumAddOns(mapOrderAddOnRows(order.orderAddOns)))
    .plus(extraPhotoCharge);

  const invoiceNumberData = await generateInvoiceNumber(client);
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
      finalPackage: { select: { price: true, photoCount: true } },
      originalPackage: { select: { price: true, photoCount: true } },
      orderAddOns: {
        select: { productId: true, nameSnapshot: true, priceSnapshot: true, quantity: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!order) throw new Error("Order not found");
  const financialCaseId = order.booking.financialCase?.id;
  if (!financialCaseId) {
    throw new Error("Order financial case is required to sync a final invoice");
  }

  const packagePrice = order.finalPackage?.price ?? order.originalPackage?.price;
  if (!packagePrice) throw new Error("Order has no package price");

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

  const nextAddOns = mapOrderAddOnRows(order.orderAddOns);
  const previousAddOnTotal = sumAddOns(input.previousAddOns);
  const nextAddOnTotal = sumAddOns(nextAddOns);
  const includedPhotoCount =
    order.finalPackage?.photoCount ?? order.originalPackage?.photoCount ?? 0;
  const previousExtraPhotoCharge = await calculateExtraPhotoCharge(client, {
    selectedPhotoCount: input.previousSelectedPhotoCount,
    includedPhotoCount: input.previousIncludedPhotoCount ?? includedPhotoCount,
  });
  const nextExtraPhotoCharge = await calculateExtraPhotoCharge(client, {
    selectedPhotoCount: order.selectedPhotoCount,
    includedPhotoCount,
  });
  const previousSelectionAddOnTotal = previousAddOnTotal.plus(previousExtraPhotoCharge);
  const nextSelectionAddOnTotal = nextAddOnTotal.plus(nextExtraPhotoCharge);
  const targetTotalAmount = packagePrice.plus(nextSelectionAddOnTotal);
  if (existingInvoice?.isLocked) {
    throw new Error("Locked invoices cannot be recalculated from order edits");
  }
  if (existingInvoice && existingInvoice._count.lineItems > 0) {
    if (order.status === OrderStatus.DELIVERED) {
      throw new Error("Delivered order invoices cannot be recalculated from order edits");
    }
    await client.invoiceLineItem.deleteMany({
      where: { invoiceId: existingInvoice.id },
    });
  }

  const packageAdjustmentBaseline =
    order.originalPackagePriceSnapshot ??
    order.originalPackage?.price ??
    packagePrice;
  const packageAdjustmentAmount = packagePrice.minus(packageAdjustmentBaseline);
  const addOnAdjustmentAmount = nextSelectionAddOnTotal.minus(previousSelectionAddOnTotal);
  const totalAdjustmentAmount = packageAdjustmentAmount.plus(addOnAdjustmentAmount);

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

  return {
    invoiceId: recalculated.id,
    invoiceNumber: recalculated.invoiceNumber,
    totalAmount: formatMoney(recalculated.totalAmount),
    paidAmount: formatMoney(recalculated.paidAmount),
    remainingAmount: formatMoney(recalculated.remainingAmount),
    status: mapInvoiceStatus(recalculated.status),
    packageAdjustmentAmount,
    addOnAdjustmentAmount,
    totalAdjustmentAmount,
    packageAdjustmentBaseline,
    createdInvoice: !existingInvoice,
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
            select: { id: true, invoiceNumber: true, totalAmount: true, status: true },
            orderBy: { createdAt: "desc" },
          },
        },
      }),
    "Failed to fetch invoice"
  );

  if (!row) return null;

  const displayJobNumber = resolveInvoiceDisplayJobNumber(row);

  return {
    id: row.id,
    jobNumber: displayJobNumber ?? "Pending",
    invoiceNumber: row.invoiceNumber,
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
    })),
    adjustments: row.adjustments.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      totalAmount: formatMoney(invoice.totalAmount),
      status: mapInvoiceStatus(invoice.status),
    })),
    lineItems: row.lineItems.map(mapInvoiceLineItem),
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

  const paidAmount = invoice.payments.reduce(
    (sum, payment) => sum.plus(payment.amount),
    new Prisma.Decimal(0)
  );
  const remainingAmount = Prisma.Decimal.max(invoice.totalAmount.minus(paidAmount), 0);
  let status: InvoiceStatus =
    invoice.status === InvoiceStatus.DRAFT ? InvoiceStatus.DRAFT : InvoiceStatus.ISSUED;
  if (paidAmount.greaterThan(0) && paidAmount.lessThan(invoice.totalAmount)) {
    status = InvoiceStatus.PARTIAL;
  }
  if (paidAmount.greaterThanOrEqualTo(invoice.totalAmount)) {
    status = InvoiceStatus.PAID;
  }

  await client.invoice.update({
    where: { id },
    data: { paidAmount, remainingAmount, status },
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

  const invoiceNumberData = await generateInvoiceNumber(client);
  try {
    return await client.invoice.create({
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
      originalPackage: {
        select: { id: true, name: true, price: true, photoCount: true, bundleAdjustment: true },
      },
      finalPackage: {
        select: { id: true, name: true, price: true, photoCount: true, bundleAdjustment: true },
      },
      orderAddOns: {
        select: { nameSnapshot: true, priceSnapshot: true, quantity: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!order) throw new Error("Order not found");

  const originalPackage = order.originalPackage;
  const finalPackage = order.finalPackage;
  const basePackage = originalPackage ?? finalPackage;
  if (!basePackage) throw new Error("Order has no package price");

  const lines: SnapshotInvoiceLineItem[] = [];
  let sortOrder = 0;

  lines.push(
    createLineItem({
      lineType: InvoiceLineType.PACKAGE_BASE,
      description: basePackage.name,
      unitPrice: basePackage.price.minus(basePackage.bundleAdjustment),
      sortOrder: sortOrder++,
    })
  );

  if (!basePackage.bundleAdjustment.equals(0)) {
    lines.push(
      createLineItem({
        lineType: InvoiceLineType.BUNDLE_ADJUSTMENT,
        description: `${basePackage.name} bundle adjustment`,
        unitPrice: basePackage.bundleAdjustment,
        sortOrder: sortOrder++,
      })
    );
  }

  if (originalPackage && finalPackage && originalPackage.id !== finalPackage.id) {
    const upgradeAmount = finalPackage.price.minus(originalPackage.price);
    if (!upgradeAmount.equals(0)) {
      lines.push(
        createLineItem({
          lineType: InvoiceLineType.PACKAGE_UPGRADE,
          description: `Package upgrade (${originalPackage.name} to ${finalPackage.name})`,
          unitPrice: upgradeAmount,
          sortOrder: sortOrder++,
        })
      );
    }
  }

  for (const addOn of order.orderAddOns) {
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

  const includedPhotoCount =
    finalPackage?.photoCount ?? originalPackage?.photoCount ?? 0;
  const extraPhotoCount = Math.max(
    (order.selectedPhotoCount ?? includedPhotoCount) - includedPhotoCount,
    0
  );
  if (extraPhotoCount > 0) {
    const extraPhotoCharge = await calculateExtraPhotoCharge(client, {
      selectedPhotoCount: order.selectedPhotoCount,
      includedPhotoCount,
    });
    lines.push(
      createLineItem({
        lineType: InvoiceLineType.EXTRA_PHOTOS,
        description: "Extra photos",
        quantity: extraPhotoCount,
        unitPrice: extraPhotoCharge.div(extraPhotoCount),
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

async function calculateExtraPhotoCharge(
  client: DbClient,
  input: {
    selectedPhotoCount?: number | null;
    includedPhotoCount: number;
  }
): Promise<Prisma.Decimal> {
  const extraPhotoCount = Math.max(
    (input.selectedPhotoCount ?? input.includedPhotoCount) - input.includedPhotoCount,
    0
  );
  if (extraPhotoCount === 0) return new Prisma.Decimal(0);

  const extraPhotoOption = await client.product.findUnique({
    where: { id: "addon-extra-photo" },
    select: { canonicalPrice: true },
  });
  if (!extraPhotoOption) {
    throw new Error("Extra-photo product price is required");
  }

  return extraPhotoOption.canonicalPrice.mul(extraPhotoCount);
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

export async function createAdjustmentInvoice(
  parentInvoiceId: string,
  data: CreateAdjustmentInvoiceInput,
  actorContext: ActorContext = {}
): Promise<{ id: string }> {
  return withRetry(
    () =>
      db.$transaction(async (tx) => {
        const parent = await tx.invoice.findUnique({
          where: { id: parentInvoiceId },
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
        if (!parent) throw new Error("Parent invoice not found");
        if (!parent.isLocked) {
          throw new Error("Adjustment invoices can only be created for locked invoices");
        }
        if (parent.invoiceType !== InvoiceType.FINAL) {
          throw new Error("Adjustment invoices can only be created for final invoices");
        }

        const invoiceNumberData = await generateInvoiceNumber(tx);
        const invoice = await tx.invoice.create({
          data: {
            publicId: await generatePublicId(tx, PUBLIC_ID_KIND.INVOICE),
            financialCaseId: parent.financialCaseId,
            invoiceType: InvoiceType.ADJUSTMENT,
            jobId: parent.jobId,
            jobNumber: parent.jobNumber,
            orderId: parent.orderId,
            bookingId: parent.bookingId,
            customerId: parent.customerId,
            parentInvoiceId: parent.id,
            ...invoiceNumberData,
            totalAmount: new Prisma.Decimal(data.totalAmount),
            remainingAmount: new Prisma.Decimal(data.totalAmount),
            status: InvoiceStatus.DRAFT,
            notes: data.notes ?? null,
          },
          select: { id: true },
        });

        if (parent.orderId) {
          await recordOrderActivity(tx, {
            orderId: parent.orderId,
            userId: actorContext.actorUserId ?? null,
            type: OrderActivityType.INVOICE_ADJUSTED,
            title: "Adjustment invoice created",
            description: "Adjustment invoice was created from a locked invoice.",
            metadata: {
              parentInvoiceId: parent.id,
              adjustmentInvoiceId: invoice.id,
              totalAmount: new Prisma.Decimal(data.totalAmount).toFixed(3),
              notesPresent: Boolean(data.notes?.trim()),
            },
          });
        }

        return invoice;
      }),
    "Failed to create adjustment invoice"
  );
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

export async function generateInvoiceNumber(client: DbClient): Promise<InvoiceNumberData> {
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
    invoiceNumber: `INV-${String(invoiceSeq).padStart(5, "0")}`,
  };
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

function formatInvoiceReference(
  bookingReference: string | null | undefined
): string {
  if (bookingReference) {
    return bookingReference;
  }
  return "Pending";
}
