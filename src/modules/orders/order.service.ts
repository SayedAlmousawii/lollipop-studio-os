import {
  InvoiceStatus,
  OrderActivityType,
  OrderDeliveryStatus,
  OrderEditingStatus,
  OrderProductionStatus,
  OrderSelectionStatus,
  OrderStatus,
  Prisma,
} from "@prisma/client";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import { syncUpgradeCommissionForOrder } from "@/modules/commissions/commission.service";
import { PUBLIC_ID_KIND } from "@/modules/identifiers/identifier.constants";
import { generatePublicId } from "@/modules/identifiers/identifier.service";
import { syncOrderInvoiceForFinancialEdit } from "@/modules/invoices/invoice.service";
import {
  ORDER_DELIVERY_STATUS_LABELS,
  ORDER_EDITING_STATUS_LABELS,
  ORDER_PRODUCTION_STATUS_LABELS,
  ORDER_SELECTION_STATUS_LABELS,
  ORDER_WORKFLOW_TRANSITIONS,
} from "./order.constants";
import {
  getOrderActivityTimeline,
  recordOrderActivity,
} from "./order-activity.service";
import {
  updateOrderSchema,
  updateOrderWorkflowSchema,
  type UpdateOrderInput,
  type UpdateOrderWorkflowInput,
} from "./order.schema";
import type {
  EditableOrder,
  InvoiceStatusFilter,
  InvoiceStatusLabel,
  Order,
  OrderAddOn,
  OrderActivityPreviewItem,
  OrderDetail,
  OrderEditPackage,
  OrderFilters,
  OrderPaymentStatusLabel,
  OrderStatusFilter,
  OrderStatusLabel,
  OrderWorkflowStep,
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
type OrderWriteClient = Prisma.TransactionClient;

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
  return mapOrderDetailRow(row);
}

function mapOrderDetailRow(row: OrderDetailRow): OrderDetail {
  const summary = mapOrderRow(row);
  const includedPhotoCount = row.finalPackage?.photoCount ?? row.originalPackage?.photoCount ?? null;
  const selectedPhotoCount = row.selectedPhotoCount ?? null;
  const workflowStatus = mapWorkflowStatus(row);

  return {
    ...summary,
    customerId: row.customerId,
    bookingId: row.bookingId,
    originalPackageId: row.originalPackageId,
    finalPackageId: row.finalPackageId,
    sessionDateTime: formatDateTime(row.booking.sessionDate),
    sessionType: formatEnum(row.booking.sessionType),
    selectedPhotoCount: formatCount(selectedPhotoCount),
    includedPhotoCount: formatCount(includedPhotoCount),
    extraPhotoCount:
      selectedPhotoCount !== null && includedPhotoCount !== null
        ? String(Math.max(selectedPhotoCount - includedPhotoCount, 0))
        : "—",
    addonsSummary: formatAddOnsSummary(parseAddOns(row.addOns)),
    ...workflowStatus,
    nextAction: resolveNextOrderAction({
      invoiceStatus: summary.invoiceStatus,
      paymentStatus: summary.paymentStatus,
      selectionStatus: workflowStatus.selectionStatus,
      editingStatus: workflowStatus.editingStatus,
      productionStatus: workflowStatus.productionStatus,
      deliveryStatus: workflowStatus.deliveryStatus,
    }),
    workflowSteps: buildWorkflowSteps(workflowStatus),
    recentActivity: [],
    notes: row.notes?.trim() ? row.notes : "—",
  };
}

