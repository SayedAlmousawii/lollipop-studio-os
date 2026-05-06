import { InvoiceStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import { PUBLIC_ID_KIND } from "@/modules/identifiers/identifier.constants";
import { generatePublicId } from "@/modules/identifiers/identifier.service";
import type { CreateAdjustmentInvoiceInput } from "./invoice.schema";
import type { InvoiceDetail, InvoiceListItem, InvoiceStatusLabel } from "./invoice.types";

type DbClient = typeof db | Prisma.TransactionClient;
type InvoiceNumberData = { invoiceSeq: number; invoiceNumber: string };

export async function createInvoiceForOrder(orderId: string): Promise<{ id: string }> {
  return withRetry(
    () => db.$transaction((tx) => createInvoiceForOrderWithClient(tx, orderId)),
    "Failed to create invoice"
  );
}

export async function createInvoiceForBooking(
  bookingId: string
): Promise<{ id: string; status: InvoiceStatus }> {
  return withRetry(
    () =>
      db.$transaction((tx) => createInvoiceForBookingWithClient(tx, bookingId)),
    "Failed to create invoice for booking"
  );
}

export async function createInvoiceForOrderWithClient(
  client: DbClient,
  orderId: string
): Promise<{ id: string; status: InvoiceStatus }> {
  const order = await client.order.findUnique({
    where: { id: orderId },
    include: {
      customer: { select: { id: true } },
      finalPackage: { select: { price: true } },
      originalPackage: { select: { price: true } },
    },
  });
  if (!order) throw new Error("Order not found");

  const totalAmount = order.finalPackage?.price ?? order.originalPackage?.price;
  if (!totalAmount) throw new Error("Order has no package price");

  const invoiceNumberData = await generateInvoiceNumber(client);
  return client.invoice.create({
    data: {
      publicId: await generatePublicId(client, PUBLIC_ID_KIND.INVOICE),
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
}

export async function createInvoiceForBookingWithClient(
  client: DbClient,
  bookingId: string
): Promise<{ id: string; status: InvoiceStatus }> {
  const booking = await client.booking.findUnique({
    where: { id: bookingId },
    include: {
      customer: { select: { id: true } },
      package: { select: { price: true } },
    },
  });
  if (!booking) throw new Error("Booking not found");

  const totalAmount = booking.package?.price;
  if (!totalAmount) throw new Error("Booking has no package price");

  const invoiceNumberData = await generateInvoiceNumber(client);
  return client.invoice.create({
    data: {
      publicId: await generatePublicId(client, PUBLIC_ID_KIND.INVOICE),
      jobNumber: booking.jobNumber,
      bookingId: booking.id,
      customerId: booking.customer.id,
      ...invoiceNumberData,
      totalAmount,
      remainingAmount: totalAmount,
      status: InvoiceStatus.DRAFT,
    },
    select: { id: true, status: true },
  });
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
          customer: { select: { name: true } },
          order: { select: { publicId: true } },
          booking: { select: { publicId: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
    "Failed to fetch invoices"
  );

  return rows.map((row) => ({
    id: row.id,
    publicId: row.publicId,
    jobNumber: row.jobNumber,
    invoiceNumber: row.invoiceNumber,
    customerName: row.customer.name,
    orderId: row.orderId,
    bookingId: row.bookingId,
    referenceLabel: formatInvoiceReference(row.order?.publicId, row.booking?.publicId),
    totalAmount: formatMoney(row.totalAmount),
    paidAmount: formatMoney(row.paidAmount),
    remainingAmount: formatMoney(row.remainingAmount),
    status: mapInvoiceStatus(row.status),
    isLocked: row.isLocked,
    createdAt: formatDate(row.createdAt),
  }));
}

export async function getInvoiceById(id: string): Promise<InvoiceDetail | null> {
  const row = await withRetry(
    () =>
      db.invoice.findUnique({
        where: { id },
        include: {
          customer: { select: { name: true } },
          order: { select: { publicId: true } },
          booking: { select: { publicId: true } },
          parentInvoice: { select: { id: true, invoiceNumber: true } },
          payments: { orderBy: { paidAt: "desc" } },
          adjustments: {
            select: { id: true, invoiceNumber: true, totalAmount: true, status: true },
            orderBy: { createdAt: "desc" },
          },
        },
      }),
    "Failed to fetch invoice"
  );

  if (!row) return null;

  return {
    id: row.id,
    publicId: row.publicId,
    jobNumber: row.jobNumber,
    invoiceNumber: row.invoiceNumber,
    customerName: row.customer.name,
    orderId: row.orderId,
    bookingId: row.bookingId,
    referenceLabel: formatInvoiceReference(row.order?.publicId, row.booking?.publicId),
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
      jobNumber: payment.jobNumber,
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
  };
}

export async function issueInvoice(id: string): Promise<void> {
  await withRetry(
    () => issueInvoiceWithClient(db, id),
    "Failed to issue invoice"
  );
}

export async function issueInvoiceWithClient(
  client: DbClient,
  id: string
): Promise<void> {
  const result = await client.invoice.updateMany({
    where: { id, isLocked: false },
    data: { status: InvoiceStatus.ISSUED, issuedAt: new Date() },
  });
  if (result.count === 0) {
    throw new Error("Invoice is locked or not found");
  }
}

export async function closeInvoice(id: string): Promise<void> {
  await withRetry(
    () =>
      db.invoice.update({
        where: { id },
        data: { status: InvoiceStatus.CLOSED, isLocked: true, closedAt: new Date() },
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
  if (invoice.isLocked) return;
  if (invoice.status === InvoiceStatus.DRAFT) return;

  const paidAmount = invoice.payments.reduce(
    (sum, payment) => sum.plus(payment.amount),
    new Prisma.Decimal(0)
  );
  const remainingAmount = Prisma.Decimal.max(invoice.totalAmount.minus(paidAmount), 0);
  let status: InvoiceStatus = InvoiceStatus.ISSUED;
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

export async function createAdjustmentInvoice(
  parentInvoiceId: string,
  data: CreateAdjustmentInvoiceInput
): Promise<{ id: string }> {
  return withRetry(
    () =>
      db.$transaction(async (tx) => {
        const parent = await tx.invoice.findUnique({
          where: { id: parentInvoiceId },
          select: {
            id: true,
            orderId: true,
            bookingId: true,
            customerId: true,
            jobNumber: true,
            isLocked: true,
          },
        });
        if (!parent) throw new Error("Parent invoice not found");
        if (!parent.isLocked) {
          throw new Error("Adjustment invoices can only be created for locked invoices");
        }

        const invoiceNumberData = await generateInvoiceNumber(tx);
        return tx.invoice.create({
          data: {
            publicId: await generatePublicId(tx, PUBLIC_ID_KIND.INVOICE),
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
      }),
    "Failed to create adjustment invoice"
  );
}

function buildInvoiceWhere(search: string | undefined): Prisma.InvoiceWhereInput | undefined {
  const trimmed = search?.trim();
  if (!trimmed) return undefined;
  const identifierFilter = {
    startsWith: trimmed,
    mode: Prisma.QueryMode.insensitive,
  };
  const customerNameFilter = {
    contains: trimmed,
    mode: Prisma.QueryMode.insensitive,
  };

  return {
    OR: [
      { publicId: identifierFilter },
      { jobNumber: identifierFilter },
      { invoiceNumber: identifierFilter },
      { customer: { is: { name: customerNameFilter } } },
      { order: { is: { publicId: identifierFilter } } },
      { booking: { is: { publicId: identifierFilter } } },
    ],
  };
}

async function generateInvoiceNumber(client: DbClient): Promise<InvoiceNumberData> {
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

function formatInvoiceReference(
  orderPublicId: string | null | undefined,
  bookingPublicId: string | null | undefined
): string {
  if (orderPublicId) {
    return `Order ${orderPublicId}`;
  }
  if (bookingPublicId) {
    return `Booking ${bookingPublicId} · Order pending`;
  }
  return "Order pending";
}
