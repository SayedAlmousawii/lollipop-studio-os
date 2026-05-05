import { InvoiceStatus, OrderStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import { updateOrderSchema, type UpdateOrderInput } from "./order.schema";
import type {
  EditableOrder,
  InvoiceStatusFilter,
  InvoiceStatusLabel,
  Order,
  OrderAddOn,
  OrderDetail,
  OrderEditPackage,
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
type OrderWriteClient = Pick<Prisma.TransactionClient, "booking" | "order" | "invoice">;

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
    addonsSummary: formatAddOnsSummary(parseAddOns(row.addOns)),
    ...mapWorkflowStatus(row.status),
    notes: row.notes?.trim() ? row.notes : "—",
  };
}

export async function getEditableOrderById(
  orderId: string
): Promise<EditableOrder | null> {
  const row = await withRetry(
    () => fetchEditableOrderById(orderId),
    "Failed to fetch editable order"
  );

  if (!row) return null;

  return {
    id: row.id,
    customerName: row.customer.name,
    bookingDate: formatDate(row.booking.sessionDate),
    originalPackage: row.originalPackage ? mapEditPackage(row.originalPackage) : null,
    finalPackage: row.finalPackage ? mapEditPackage(row.finalPackage) : null,
    selectedPhotos:
      row.selectedPhotoCount ??
      row.finalPackage?.photoCount ??
      row.originalPackage?.photoCount ??
      0,
    addOns: parseAddOns(row.addOns),
    orderStatus: mapOrderStatus(row.status),
    notes: row.notes ?? "",
  };
}

export async function updateOrder(
  orderId: string,
  input: UpdateOrderInput
): Promise<EditableOrder> {
  const data = updateOrderSchema.parse(input);

  const row = await withRetry(
    () =>
      db.$transaction(async (tx) => {
        const [order, selectedPackage] = await Promise.all([
          tx.order.findUnique({
            where: { id: orderId },
            select: { id: true, status: true },
          }),
          tx.package.findUnique({
            where: { id: data.finalPackageId },
            select: { id: true },
          }),
        ]);

        if (!order) {
          throw new Error("Order not found");
        }
        if (order.status === OrderStatus.DELIVERED) {
          throw new Error("Delivered orders cannot be edited");
        }
        if (!selectedPackage) {
          throw new Error("Selected package does not exist");
        }

        return tx.order.update({
          where: { id: orderId },
          data: {
            finalPackage: { connect: { id: data.finalPackageId } },
            selectedPhotoCount: data.selectedPhotos,
            addOns: data.addOns,
            notes: data.notes?.trim() ? data.notes.trim() : null,
          },
          include: editableOrderInclude,
        });
      }),
    "Failed to update order"
  );

  return {
    id: row.id,
    customerName: row.customer.name,
    bookingDate: formatDate(row.booking.sessionDate),
    originalPackage: row.originalPackage ? mapEditPackage(row.originalPackage) : null,
    finalPackage: row.finalPackage ? mapEditPackage(row.finalPackage) : null,
    selectedPhotos: row.selectedPhotoCount ?? 0,
    addOns: parseAddOns(row.addOns),
    orderStatus: mapOrderStatus(row.status),
    notes: row.notes ?? "",
  };
}

export async function createOrderFromBooking(
  bookingId: string
): Promise<{ id: string }> {
  return withRetry(
    () => createOrderFromBookingWithClient(db, bookingId),
    "Failed to create order from booking",
    2
  );
}

export async function createOrderFromBookingWithClient(
  client: OrderWriteClient,
  bookingId: string
): Promise<{ id: string }> {
  const booking = await client.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      customer: { select: { id: true } },
      package: { select: { id: true } },
      order: { select: { id: true } },
    },
  });

  if (!booking) {
    throw new Error("Booking not found");
  }
  if (!booking.package) {
    throw new Error("Booking package is required to create an order");
  }
  if (booking.order) {
    await client.invoice.updateMany({
      where: {
        bookingId: booking.id,
        orderId: null,
      },
      data: { orderId: booking.order.id },
    });
    return booking.order;
  }

  const order = await client.order.create({
    data: {
      booking: { connect: { id: booking.id } },
      customer: { connect: { id: booking.customer.id } },
      originalPackage: { connect: { id: booking.package.id } },
      finalPackage: { connect: { id: booking.package.id } },
      selectedPhotoCount: 0,
      status: OrderStatus.ACTIVE,
    },
    select: { id: true },
  });

  await client.invoice.updateMany({
    where: {
      bookingId: booking.id,
      orderId: null,
    },
    data: { orderId: order.id },
  });

  return order;
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

const editableOrderInclude = {
  customer: { select: { name: true } },
  booking: { select: { sessionDate: true } },
  originalPackage: {
    select: {
      id: true,
      name: true,
      price: true,
      photoCount: true,
    },
  },
  finalPackage: {
    select: {
      id: true,
      name: true,
      price: true,
      photoCount: true,
    },
  },
} satisfies Prisma.OrderInclude;

async function fetchEditableOrderById(orderId: string) {
  return db.order.findUnique({
    where: { id: orderId },
    include: editableOrderInclude,
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

function mapEditPackage(packageRow: {
  id: string;
  name: string;
  price: { toNumber(): number; toFixed(dp: number): string };
  photoCount: number;
}): OrderEditPackage {
  return {
    id: packageRow.id,
    name: packageRow.name,
    price: packageRow.price.toNumber(),
    priceLabel: formatMoney(packageRow.price),
    photoCount: packageRow.photoCount,
  };
}

function parseAddOns(value: Prisma.JsonValue): OrderAddOn[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isJsonObject(item)) return [];
    const { name, price } = item;
    if (typeof name !== "string") return [];
    if (typeof price !== "number") return [];
    return [{ name, price }];
  });
}

function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatAddOnsSummary(addOns: OrderAddOn[]): string {
  if (addOns.length === 0) return "—";

  return addOns
    .map((addOn) => `${addOn.name} (${formatMoney(new Prisma.Decimal(addOn.price))})`)
    .join(", ");
}