export async function getOrderHubById(
  orderId: string
): Promise<OrderDetail | null> {
  const [order, activity] = await Promise.all([
    getOrderById(orderId),
    getOrderActivityTimeline(orderId),
  ]);

  if (!order) return null;

  return {
    ...order,
    recentActivity: activity.slice(-5).reverse().map(mapActivityPreviewItem),
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

  return mapEditableOrderRow(row);
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
            include: {
              finalPackage: { select: { id: true, name: true, price: true } },
              originalPackage: { select: { id: true, name: true, price: true } },
            },
          }),
          tx.package.findUnique({
            where: { id: data.finalPackageId },
            select: { id: true, name: true },
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
        const previousPackagePrice =
          order.finalPackage?.price ?? order.originalPackage?.price;
        if (!previousPackagePrice) {
          throw new Error("Order has no package price");
        }
        const previousAddOns = parseAddOns(order.addOns);
        const previousNotes = order.notes?.trim() ?? "";

        await tx.order.update({
          where: { id: orderId },
          data: {
            finalPackage: { connect: { id: data.finalPackageId } },
            selectedPhotoCount: data.selectedPhotos,
            addOns: data.addOns,
            notes: data.notes?.trim() ? data.notes.trim() : null,
          },
        });
        const invoiceSummary = await syncOrderInvoiceForFinancialEdit(tx, {
          orderId,
          previousPackagePrice,
          previousAddOns,
        });

        await syncUpgradeCommissionForOrder(tx, {
          orderId,
          upgradeAmount: invoiceSummary.packageAdjustmentAmount,
        });

        if (order.finalPackageId !== data.finalPackageId) {
          await recordOrderActivity(tx, {
            orderId,
            type: OrderActivityType.PACKAGE_CHANGED,
            title: "Package changed",
            description: `${order.finalPackage?.name ?? order.originalPackage?.name ?? "Package"} changed to ${selectedPackage.name}.`,
            metadata: {
              previousPackageId: order.finalPackageId ?? order.originalPackageId,
              previousPackageName: order.finalPackage?.name ?? order.originalPackage?.name ?? null,
              nextPackageId: selectedPackage.id,
              nextPackageName: selectedPackage.name,
              packageAdjustmentAmount: invoiceSummary.packageAdjustmentAmount.toFixed(3),
              recognizedPackageBaseline: invoiceSummary.recognizedPackageBaseline.toFixed(3),
            },
          });
        }

        if (!areAddOnsEqual(previousAddOns, data.addOns)) {
          await recordOrderActivity(tx, {
            orderId,
            type: OrderActivityType.ADD_ON_CHANGED,
            title: "Add-ons changed",
            description: "Order add-ons were updated.",
            metadata: {
              previousAddOns: serializeAddOnsForMetadata(previousAddOns),
              nextAddOns: serializeAddOnsForMetadata(data.addOns),
              addOnAdjustmentAmount: invoiceSummary.addOnAdjustmentAmount.toFixed(3),
            },
          });
        }

        if (!invoiceSummary.totalAdjustmentAmount.equals(0) || invoiceSummary.createdInvoice) {
          await recordOrderActivity(tx, {
            orderId,
            type: OrderActivityType.INVOICE_ADJUSTED,
            title: invoiceSummary.createdInvoice ? "Invoice created" : "Invoice adjusted",
            description: `Invoice ${invoiceSummary.invoiceNumber} now totals ${invoiceSummary.totalAmount}.`,
            metadata: {
              invoiceId: invoiceSummary.invoiceId,
              invoicePublicId: invoiceSummary.invoicePublicId,
              invoiceNumber: invoiceSummary.invoiceNumber,
              totalAmount: invoiceSummary.totalAmount,
              paidAmount: invoiceSummary.paidAmount,
              remainingAmount: invoiceSummary.remainingAmount,
              status: invoiceSummary.status,
              totalAdjustmentAmount: invoiceSummary.totalAdjustmentAmount.toFixed(3),
              packageAdjustmentAmount: invoiceSummary.packageAdjustmentAmount.toFixed(3),
              addOnAdjustmentAmount: invoiceSummary.addOnAdjustmentAmount.toFixed(3),
            },
          });
        }

        const nextNotes = data.notes?.trim() ?? "";
        if (previousNotes !== nextNotes && nextNotes) {
          await recordOrderActivity(tx, {
            orderId,
            type: OrderActivityType.NOTE_ADDED,
            title: "Note updated",
            description: "Order notes were updated.",
            metadata: {
              previousNotePresent: previousNotes.length > 0,
              nextNoteLength: nextNotes.length,
            },
          });
        }

        return tx.order.findUniqueOrThrow({
          where: { id: orderId },
          include: editableOrderInclude,
        });
      }),
    "Failed to update order"
  );

  return mapEditableOrderRow(row);
}

