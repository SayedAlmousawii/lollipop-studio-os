import { InvoiceStatus, OrderStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import type {
  InvoiceStatusFilter,
  InvoiceStatusLabel,
  Order,
  OrderDetail,
  OrderFilters,
  OrderStatusFilter,
  OrderStatusLabel,
} from "./order.types";

const ORDER_STATUS_FILTERS = new Set<OrderStatusFilter>([
  "ACTIVE",
  "WAITING_SELECTION",
  "EDITING",
  "PRODUCTION",
  "READY",
  "DELIVERED",
  "CANCELLED",
]);

const INVOICE_STATUS_FILTERS = new Set<InvoiceStatusFilter>([
  "DRAFT",
  "ISSUED",
  "PARTIAL",
  "PAID",
  "CLOSED",
]);

type OrderRow = Awaited<ReturnType<typeof fetchOrders>>[number];
type OrderDetailRow = NonNullable<Awaited<ReturnType<typeof fetchOrderById>>>;

export function parseOrderFilters(filters: {
  search?: string | string[];
  orderStatus?: string | string[];
  invoiceStatus?: string | string[];
}): OrderFilters {
  const search = singleValue(filters.search)?.trim();
  const orderStatus = singleValue(filters.orderStatus);
  const invoiceStatus = singleValue(filters.invoiceStatus);

  return {
    search: search ? search : undefined,
    orderStatus:
      orderStatus && ORDER_STATUS_FILTERS.has(orderStatus as OrderStatusFilter)
        ? (orderStatus as OrderStatusFilter)
        : undefined,
    invoiceStatus:
      invoiceStatus && INVOICE_STATUS_FILTERS.has(invoiceStatus as InvoiceStatusFilter)
        ? (invoiceStatus as InvoiceStatusFilter)
        : undefined,
  };
}

export async function getOrders(filters: OrderFilters = {}): Promise<Order[]> {
  const rows = await withRetry(
    () => fetchOrders(filters),
    "Failed to fetch orders"
  );

  return rows.map(mapOrderRow);
}

export async function getOrderById(orderId: string): Promise<OrderDetail | null> {
  const row = await withRetry(
    () => fetchOrderById(orderId),
    "Failed to fetch order"
  );

  if (!row) return null;
  const summary = mapOrderRow(row);
  const includedPhotoCount = row.finalPackage?.photoCount ?? row.originalPackage?.photoCount ?? null;
  const selectedPhotoCount = row.selectedPhotoCount ?? null;

  return {
    ...summary,
    sessionType: formatEnum(row.booking.sessionType),
    selectedPhotoCount: formatCount(selectedPhotoCount),
    includedPhotoCount: formatCount(includedPhotoCount),
    extraPhotoCount:
      selectedPhotoCount !== null && includedPhotoCount !== null
        ? String(Math.max(selectedPhotoCount - includedPhotoCount, 0))
        : "—",
    addonsSummary: "—",
    ...mapWorkflowStatus(row.status),
    notes: row.notes?.trim() ? row.notes : "—",
  };
}

async function fetchOrders(filters: OrderFilters) {
  const where: Prisma.OrderWhereInput = {
    ...(filters.search
      ? {
          customer: {
            name: {
              contains: filters.search,
              mode: "insensitive",
            },
          },
        }
      : {}),
    ...(filters.orderStatus ? { status: filters.orderStatus } : {}),
    ...(filters.invoiceStatus
      ? { invoices: { some: { status: filters.invoiceStatus } } }
      : {}),
  };

  return db.order.findMany({
    where,
    include: {
      customer: { select: { name: true } },
      booking: {
        select: {
          sessionDate: true,
          sessionType: true,
        },
      },
      originalPackage: {
        select: {
          name: true,
          photoCount: true,
        },
      },
      finalPackage: {
        select: {
          name: true,
          photoCount: true,
        },
      },
      invoices: {
        select: {
          id: true,
          totalAmount: true,
          paidAmount: true,
          remainingAmount: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function fetchOrderById(orderId: string) {
  return db.order.findUnique({
    where: { id: orderId },
    include: {
      customer: { select: { name: true } },
      booking: {
        select: {
          sessionDate: true,
          sessionType: true,
        },
      },
      originalPackage: {
        select: {
          name: true,
          photoCount: true,
        },
      },
      finalPackage: {
        select: {
          name: true,
          photoCount: true,
        },
      },
      invoices: {
        select: {
          id: true,
          totalAmount: true,
          paidAmount: true,
          remainingAmount: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

function mapOrderRow(row: OrderRow | OrderDetailRow): Order {
  const invoiceSummary = summarizeInvoices(row.invoices);

  return {
    id: row.id,
    customerName: row.customer.name,
    bookingDate: formatDate(row.booking.sessionDate),
    originalPackageName: row.originalPackage?.name ?? "—",
    finalPackageName: row.finalPackage?.name ?? row.originalPackage?.name ?? "—",
    orderStatus: mapOrderStatus(row.status),
    invoiceStatus: invoiceSummary.status,
    totalAmount: formatMoney(invoiceSummary.totalAmount),
    paidAmount: formatMoney(invoiceSummary.paidAmount),
    remainingAmount: formatMoney(invoiceSummary.remainingAmount),
    createdAt: formatDate(row.createdAt),
    primaryInvoiceId: row.invoices[0]?.id ?? null,
  };
}

function summarizeInvoices(invoices: OrderRow["invoices"]): {
  totalAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
  status: InvoiceStatusLabel;
} {
  const totalAmount = invoices.reduce(
    (sum, invoice) => sum.plus(invoice.totalAmount),
    zeroMoney()
  );
  const paidAmount = invoices.reduce(
    (sum, invoice) => sum.plus(invoice.paidAmount),
    zeroMoney()
  );
  const remainingAmount = invoices.reduce(
    (sum, invoice) => sum.plus(invoice.remainingAmount),
    zeroMoney()
  );

  return {
    totalAmount,
    paidAmount,
    remainingAmount,
    status: invoices[0] ? mapInvoiceStatus(invoices[0].status) : "No Invoice",
  };
}

function mapOrderStatus(status: OrderStatus): OrderStatusLabel {
  switch (status) {
    case OrderStatus.ACTIVE:
      return "Active";
    case OrderStatus.WAITING_SELECTION:
      return "Waiting Selection";
    case OrderStatus.EDITING:
      return "Editing";
    case OrderStatus.PRODUCTION:
      return "Production";
    case OrderStatus.READY:
      return "Ready";
    case OrderStatus.DELIVERED:
      return "Delivered";
    case OrderStatus.CANCELLED:
      return "Cancelled";
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

function mapWorkflowStatus(status: OrderStatus): Pick<
  OrderDetail,
  "selectionStatus" | "editingStatus" | "productionStatus" | "deliveryStatus"
> {
  switch (status) {
    case OrderStatus.ACTIVE:
      return {
        selectionStatus: "Not started",
        editingStatus: "Not started",
        productionStatus: "Not started",
        deliveryStatus: "Not ready",
      };
    case OrderStatus.WAITING_SELECTION:
      return {
        selectionStatus: "Waiting selection",
        editingStatus: "Not started",
        productionStatus: "Not started",
        deliveryStatus: "Not ready",
      };
    case OrderStatus.EDITING:
      return {
        selectionStatus: "Selected",
        editingStatus: "Editing",
        productionStatus: "Not started",
        deliveryStatus: "Not ready",
      };
    case OrderStatus.PRODUCTION:
      return {
        selectionStatus: "Selected",
        editingStatus: "Completed",
        productionStatus: "In production",
        deliveryStatus: "Not ready",
      };
    case OrderStatus.READY:
      return {
        selectionStatus: "Selected",
        editingStatus: "Completed",
        productionStatus: "Completed",
        deliveryStatus: "Ready",
      };
    case OrderStatus.DELIVERED:
      return {
        selectionStatus: "Selected",
        editingStatus: "Completed",
        productionStatus: "Completed",
        deliveryStatus: "Delivered",
      };
    case OrderStatus.CANCELLED:
      return {
        selectionStatus: "Cancelled",
        editingStatus: "Cancelled",
        productionStatus: "Cancelled",
        deliveryStatus: "Cancelled",
      };
  }
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatMoney(value: { toFixed(dp: number): string }): string {
  return `${value.toFixed(3)} KD`;
}

function formatCount(value: number | null): string {
  return value === null ? "—" : String(value);
}

function formatEnum(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function singleValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function zeroMoney(): Prisma.Decimal {
  return new Prisma.Decimal(0);
}