export async function updateOrderWorkflowStatus(
  orderId: string,
  input: UpdateOrderWorkflowInput
): Promise<OrderDetail> {
  const data = updateOrderWorkflowSchema.parse(input);

  const row = await withRetry(
    () =>
      db.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            status: true,
            selectionStatus: true,
            editingStatus: true,
            productionStatus: true,
            deliveryStatus: true,
          },
        });

        if (!order) {
          throw new Error("Order not found");
        }
        if (order.status === OrderStatus.CANCELLED) {
          throw new Error("Cancelled orders cannot be moved through workflow");
        }
        if (data.selectionStatus) {
          assertWorkflowTransition(
            "selectionStatus",
            order.selectionStatus,
            data.selectionStatus
          );
        }
        if (data.editingStatus) {
          assertWorkflowTransition(
            "editingStatus",
            order.editingStatus,
            data.editingStatus
          );
        }
        if (data.productionStatus) {
          assertWorkflowTransition(
            "productionStatus",
            order.productionStatus,
            data.productionStatus
          );
        }
        if (data.deliveryStatus) {
          assertWorkflowTransition(
            "deliveryStatus",
            order.deliveryStatus,
            data.deliveryStatus
          );
        }

        await tx.order.update({
          where: { id: orderId },
          data,
        });

        await recordWorkflowActivities(tx, orderId, {
          selectionStatus: order.selectionStatus,
          editingStatus: order.editingStatus,
          productionStatus: order.productionStatus,
          deliveryStatus: order.deliveryStatus,
        }, data);

        return fetchOrderByIdWithClient(tx, orderId);
      }),
    "Failed to update order workflow status"
  );

  if (!row) {
    throw new Error("Order not found after workflow update");
  }

  return mapOrderDetailRow(row);
}

export async function createOrderFromBooking(
  bookingId: string
): Promise<{ id: string }> {
  return withRetry(
    () => db.$transaction((tx) => createOrderFromBookingWithClient(tx, bookingId)),
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
      jobNumber: true,
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
      publicId: await generatePublicId(client, PUBLIC_ID_KIND.ORDER),
      jobNumber: booking.jobNumber,
      booking: { connect: { id: booking.id } },
      customer: { connect: { id: booking.customer.id } },
      originalPackage: { connect: { id: booking.package.id } },
      finalPackage: { connect: { id: booking.package.id } },
      selectedPhotoCount: 0,
      status: OrderStatus.ACTIVE,
    },
    select: { id: true },
  });

  await recordOrderActivity(client, {
    orderId: order.id,
    type: OrderActivityType.ORDER_CREATED,
    title: "Order created",
    description: "Order was created from the completed booking.",
    metadata: {
      bookingId: booking.id,
      jobNumber: booking.jobNumber,
      originalPackageId: booking.package.id,
      finalPackageId: booking.package.id,
    },
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
          OR: [
            {
              customer: {
                name: {
                  contains: filters.search,
                  mode: "insensitive",
                },
              },
            },
            {
              publicId: {
                contains: filters.search,
                mode: "insensitive",
              },
            },
            {
              jobNumber: {
                contains: filters.search,
                mode: "insensitive",
              },
            },
          ],
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
          publicId: true,
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
  return fetchOrderByIdWithClient(db, orderId);
}

function fetchOrderByIdWithClient(
  client: Pick<typeof db, "order"> | Prisma.TransactionClient,
  orderId: string
) {
  return client.order.findUnique({
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
          publicId: true,
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
  invoices: {
    where: { parentInvoiceId: null },
    select: {
      id: true,
      publicId: true,
      invoiceNumber: true,
      totalAmount: true,
      paidAmount: true,
      remainingAmount: true,
      status: true,
      isLocked: true,
    },
    orderBy: { createdAt: "asc" },
    take: 1,
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
    publicId: row.publicId,
    jobNumber: row.jobNumber,
    customerName: row.customer.name,
    bookingDate: formatDate(row.booking.sessionDate),
    originalPackageName: row.originalPackage?.name ?? "—",
    finalPackageName: row.finalPackage?.name ?? row.originalPackage?.name ?? "—",
    orderStatus: mapOrderStatus(row.status),
    invoiceStatus: invoiceSummary.status,
    paymentStatus: invoiceSummary.paymentStatus,
    totalAmount: formatMoney(invoiceSummary.totalAmount),
    paidAmount: formatMoney(invoiceSummary.paidAmount),
    remainingAmount: formatMoney(invoiceSummary.remainingAmount),
    createdAt: formatDate(row.createdAt),
    primaryInvoiceId: row.invoices[0]?.id ?? null,
    primaryInvoicePublicId: row.invoices[0]?.publicId ?? null,
  };
}

function summarizeInvoices(invoices: OrderRow["invoices"]): {
  totalAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
  status: InvoiceStatusLabel;
  paymentStatus: OrderPaymentStatusLabel;
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
    paymentStatus: mapPaymentStatus(invoices, totalAmount, paidAmount, remainingAmount),
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

function mapPaymentStatus(
  invoices: OrderRow["invoices"],
  totalAmount: Prisma.Decimal,
  paidAmount: Prisma.Decimal,
  remainingAmount: Prisma.Decimal
): OrderPaymentStatusLabel {
  if (invoices.some((invoice) => invoice.status === InvoiceStatus.CLOSED && remainingAmount.gt(0))) {
    return "Overridden";
  }
  if (invoices.length === 0 || paidAmount.lte(0)) {
    return "Pending";
  }
  if (totalAmount.gt(0) && remainingAmount.lte(0)) {
    return "Paid";
  }
  return "Partially paid";
}

function mapWorkflowStatus(row: Pick<
  OrderDetailRow,
  "selectionStatus" | "editingStatus" | "productionStatus" | "deliveryStatus"
>): Pick<OrderDetail, "selectionStatus" | "editingStatus" | "productionStatus" | "deliveryStatus"> {
  return {
    selectionStatus: ORDER_SELECTION_STATUS_LABELS[row.selectionStatus],
    editingStatus: ORDER_EDITING_STATUS_LABELS[row.editingStatus],
    productionStatus: ORDER_PRODUCTION_STATUS_LABELS[row.productionStatus],
    deliveryStatus: ORDER_DELIVERY_STATUS_LABELS[row.deliveryStatus],
  };
}

function buildWorkflowSteps(
  workflow: Pick<
    OrderDetail,
    "selectionStatus" | "editingStatus" | "productionStatus" | "deliveryStatus"
  >
): OrderWorkflowStep[] {
  return [
    workflowStep("Selection", workflow.selectionStatus),
    workflowStep("Editing", workflow.editingStatus),
    workflowStep("Production", workflow.productionStatus),
    workflowStep("Delivery", workflow.deliveryStatus),
  ];
}

function workflowStep(label: string, status: string): OrderWorkflowStep {
  return {
    label,
    status,
    tone: resolveWorkflowTone(status),
  };
}

function resolveWorkflowTone(status: string): OrderWorkflowStep["tone"] {
  if (status === "Completed" || status === "Approved" || status === "Picked up") {
    return "complete";
  }
  if (
    status === "Pending" ||
    status === "Not started" ||
    status === "Waiting for editing" ||
    status === "Not ready"
  ) {
    return "pending";
  }
  return "active";
}

function resolveNextOrderAction(input: {
  invoiceStatus: InvoiceStatusLabel;
  paymentStatus: OrderPaymentStatusLabel;
  selectionStatus: string;
  editingStatus: string;
  productionStatus: string;
  deliveryStatus: string;
}): string {
  if (input.invoiceStatus === "No Invoice") {
    return "Create the order invoice";
  }
  if (input.paymentStatus !== "Paid" && input.paymentStatus !== "Overridden") {
    return "Review invoice payment";
  }
  if (input.selectionStatus !== "Completed") {
    return "Continue photo selection";
  }
  if (input.editingStatus !== "Completed") {
    return "Move editing forward";
  }
  if (input.productionStatus !== "Completed") {
    return "Track production progress";
  }
  if (input.deliveryStatus !== "Completed") {
    return "Prepare delivery";
  }
  return "Order complete";
}

function mapActivityPreviewItem(item: {
  id: string;
  title: string;
  description: string | null;
  createdAt: string;
}): OrderActivityPreviewItem {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    createdAt: item.createdAt,
  };
}

function assertWorkflowTransition(
  field: "selectionStatus",
  current: OrderSelectionStatus,
  next: OrderSelectionStatus
): void;
function assertWorkflowTransition(
  field: "editingStatus",
  current: OrderEditingStatus,
  next: OrderEditingStatus
): void;
function assertWorkflowTransition(
  field: "productionStatus",
  current: OrderProductionStatus,
  next: OrderProductionStatus
): void;
function assertWorkflowTransition(
  field: "deliveryStatus",
  current: OrderDeliveryStatus,
  next: OrderDeliveryStatus
): void;
function assertWorkflowTransition(
  field: "selectionStatus" | "editingStatus" | "productionStatus" | "deliveryStatus",
  current:
    | OrderSelectionStatus
    | OrderEditingStatus
    | OrderProductionStatus
    | OrderDeliveryStatus,
  next:
    | OrderSelectionStatus
    | OrderEditingStatus
    | OrderProductionStatus
    | OrderDeliveryStatus
): void {
  const isValid = (() => {
    switch (field) {
      case "selectionStatus": {
        const allowed: readonly OrderSelectionStatus[] = ORDER_WORKFLOW_TRANSITIONS.selectionStatus[
          current as OrderSelectionStatus
        ];
        return allowed.includes(next as OrderSelectionStatus);
      }
      case "editingStatus": {
        const allowed: readonly OrderEditingStatus[] = ORDER_WORKFLOW_TRANSITIONS.editingStatus[
          current as OrderEditingStatus
        ];
        return allowed.includes(next as OrderEditingStatus);
      }
      case "productionStatus": {
        const allowed: readonly OrderProductionStatus[] = ORDER_WORKFLOW_TRANSITIONS.productionStatus[
          current as OrderProductionStatus
        ];
        return allowed.includes(next as OrderProductionStatus);
      }
      case "deliveryStatus": {
        const allowed: readonly OrderDeliveryStatus[] = ORDER_WORKFLOW_TRANSITIONS.deliveryStatus[
          current as OrderDeliveryStatus
        ];
        return allowed.includes(next as OrderDeliveryStatus);
      }
    }
  })();

  if (!isValid) {
    throw new Error(`Invalid ${field} transition from ${current} to ${next}`);
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

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
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

type EditableOrderRow = NonNullable<Awaited<ReturnType<typeof fetchEditableOrderById>>>;

function mapEditableOrderRow(order: EditableOrderRow): EditableOrder {
  const addOns = parseAddOns(order.addOns);
  const invoice = order.invoices[0] ?? null;

  return {
    id: order.id,
    customerName: order.customer.name,
    bookingDate: formatDate(order.booking.sessionDate),
    originalPackage: order.originalPackage ? mapEditPackage(order.originalPackage) : null,
    finalPackage: order.finalPackage ? mapEditPackage(order.finalPackage) : null,
    selectedPhotos:
      order.selectedPhotoCount ??
      order.finalPackage?.photoCount ??
      order.originalPackage?.photoCount ??
      0,
    addOns,
    orderStatus: mapOrderStatus(order.status),
    notes: order.notes ?? "",
    invoiceSummary: invoice
      ? {
          id: invoice.id,
          publicId: invoice.publicId,
          invoiceNumber: invoice.invoiceNumber,
          totalAmount: invoice.totalAmount.toNumber(),
          paidAmount: invoice.paidAmount.toNumber(),
          remainingAmount: invoice.remainingAmount.toNumber(),
          status: mapInvoiceStatus(invoice.status),
          isLocked: invoice.isLocked,
          recognizedPackageBaseline: invoice.totalAmount.minus(sumAddOnsDecimal(addOns)).toNumber(),
        }
      : null,
  };
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

function sumAddOnsDecimal(addOns: OrderAddOn[]): Prisma.Decimal {
  return addOns.reduce(
    (sum, addOn) => sum.plus(new Prisma.Decimal(addOn.price)),
    zeroMoney()
  );
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

function areAddOnsEqual(first: OrderAddOn[], second: OrderAddOn[]): boolean {
  if (first.length !== second.length) return false;
  return first.every((addOn, index) => {
    const other = second[index];
    return (
      other !== undefined &&
      addOn.name === other.name &&
      new Prisma.Decimal(addOn.price).equals(new Prisma.Decimal(other.price))
    );
  });
}

function serializeAddOnsForMetadata(addOns: OrderAddOn[]): Prisma.InputJsonArray {
  return addOns.map((addOn) => ({
    name: addOn.name,
    price: addOn.price,
  }));
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

async function recordWorkflowActivities(
  client: OrderWriteClient,
  orderId: string,
  previous: {
    selectionStatus: OrderSelectionStatus;
    editingStatus: OrderEditingStatus;
    productionStatus: OrderProductionStatus;
    deliveryStatus: OrderDeliveryStatus;
  },
  next: UpdateOrderWorkflowInput
): Promise<void> {
  if (next.selectionStatus && next.selectionStatus !== previous.selectionStatus) {
    await recordOrderActivity(client, {
      orderId,
      type:
        next.selectionStatus === OrderSelectionStatus.COMPLETED
          ? OrderActivityType.SELECTION_COMPLETED
          : OrderActivityType.SELECTION_UPDATED,
      title:
        next.selectionStatus === OrderSelectionStatus.COMPLETED
          ? "Selection completed"
          : "Selection status changed",
      metadata: {
        field: "selectionStatus",
        previousStatus: previous.selectionStatus,
        nextStatus: next.selectionStatus,
      },
    });
  }

  if (next.editingStatus && next.editingStatus !== previous.editingStatus) {
    await recordOrderActivity(client, {
      orderId,
      type:
        next.editingStatus === OrderEditingStatus.ASSIGNED
          ? OrderActivityType.EDITOR_ASSIGNED
          : OrderActivityType.EDITING_STATUS_CHANGED,
      title:
        next.editingStatus === OrderEditingStatus.ASSIGNED
          ? "Editor assigned"
          : "Editing status changed",
      metadata: {
        field: "editingStatus",
        previousStatus: previous.editingStatus,
        nextStatus: next.editingStatus,
      },
    });
  }

  if (next.productionStatus && next.productionStatus !== previous.productionStatus) {
    await recordOrderActivity(client, {
      orderId,
      type: OrderActivityType.PRODUCTION_STATUS_CHANGED,
      title: "Production status changed",
      metadata: {
        field: "productionStatus",
        previousStatus: previous.productionStatus,
        nextStatus: next.productionStatus,
      },
    });
  }

  if (next.deliveryStatus && next.deliveryStatus !== previous.deliveryStatus) {
    await recordOrderActivity(client, {
      orderId,
      type: OrderActivityType.DELIVERY_STATUS_CHANGED,
      title: "Delivery status changed",
      metadata: {
        field: "deliveryStatus",
        previousStatus: previous.deliveryStatus,
        nextStatus: next.deliveryStatus,
      },
    });

    if (next.deliveryStatus === OrderDeliveryStatus.COMPLETED) {
      await recordOrderActivity(client, {
        orderId,
        type: OrderActivityType.ORDER_COMPLETED,
        title: "Order completed",
        metadata: {
          field: "deliveryStatus",
          previousStatus: previous.deliveryStatus,
          nextStatus: next.deliveryStatus,
        },
      });
    }
  }
}
