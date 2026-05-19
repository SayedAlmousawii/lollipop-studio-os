import {
  AuditAction,
  AuditEntityType,
  AdjustmentWorkspaceStatus,
  InvoiceType,
  InvoiceStatus,
  OrderActivityType,
  OrderDeliveryStatus,
  OrderEditingStatus,
  OrderProductionSectionStatus,
  OrderProductionStatus,
  OrderSelectionStatus,
  OrderStatus,
  Prisma,
  ProductCategory,
  MediaType,
  UserRole,
} from "@prisma/client";
import { addDays } from "date-fns";
import { cache } from "react";
import { assertActorPermission } from "@/lib/auth/assert-actor-permission";
import type { ActorContext } from "@/lib/auth/actor-context";
import { PERMISSIONS } from "@/lib/permissions";
import { WorkflowGuardError } from "./order.errors";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import { recordAuditLog } from "@/modules/audit/audit-log.service";
import { syncUpgradeCommissionForOrder } from "@/modules/commissions/commission.service";
import { formatCustomerPhone } from "@/modules/customers/customer.utils";
import { PUBLIC_ID_KIND } from "@/modules/identifiers/identifier.constants";
import { generatePublicId } from "@/modules/identifiers/identifier.service";
import { PendingCreditNoteApprovalError } from "@/modules/financial/edit-classifier";
import { getOrdersTableFinancialProjections } from "@/modules/financial-cases/orders-table-projections.service";
import type { OrdersTableRowProjection } from "@/modules/financial-cases/projections/to-orders-table-row";
import {
  invoiceLockSnapshotSelect,
  recordInvoiceLockSnapshot,
} from "@/modules/invoices/invoice-lock.service";
import {
  snapshotInvoiceLineItemsWithClient,
  syncOrderInvoiceForFinancialEdit,
} from "@/modules/invoices/invoice.service";
import { recordPaymentWithClient } from "@/modules/payments/payment.service";
import type { RecordPaymentInput } from "@/modules/payments/payment.schema";
import { priceSelections } from "@/modules/session-configurations/session-configuration-pricing";
import {
  pricedSessionConfigurationSelectionSelect,
  resolveOrderSessionConfigurations,
  type ResolvedOrderPackageConfigs,
  type ResolvedSelection,
} from "@/modules/session-configurations/session-configuration-resolver";
import {
  computeOrderSettlementSummary,
  deriveSettlementPaidAmount,
} from "./order-settlement";
import {
  ORDER_DELIVERY_STATUS_LABELS,
  ORDER_EDITING_STATUS_LABELS,
  ORDER_PRODUCTION_SECTION_STATUS_LABELS,
  ORDER_PRODUCTION_STATUS_LABELS,
  ORDER_SELECTION_STATUS_LABELS,
  ORDER_WORKFLOW_TRANSITIONS,
} from "./order.constants";
import {
  getOrderActivityTimeline,
  recordGuardBlockedActivity,
  recordOrderActivity,
} from "./order-activity.service";
import {
  updateOrderEditingWorkflowSchema,
  updateOrderDeliveryWorkflowSchema,
  updateOrderProductionWorkflowSchema,
  updateOrderPackageSchema,
  upgradeOrderPackageItemSchema,
  addOrderProductAddOnSchema,
  removeOrderAddOnSchema,
  updateOrderSelectedPhotoCountSchema,
  updateOrderWorkflowSchema,
  type AddOrderProductAddOnInput,
  type UpdateOrderEditingWorkflowInput,
  type UpdateOrderDeliveryWorkflowInput,
  type UpdateOrderPackageInput,
  type UpdateOrderProductionWorkflowInput,
  type RemoveOrderAddOnInput,
  type UpdateOrderSelectedPhotoCountInput,
  type UpgradeOrderPackageItemInput,
  type UpdateOrderWorkflowInput,
} from "./order.schema";
import { getOrderTotalSelectedPhotoCount } from "./order.utils";
import type {
  EditingQueueItem,
  InvoiceStatusFilter,
  InvoiceStatusLabel,
  LinkedFinancialDocument,
  Order,
  OrderAddOn,
  OrderAddOnDisplay,
  OrderActivityPreviewItem,
  CustomerOrderHistoryItem,
  OrderDetail,
  OrderDeliveryWorkflow,
  OrderEditingWorkflow,
  OrderEditorOption,
  OrderFilters,
  OrderPaymentStatusLabel,
  POSAddOn,
  POSAddOnCatalogItem,
  POSInvoiceSummary,
  POSPackage,
  POSPackageItem,
  POSPackageLine,
  POSPackageOption,
  POSProductOption,
  POSWorkspace,
  PackageItemDisplay,
  OrderProductionAction,
  OrderProductionSection,
  ProductionQueueItem,
  OrderProductionWorkflow,
  OrderSelectionWorkflow,
  OrderStatusFilter,
  OrderStatusLabel,
  OrderWorkflowStep,
} from "./order.types";
export type { OrderSettlementSummary } from "./order.types";
export {
  computeOrderSettlementSummary,
  deriveLockedFinancialSidebarSummary,
  derivePaymentSummary,
  deriveSettlementPaidAmount,
} from "./order-settlement";

type DbClient = typeof db | Prisma.TransactionClient;

const ORDER_STATUS_FILTERS = new Set<OrderStatusFilter>([
  "ACTIVE",
  "WAITING_SELECTION",
  "SELECTION_COMPLETED",
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
const MAX_CUSTOMER_ORDER_HISTORY_LIMIT = 100;
const FINAL_PARENT_INVOICE_WHERE = {
  parentInvoiceId: null,
  invoiceType: InvoiceType.FINAL,
} satisfies Prisma.InvoiceWhereInput;
const SALES_LINKED_FINANCIAL_DOCUMENT_TYPES = [
  InvoiceType.DEPOSIT,
  InvoiceType.FINAL,
  InvoiceType.ADJUSTMENT,
  InvoiceType.REFUND,
  InvoiceType.CREDIT_NOTE,
] as const;
const LOCKED_INVOICE_WORKSPACE_REQUIRED =
  "Locked invoices can only be changed through an Adjustment Workspace.";

export class OrderAddOnOwnedBySessionConfigurationError extends Error {
  constructor(configurationLabel: string) {
    super(
      `Remove ${configurationLabel} from Configure Session before deleting this add-on.`
    );
    this.name = "OrderAddOnOwnedBySessionConfigurationError";
  }
}

function assertFinancialActorContext(actorContext: ActorContext): void {
  if (!actorContext.actorUserId || !actorContext.actorRole) {
    throw new Error("Missing actor context");
  }
}

function assertDirectPOSMutationAllowed(
  invoice: { isLocked: boolean } | null | undefined
): void {
  if (invoice?.isLocked) {
    throw new Error(LOCKED_INVOICE_WORKSPACE_REQUIRED);
  }
}

type OrderRow = Awaited<ReturnType<typeof fetchOrders>>[number];
type OrderDetailRow = NonNullable<Awaited<ReturnType<typeof fetchOrderById>>>;
type OrderWriteClient = Prisma.TransactionClient;
type FinancialAddOnRow = {
  id?: string;
  productId: string | null;
  nameSnapshot: string;
  priceSnapshot: Prisma.Decimal;
  quantity: number;
};

const packageItemDisplaySelect = {
  id: true,
  productId: true,
  quantity: true,
  priceSnapshot: true,
  product: {
    select: {
      name: true,
      category: true,
    },
  },
} satisfies Prisma.PackageItemSelect;

const packageItemUpgradeSelect = {
  id: true,
  packageItemId: true,
  orderPackageId: true,
  nameSnapshot: true,
  priceSnapshot: true,
  quantity: true,
  notes: true,
} satisfies Prisma.OrderPackageItemUpgradeSelect;

export function parseOrderFilters(filters: {
  search?: string | string[];
  orderStatus?: string | string[];
  invoiceStatus?: string | string[];
  sessionDateFrom?: string | string[];
  sessionDateTo?: string | string[];
  editorId?: string | string[];
  hasOpenWorkspace?: string | string[];
}): OrderFilters {
  const search = singleValue(filters.search)?.trim();
  const orderStatus = singleValue(filters.orderStatus);
  const invoiceStatus = singleValue(filters.invoiceStatus);
  const sessionDateFrom = parseDateInput(singleValue(filters.sessionDateFrom));
  const sessionDateTo = parseDateInput(singleValue(filters.sessionDateTo));
  const editorId = singleValue(filters.editorId)?.trim();
  const hasOpenWorkspace = singleValue(filters.hasOpenWorkspace);

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
    sessionDateFrom,
    sessionDateTo,
    editorId: editorId ? editorId : undefined,
    hasOpenWorkspace: hasOpenWorkspace === "true" ? true : undefined,
  };
}

export async function getOrders(filters: OrderFilters = {}): Promise<Order[]> {
  const rows = await withRetry(
    () => fetchOrders(filters),
    "Failed to fetch orders"
  );
  let financialByOrderId = new Map<string, OrdersTableRowProjection | null>();
  try {
    financialByOrderId = await withRetry(
      () =>
        getOrdersTableFinancialProjections({
          orderIds: rows.map((row) => row.id),
        }),
      "Failed to fetch order table financial projections"
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        metric: "orders.table_financial_projection.failed",
        orderCount: rows.length,
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }

  return rows.map((row) => mapOrderRow(row, financialByOrderId.get(row.id) ?? null));
}

export async function getOrdersByCustomerId(
  customerId: string,
  limit = 10
): Promise<CustomerOrderHistoryItem[]> {
  const sanitizedLimit = sanitizeCustomerOrderHistoryLimit(limit);
  const rows = await withRetry(
    () => fetchOrdersByCustomerId(customerId, sanitizedLimit),
    "Failed to fetch customer orders"
  );

  return rows.map(mapCustomerOrderHistoryRow);
}

export async function getOrderFilterEditorOptions(): Promise<OrderEditorOption[]> {
  const rows = await withRetry(
    () =>
      db.user.findMany({
        where: {
          active: true,
          role: { in: [UserRole.ADMIN, UserRole.EDITOR] },
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    "Failed to fetch order filter editors"
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
  }));
}

export async function getEditingQueue(): Promise<EditingQueueItem[]> {
  const rows = await withRetry(
    () => fetchEditingQueue(),
    "Failed to fetch editing queue"
  );
  return rows.map(mapEditingQueueRow);
}

export async function getProductionQueue(): Promise<ProductionQueueItem[]> {
  const rows = await withRetry(
    () => fetchProductionQueue(),
    "Failed to fetch production queue"
  );
  return rows.map(mapProductionQueueRow);
}

export async function getOrderById(orderId: string): Promise<OrderDetail | null> {
  const row = await withRetry(
    () => fetchOrderById(orderId),
    "Failed to fetch order"
  );

  if (!row) return null;
  return mapOrderDetailRow(row);
}

export const getPOSWorkspace = cache(async function getPOSWorkspaceInternal(
  orderId: string,
  client: DbClient = db
): Promise<POSWorkspace | null> {
  const [order, packageRows, productRows, addOnCatalogRows, extraPhotoPricingRows] =
    await withRetry(
      () =>
        Promise.all([
          client.order.findUnique({
            where: { id: orderId },
            include: {
              customer: { select: { name: true, phone: true } },
              booking: {
                select: {
                  sessionDate: true,
                  financialCase: {
                    select: {
                      id: true,
                      invoices: {
                        where: {
                          invoiceType: {
                            in: [InvoiceType.DEPOSIT, InvoiceType.ADJUSTMENT],
                          },
                        },
                        select: {
                          id: true,
                          financialCaseId: true,
                          invoiceNumber: true,
                          invoiceType: true,
                          status: true,
                          isLocked: true,
                          totalAmount: true,
                          paidAmount: true,
                          remainingAmount: true,
                          createdAt: true,
                          lineItems: {
                            select: {
                              id: true,
                              lineType: true,
                              description: true,
                              quantity: true,
                              unitPrice: true,
                              lineTotal: true,
                            },
                            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
                          },
                        },
                        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                      },
                    },
                  },
                },
              },
              packages: {
                include: {
                  sessionType: { select: { id: true, name: true } },
                  package: {
                    select: {
                      id: true,
                      name: true,
                      price: true,
                      photoCount: true,
                      bundleAdjustment: true,
                      items: {
                        select: packageItemDisplaySelect,
                        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
                      },
                    },
                  },
                  sessionConfigurationSelections: {
                    select: pricedSessionConfigurationSelectionSelect,
                  },
                },
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              },
              invoices: {
                where: FINAL_PARENT_INVOICE_WHERE,
                select: {
                  id: true,
                  financialCaseId: true,
                  invoiceNumber: true,
                  invoiceType: true,
                  status: true,
                  isLocked: true,
                  totalAmount: true,
                  paidAmount: true,
                  remainingAmount: true,
                  lineItems: {
                    select: {
                      id: true,
                      lineType: true,
                      description: true,
                      quantity: true,
                      unitPrice: true,
                      lineTotal: true,
                    },
                    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
                  },
                },
                orderBy: { createdAt: "asc" },
                take: 1,
              },
              orderAddOns: {
                select: {
                  id: true,
                  productId: true,
                  nameSnapshot: true,
                  priceSnapshot: true,
                  quantity: true,
                },
                orderBy: { createdAt: "asc" },
              },
              packageItemUpgrades: {
                select: packageItemUpgradeSelect,
                orderBy: { createdAt: "asc" },
              },
            },
          }),
          client.package.findMany({
            where: { isActive: true },
            select: {
              id: true,
              name: true,
              price: true,
              photoCount: true,
              bundleAdjustment: true,
              packageFamily: { select: { sessionTypeId: true } },
            },
            orderBy: { price: "asc" },
          }),
          client.product.findMany({
            where: { isActive: true, isPackageDeliverable: true },
            select: { id: true, name: true, category: true, canonicalPrice: true },
            orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
          }),
          client.product.findMany({
            where: { isActive: true, isAddOn: true },
            select: { id: true, name: true, category: true, canonicalPrice: true },
            orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
          }),
          client.sessionTypeExtraPhotoPricing.findMany({
            select: { sessionTypeId: true, mediaType: true, unitPrice: true },
          }),
        ]),
      "Failed to fetch POS workspace"
    );

  if (!order) return null;

  const resolvedSessionConfigurations = await withRetry(
    () => resolveOrderSessionConfigurations(client, order.id),
    "Failed to fetch POS session configurations"
  );
  const resolvedConfigurationsByPackageId = new Map(
    resolvedSessionConfigurations.map((configurationState) => [
      configurationState.orderPackageId,
      configurationState,
    ])
  );
  const financialCaseInvoices = order.booking.financialCase?.invoices ?? [];
  const depositInvoice =
    financialCaseInvoices.filter((invoice) => invoice.invoiceType === InvoiceType.DEPOSIT).at(-1) ??
    null;
  const adjustmentInvoices = financialCaseInvoices
    .filter((invoice) => invoice.invoiceType === InvoiceType.ADJUSTMENT)
    .map((invoice) =>
      mapPOSInvoiceSummary({
        invoice,
        packageBaseTotal: zeroMoney(),
        bundleAdjustment: zeroMoney(),
        addOnTotal: zeroMoney(),
        extraPhotoTotal: zeroMoney(),
        paidAmount: invoice.paidAmount,
        depositInvoice: null,
      })
    );
  const openAdjustmentInvoices = adjustmentInvoices.filter(
    (invoice) => invoice.invoiceStatus !== "Draft" && invoice.remainingAmount > 0
  );
  const paidAdjustmentInvoices = adjustmentInvoices.filter(
    (invoice) => invoice.invoiceStatus !== "Draft" && invoice.remainingAmount <= 0
  );
  const packageLines = mapPOSPackageLines({
    lines: order.packages,
    packageOptions: packageRows,
    pricingRows: extraPhotoPricingRows,
    resolvedConfigurationsByPackageId,
  });
  const packageItems = packageLines.flatMap((line) => line.packageItems);
  const includedPhotoCount =
    packageLines.reduce((sum, line) => sum + line.includedPhotoCount, 0);
  const selectedPhotoCount = getOrderTotalSelectedPhotoCount(order.packages);
  const extraPhotoCount =
    packageLines.reduce((sum, line) => sum + line.extraPhotoCount, 0);
  const extraPhotoTotalDecimal = new Prisma.Decimal(
    packageLines.reduce((sum, line) => sum + line.extraPhotoTotal, 0)
  );
  const combinedAddOnRows = combineFinancialAddOnRows(
    order.orderAddOns,
    order.packageItemUpgrades
  );
  const addOns = mapPOSAddOns(combinedAddOnRows);
  const addOnTotal = sumOrderAddOnRowsDecimal(combinedAddOnRows);
  const packageBaseTotal = new Prisma.Decimal(
    packageLines.reduce((sum, line) => sum + line.currentPackage.price, 0)
  );
  const paidAmount = order.invoices[0]?.paidAmount ?? zeroMoney();
  const bundleAdjustmentTotal = new Prisma.Decimal(
    packageLines.reduce(
      (sum, line) => sum + line.currentPackage.bundleAdjustment,
      0
    )
  );
  const sessionConfigurationTotal = priceSelections(
    resolvedSessionConfigurations.flatMap(
      (configurationState) => configurationState.selections
    )
  ).totalDelta;

  const finalInvoice = order.invoices[0]
    ? mapPOSInvoiceSummary({
        invoice: order.invoices[0],
        packageBaseTotal,
        bundleAdjustment: bundleAdjustmentTotal,
        addOnTotal,
        extraPhotoTotal: extraPhotoTotalDecimal,
        paidAmount,
        depositInvoice,
      })
    : null;
  const aggregateOutstanding =
    (finalInvoice?.remainingAmount ?? 0) +
    openAdjustmentInvoices.reduce(
      (sum, invoice) => sum + invoice.remainingAmount,
      0
    );

  if (openAdjustmentInvoices.length > 0) {
    recordPOSCounter("pos.adjustment.viewed", {
      orderId: order.id,
      financialCaseId: order.booking.financialCase?.id ?? null,
      count: openAdjustmentInvoices.length,
    });
  }

  return {
    orderId: order.id,
    jobNumber: order.jobNumber,
    orderStatusRaw: order.status,
    orderStatus: mapOrderStatus(order.status),
    selectionStatus: order.selectionStatus,
    sessionDate: formatDateTime(order.booking.sessionDate),
    customerName: order.customer.name,
    customerPhone: formatCustomerPhone(order.customer.phone),
    packageLines,
    packageItems,
    rawDeliverableTotal: sumPOSPackageItemsDecimal(packageItems).toNumber(),
    includedPhotoCount,
    selectedPhotoCount,
    extraPhotoCount,
    extraPhotoTotal: extraPhotoTotalDecimal.toNumber(),
    addOns,
    addOnTotal: addOnTotal.toNumber(),
    sessionConfigurationTotal: sessionConfigurationTotal.toNumber(),
    productOptions: productRows.map(mapPOSProductOption),
    addOnCatalog: addOnCatalogRows.map(mapPOSAddOnCatalogItem),
    invoice: finalInvoice,
    adjustmentInvoices: openAdjustmentInvoices,
    paidAdjustmentInvoices,
    aggregateOutstanding,
  };
});

export async function getLinkedFinancialDocumentsForOrder(
  orderId: string,
  client: DbClient = db
): Promise<LinkedFinancialDocument[]> {
  const invoices = await withRetry(
    async () => {
      const order = await client.order.findUnique({
        where: { id: orderId },
        select: {
          bookingId: true,
          booking: {
            select: {
              financialCase: { select: { id: true } },
            },
          },
        },
      });
      if (!order) return [];

      const financialCaseId = order.booking.financialCase?.id ?? null;

      return client.invoice.findMany({
        where: {
          invoiceType: { in: [...SALES_LINKED_FINANCIAL_DOCUMENT_TYPES] },
          OR: [
            { orderId },
            { bookingId: order.bookingId },
            ...(financialCaseId ? [{ financialCaseId }] : []),
          ],
        },
        select: {
          id: true,
          invoiceNumber: true,
          invoiceType: true,
          status: true,
          totalAmount: true,
          paidAmount: true,
          remainingAmount: true,
          issuedAt: true,
          createdAt: true,
        },
        orderBy: [{ issuedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      });
    },
    "Failed to fetch linked financial documents"
  );

  return invoices.map((invoice) => ({
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    invoiceType: invoice.invoiceType as LinkedFinancialDocument["invoiceType"],
    invoiceStatus: invoice.status,
    invoiceTotal: invoice.totalAmount.toNumber(),
    paidAmount: deriveSettlementPaidAmount(invoice).toNumber(),
    remainingAmount: invoice.remainingAmount.toNumber(),
    issuedAt: invoice.issuedAt,
    createdAt: invoice.createdAt,
  }));
}

export async function recordPOSPaymentForOrder(
  orderId: string,
  invoiceId: string,
  input: {
    payment: RecordPaymentInput;
    selectionStatus?: OrderSelectionStatus;
  },
  actorContext: ActorContext
): Promise<{ id: string }> {
  assertFinancialActorContext(actorContext);
  assertActorPermission(actorContext, PERMISSIONS.PAYMENT_CREATE);

  return withRetry(
    () =>
      db.$transaction(async (tx) => {
        const invoice = await tx.invoice.findUnique({
          where: { id: invoiceId },
          select: { orderId: true },
        });
        if (!invoice) throw new Error("Invoice not found");
        if (invoice.orderId !== orderId) {
          throw new Error("Invoice does not belong to this order");
        }

        const payment = await recordPaymentWithClient(
          tx,
          invoiceId,
          input.payment,
          actorContext
        );

        if (input.selectionStatus) {
          const order = await tx.order.findUnique({
            where: { id: orderId },
            select: { status: true, selectionStatus: true },
          });
          if (!order) throw new Error("Order not found");

          const nextSelectionStatus = resolveAdvancedSelectionStatus(
            order.selectionStatus,
            input.selectionStatus
          );
          if (nextSelectionStatus) {
            const shouldAdvanceOrderStatus =
              input.selectionStatus === OrderSelectionStatus.COMPLETED &&
              order.status === OrderStatus.WAITING_SELECTION;
            const selectionStatusChanged =
              nextSelectionStatus !== order.selectionStatus;

            if (!selectionStatusChanged && !shouldAdvanceOrderStatus) {
              return payment;
            }

            const updatedOrder = await tx.order.updateMany({
              where: {
                id: orderId,
                selectionStatus: order.selectionStatus,
                ...(shouldAdvanceOrderStatus ? { status: order.status } : {}),
              },
              data: {
                selectionStatus: nextSelectionStatus,
                ...(shouldAdvanceOrderStatus
                  ? { status: OrderStatus.SELECTION_COMPLETED }
                  : {}),
              },
            });
            if (updatedOrder.count === 0) {
              throw new Error("Order selection status changed during payment recording");
            }

            if (selectionStatusChanged) {
              await recordOrderActivity(tx, {
                orderId,
                userId: actorContext.actorUserId ?? null,
                type:
                  nextSelectionStatus === OrderSelectionStatus.COMPLETED
                    ? OrderActivityType.SELECTION_COMPLETED
                    : OrderActivityType.SELECTION_UPDATED,
                title:
                  nextSelectionStatus === OrderSelectionStatus.COMPLETED
                    ? "Selection completed"
                    : "Selection status changed",
                metadata: {
                  field: "selectionStatus",
                  previousStatus: order.selectionStatus,
                  nextStatus: nextSelectionStatus,
                },
              });
            }
          }
        }

        return payment;
      }),
    "Failed to record POS payment"
  );
}

function mapOrderDetailRow(row: OrderDetailRow): OrderDetail {
  const summary = mapOrderRow(row);
  const settlementSummary = computeOrderSettlementSummary({
    invoices: row.booking.financialCase?.invoices ?? row.invoices,
  });
  const packageLines = row.packages.map((line) => {
    const selectedPhotoCount = line.selectedPhotoCount ?? line.package.photoCount;
    const extraPhotoCount = line.extraDigitalCount + line.extraPrintCount;
    const originalSnapshot = line.originalPackagePriceSnapshot;
    const finalSnapshot = line.finalPackagePriceSnapshot;
    const upgradeStatus =
      originalSnapshot && finalSnapshot && !originalSnapshot.equals(finalSnapshot)
        ? `Upgraded ${formatSignedMoney(finalSnapshot.minus(originalSnapshot))}`
        : "No upgrade";
    return {
      id: line.id,
      packageName: line.package.name,
      sessionTypeName: line.sessionType.name,
      includedPhotoCount: line.package.photoCount,
      selectedPhotoCount,
      extraDigitalCount: line.extraDigitalCount,
      extraPrintCount: line.extraPrintCount,
      extraPhotoCount,
      upgradeStatus,
      bundleAdjustment: formatSignedMoney(new Prisma.Decimal(line.package.bundleAdjustment)),
      packageItems: mapPackageItemDisplays(line.package.items),
    };
  });
  const includedPhotoCount =
    packageLines.reduce((sum, line) => sum + line.includedPhotoCount, 0) || null;
  const selectedPhotoCount = getOrderTotalSelectedPhotoCount(row.packages) || null;
  const editingStatus = row.editingJob?.status ?? OrderEditingStatus.NOT_STARTED;
  const productionStatus = row.productionJob?.status ?? resolveDefaultProductionStatus(editingStatus);
  const workflowStatus = mapWorkflowStatus({
    selectionStatus: row.selectionStatus,
    editingStatus,
    productionStatus,
    deliveryStatus: row.deliveryStatus,
  });

  return {
    ...summary,
    customerId: row.customerId,
    bookingId: row.bookingId,
    packageLinePackageId: row.packages[0]?.packageId ?? null,
    packageId: row.packages[0]?.packageId ?? null,
    sessionDateTime: formatDateTime(row.booking.sessionDate),
    sessionType: row.packages[0]?.sessionType.name ?? "—",
    selectedPhotoCount: formatCount(selectedPhotoCount),
    includedPhotoCount: formatCount(includedPhotoCount),
    extraPhotoCount:
      selectedPhotoCount !== null && includedPhotoCount !== null
        ? String(Math.max(selectedPhotoCount - includedPhotoCount, 0))
        : "—",
    addonsSummary: formatAddOnsSummary(
      mapStructuredAddOns(
        combineFinancialAddOnRows(row.orderAddOns, row.packageItemUpgrades)
      )
    ),
    packageItems:
      packageLines.flatMap((line) => line.packageItems),
    packageLines,
    bundleAdjustment: formatSignedMoney(
      row.packages.reduce(
        (sum, line) => sum.plus(line.package.bundleAdjustment),
        zeroMoney()
      )
    ),
    paidAddOns: mapOrderAddOnDisplays(
      combineFinancialAddOnRows(row.orderAddOns, row.packageItemUpgrades)
    ),
    ...workflowStatus,
    nextAction: resolveNextOrderAction({
      invoiceStatus: summary.invoiceStatus,
      paymentStatus: summary.paymentStatus,
      orderStatus: summary.orderStatus,
      selectionStatus: workflowStatus.selectionStatus,
      editingStatus: workflowStatus.editingStatus,
      productionStatus: workflowStatus.productionStatus,
      deliveryStatus: workflowStatus.deliveryStatus,
    }),
    workflowSteps: buildWorkflowSteps(workflowStatus),
    recentActivity: [],
    notes: row.notes?.trim() ? row.notes : "—",
    settlementSummary,
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

export async function getOrderSelectionWorkflowById(
  orderId: string
): Promise<OrderSelectionWorkflow | null> {
  const [order, completedActivity] = await withRetry(
    () =>
      Promise.all([
        db.order.findUnique({
          where: { id: orderId },
          include: {
            packages: {
              include: {
                sessionType: { select: { id: true, name: true } },
                package: {
                  select: {
                    id: true,
                    name: true,
                    price: true,
                    photoCount: true,
                    bundleAdjustment: true,
                    items: {
                      select: packageItemDisplaySelect,
                      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
                    },
                  },
                },
              },
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            },
            invoices: {
              where: FINAL_PARENT_INVOICE_WHERE,
              select: {
                totalAmount: true,
                paidAmount: true,
                remainingAmount: true,
                isLocked: true,
              },
              orderBy: { createdAt: "asc" },
              take: 1,
            },
            orderAddOns: {
              select: {
                productId: true,
                nameSnapshot: true,
                priceSnapshot: true,
                quantity: true,
              },
              orderBy: { createdAt: "asc" },
            },
            packageItemUpgrades: {
              select: packageItemUpgradeSelect,
              orderBy: { createdAt: "asc" },
            },
          },
        }),
        db.orderActivity.findFirst({
          where: {
            orderId,
            type: OrderActivityType.SELECTION_COMPLETED,
          },
          select: { createdAt: true },
          orderBy: { createdAt: "desc" },
        }),
      ]),
    "Failed to fetch selection workflow"
  );

  if (!order) return null;

  const addOns = mapStructuredAddOns(
    combineFinancialAddOnRows(order.orderAddOns, order.packageItemUpgrades)
  );
  if (order.packages.length === 0) {
    throw new Error("Order has no package available for selection workflow");
  }
  const packageLines = order.packages.map((line) => {
    const selectedPhotoCount = line.selectedPhotoCount ?? line.package.photoCount;
    const extraPhotoCount = line.extraDigitalCount + line.extraPrintCount;
    const originalSnapshot = line.originalPackagePriceSnapshot;
    const finalSnapshot = line.finalPackagePriceSnapshot;
    const upgradeStatus =
      originalSnapshot && finalSnapshot && !originalSnapshot.equals(finalSnapshot)
        ? `Upgraded ${formatSignedMoney(finalSnapshot.minus(originalSnapshot))}`
        : "No upgrade";

    return {
      id: line.id,
      packageName: line.package.name,
      sessionTypeName: line.sessionType.name,
      includedPhotoCount: line.package.photoCount,
      selectedPhotoCount,
      extraDigitalCount: line.extraDigitalCount,
      extraPrintCount: line.extraPrintCount,
      extraPhotoCount,
      upgradeStatus,
      bundleAdjustment: formatSignedMoney(new Prisma.Decimal(line.package.bundleAdjustment)),
      packageItems: mapPackageItemDisplays(line.package.items),
    };
  });
  const includedPhotoCount =
    order.packages.reduce(
      (sum, line) => sum + line.package.photoCount,
      0
    );
  const selectedPhotos = getOrderTotalSelectedPhotoCount(order.packages);
  const extraPhotoCount =
    packageLines.reduce((sum, line) => sum + line.extraPhotoCount, 0);

  const manualAddOnTotal = sumAddOnsDecimal(addOns);
  const invoice = order.invoices[0] ?? null;
  const extraPhotoCharge = Prisma.Decimal.max(invoice?.totalAmount
    .minus(sumOrderPackageFinalPriceDecimal(order.packages))
    .minus(manualAddOnTotal) ?? zeroMoney(), 0);
  const selectionAddOnTotal = manualAddOnTotal.plus(extraPhotoCharge);

  return {
    orderId: order.id,
    orderStatus: mapOrderStatus(order.status),
    packageLines,
    selectedPhotos,
    includedPhotoCount,
    extraPhotoCount,
    addOns,
    notes: order.notes ?? "",
    selectionStatus: ORDER_SELECTION_STATUS_LABELS[order.selectionStatus],
    completedAt: completedActivity ? formatDateTime(completedActivity.createdAt) : null,
    manualAddOnTotal: formatMoney(manualAddOnTotal),
    extraPhotoCharge: formatMoney(extraPhotoCharge),
    selectionAddOnTotal: formatMoney(selectionAddOnTotal),
    nextRecommendedFinancialAction: "Review package lines, extras, add-ons, invoice preview, and final payment in POS.",
    invoiceLocked: invoice?.isLocked ?? false,
  };
}

export async function getOrderEditingWorkflowById(
  orderId: string
): Promise<OrderEditingWorkflow | null> {
  const [order, editorRows] = await withRetry(
    () =>
      Promise.all([
        db.order.findUnique({
          where: { id: orderId },
          include: {
            editingJob: {
              include: {
                assignedEditor: { select: { id: true, name: true } },
              },
            },
            productionJob: {
              select: productionJobSelect,
            },
            booking: {
              select: {
                financialCase: {
                  select: {
                    invoices: {
                      where: {
                        parentInvoiceId: null,
                        invoiceType: InvoiceType.DEPOSIT,
                      },
                      select: { invoiceType: true, remainingAmount: true },
                      take: 1,
                    },
                  },
                },
              },
            },
            packages: {
              select: {
                selectedPhotoCount: true,
                package: { select: { photoCount: true } },
              },
            },
            invoices: {
              where: FINAL_PARENT_INVOICE_WHERE,
              select: {
                id: true,
                remainingAmount: true,
              },
              orderBy: { createdAt: "asc" },
              take: 1,
            },
          },
        }),
        db.user.findMany({
          where: { role: UserRole.EDITOR },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
      ]),
    "Failed to fetch editing workflow"
  );

  if (!order) return null;

  return mapOrderEditingWorkflow(order, editorRows);
}

export async function getOrderProductionWorkflowById(
  orderId: string
): Promise<OrderProductionWorkflow | null> {
  const order = await withRetry(
    () =>
      db.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          jobId: true,
          status: true,
          editingJob: {
            select: {
              status: true,
            },
          },
          deliveryStatus: true,
          productionJob: {
            select: productionJobSelect,
          },
        },
      }),
    "Failed to fetch production workflow"
  );

  if (!order) return null;
  return mapOrderProductionWorkflow(order);
}

export async function getOrderDeliveryWorkflowById(
  orderId: string
): Promise<OrderDeliveryWorkflow | null> {
  const order = await withRetry(
    () =>
      db.order.findUnique({
        where: { id: orderId },
        select: deliveryOrderSelect,
      }),
    "Failed to fetch delivery workflow"
  );

  if (!order) return null;
  return mapOrderDeliveryWorkflow(order);
}

export async function updateOrderPackage(
  orderId: string,
  input: UpdateOrderPackageInput,
  actorContext: ActorContext
): Promise<POSWorkspace> {
  const data = updateOrderPackageSchema.parse(input);
  assertFinancialActorContext(actorContext);
  assertActorPermission(actorContext, PERMISSIONS.ORDER_FINANCIAL_UPDATE);

  await withRetry(
    () =>
      db.$transaction(async (tx) => {
        const [order, selectedPackage] = await Promise.all([
          tx.order.findUnique({
            where: { id: orderId },
            include: {
              packages: {
                where: { id: data.orderPackageId },
                include: {
                  package: { select: { id: true, name: true, price: true, photoCount: true } },
                },
                take: 1,
              },
              invoices: {
                where: FINAL_PARENT_INVOICE_WHERE,
                select: { id: true, isLocked: true },
                orderBy: { createdAt: "asc" },
                take: 1,
              },
              orderAddOns: {
                select: { productId: true, nameSnapshot: true, priceSnapshot: true, quantity: true },
                orderBy: { createdAt: "asc" },
              },
              packageItemUpgrades: {
                select: packageItemUpgradeSelect,
                orderBy: { createdAt: "asc" },
              },
            },
          }),
          tx.package.findUnique({
            where: { id: data.packageId },
            select: {
              id: true,
              name: true,
              price: true,
              photoCount: true,
              isActive: true,
              packageFamily: { select: { sessionTypeId: true } },
            },
          }),
        ]);

        if (!order) throw new Error("Order not found");
        if (order.status === OrderStatus.DELIVERED) {
          throw new Error("Delivered orders cannot be edited");
        }
        assertDirectPOSMutationAllowed(order.invoices[0]);
        if (!selectedPackage || !selectedPackage.isActive) {
          throw new Error("Selected package is not available");
        }

        const orderPackage = order.packages[0] ?? null;
        if (!orderPackage) throw new Error("Package line not found on this order");
        const previousPackage = orderPackage.package;
        if (!previousPackage) throw new Error("Order has no package price");
        if (selectedPackage.packageFamily.sessionTypeId !== orderPackage.sessionTypeId) {
          throw new Error("Selected package does not belong to this line's session type");
        }
        const previousAddOns = mapStructuredAddOns(
          combineFinancialAddOnRows(order.orderAddOns, order.packageItemUpgrades)
        );
        const previousIncludedPhotoCount = previousPackage.photoCount;
        const nextSelectedPhotoCount =
          orderPackage.selectedPhotoCount === null ||
          orderPackage.selectedPhotoCount === 0 ||
          orderPackage.selectedPhotoCount === previousIncludedPhotoCount
            ? selectedPackage.photoCount
            : orderPackage.selectedPhotoCount > previousIncludedPhotoCount
              ? Math.max(orderPackage.selectedPhotoCount, selectedPackage.photoCount)
              : undefined;

        await tx.orderPackageItemUpgrade.deleteMany({
          where: {
            orderId,
            orderPackageId: orderPackage.id,
          },
        });

        await tx.orderPackage.update({
          where: { id: orderPackage.id },
          data: {
            package: { connect: { id: selectedPackage.id } },
            finalPackagePriceSnapshot: selectedPackage.price,
            selectedPhotoCount: nextSelectedPhotoCount,
          },
        });
        await syncOrderSelectedPhotoCountFromPackageLines(tx, orderId);

        const invoiceSummary = await syncOrderInvoiceForFinancialEdit(tx, {
          orderId,
          actorContext,
          previousAddOns,
          previousSelectedPhotoCount: null,
          previousIncludedPhotoCount,
          managerApprovedReductionByUserId:
            data.managerApprovedReductionByUserId,
          managerApprovedReason: data.managerApprovedReason,
        });

        await syncUpgradeCommissionForOrder(tx, {
          orderId,
          upgradeAmount: invoiceSummary.packageAdjustmentAmount,
        });

        if (previousPackage.id !== selectedPackage.id) {
          await recordOrderActivity(tx, {
            orderId,
            userId: actorContext.actorUserId ?? null,
            type: OrderActivityType.ORDER_PACKAGE_LINE_CHANGED,
            title: "Package line changed",
            description: `${previousPackage.name} changed to ${selectedPackage.name}.`,
            metadata: {
              orderPackageId: orderPackage.id,
              previousPackageId: previousPackage.id,
              previousPackageName: previousPackage.name,
              nextPackageId: selectedPackage.id,
              nextPackageName: selectedPackage.name,
              packageAdjustmentAmount: invoiceSummary.packageAdjustmentAmount.toFixed(3),
              packageAdjustmentBaseline: invoiceSummary.packageAdjustmentBaseline.toFixed(3),
            },
          });
        }

        if (!invoiceSummary.totalAdjustmentAmount.equals(0) || invoiceSummary.createdInvoice) {
          await recordOrderActivity(tx, {
            orderId,
            userId: actorContext.actorUserId ?? null,
            type: OrderActivityType.INVOICE_ADJUSTED,
            title: invoiceSummary.createdInvoice ? "Invoice created" : "Invoice adjusted",
            description: `Invoice ${invoiceSummary.invoiceNumber} now totals ${invoiceSummary.totalAmount}.`,
            metadata: {
              invoiceId: invoiceSummary.invoiceId,
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
      }),
    "Failed to update order package",
    undefined,
    shouldRetryOrderFinancialEditError
  );

  const workspace = await getPOSWorkspace(orderId);
  if (!workspace) throw new Error("Order not found after package update");
  return workspace;
}

export async function upgradeOrderPackageItem(
  orderId: string,
  input: UpgradeOrderPackageItemInput,
  actorContext: ActorContext
): Promise<POSWorkspace> {
  const data = upgradeOrderPackageItemSchema.parse(input);
  assertFinancialActorContext(actorContext);
  assertActorPermission(actorContext, PERMISSIONS.ORDER_FINANCIAL_UPDATE);

  await withRetry(
    () =>
      db.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: {
            packages: {
              where: { id: data.orderPackageId },
              include: {
                package: { select: { id: true, price: true, photoCount: true } },
              },
              take: 1,
            },
            invoices: {
              where: FINAL_PARENT_INVOICE_WHERE,
              select: { id: true, isLocked: true },
              orderBy: { createdAt: "asc" },
              take: 1,
            },
            orderAddOns: {
              select: { productId: true, nameSnapshot: true, priceSnapshot: true, quantity: true },
              orderBy: { createdAt: "asc" },
            },
            packageItemUpgrades: {
              select: packageItemUpgradeSelect,
              orderBy: { createdAt: "asc" },
            },
          },
        });
        if (!order) throw new Error("Order not found");
        if (order.status === OrderStatus.DELIVERED) {
          throw new Error("Delivered orders cannot be edited");
        }
        assertDirectPOSMutationAllowed(order.invoices[0]);

        const orderPackage = order.packages[0] ?? null;
        if (!orderPackage) throw new Error("Package line not found on this order");
        const currentPackage = orderPackage.package;

        const [currentItem, newProduct] = await Promise.all([
          tx.packageItem.findUnique({
            where: { id: data.packageItemId },
            include: { product: { select: { id: true, name: true, category: true } } },
          }),
          tx.product.findUnique({
            where: { id: data.newProductId },
            select: {
              id: true,
              name: true,
              category: true,
              canonicalPrice: true,
              isActive: true,
              isPackageDeliverable: true,
            },
          }),
        ]);

        if (!currentItem || currentItem.packageId !== currentPackage.id) {
          throw new Error("Package item is not part of the current order package");
        }
        if (!newProduct || !newProduct.isActive || !newProduct.isPackageDeliverable) {
          throw new Error("Replacement product is not available");
        }
        if (newProduct.category !== currentItem.product.category) {
          throw new Error("Replacement product must be in the same category");
        }
        if (newProduct.id === currentItem.productId) {
          throw new Error("Replacement product is already included");
        }

        const previousAddOns = mapStructuredAddOns(
          combineFinancialAddOnRows(order.orderAddOns, order.packageItemUpgrades)
        );
        const unitDelta = newProduct.canonicalPrice.minus(currentItem.priceSnapshot);
        const adjustmentTotal = unitDelta.mul(currentItem.quantity);
        const existingAddOn = await tx.orderPackageItemUpgrade.findFirst({
          where: {
            orderId,
            orderPackageId: orderPackage.id,
            packageItemId: currentItem.id,
          },
          select: { id: true },
        });
        const addOn = existingAddOn
          ? await tx.orderPackageItemUpgrade.update({
              where: { id: existingAddOn.id },
              data: {
                orderPackageId: orderPackage.id,
                nameSnapshot: `${currentItem.product.name} to ${newProduct.name}`,
                priceSnapshot: unitDelta,
                quantity: currentItem.quantity,
                notes: `Package item upgrade from ${currentItem.product.name}`,
              },
              select: { id: true },
            })
          : await tx.orderPackageItemUpgrade.create({
              data: {
                orderId,
                orderPackageId: orderPackage.id,
                packageItemId: currentItem.id,
                nameSnapshot: `${currentItem.product.name} to ${newProduct.name}`,
                priceSnapshot: unitDelta,
                quantity: currentItem.quantity,
                notes: `Package item upgrade from ${currentItem.product.name}`,
              },
              select: { id: true },
            });

        const invoiceSummary = await syncOrderInvoiceForFinancialEdit(tx, {
          orderId,
          actorContext,
          previousAddOns,
          previousSelectedPhotoCount: getOrderTotalSelectedPhotoCount(order.packages),
          previousIncludedPhotoCount: currentPackage.photoCount,
          managerApprovedReductionByUserId:
            data.managerApprovedReductionByUserId,
          managerApprovedReason: data.managerApprovedReason,
        });

        await recordOrderActivity(tx, {
          orderId,
          userId: actorContext.actorUserId ?? null,
          type: OrderActivityType.ADD_ON_CHANGED,
          title: "Package item upgraded",
          description: `${currentItem.product.name} changed to ${newProduct.name} for ${formatSignedMoney(adjustmentTotal)}.`,
          metadata: {
            orderPackageItemUpgradeId: addOn.id,
            orderPackageId: orderPackage.id,
            packageItemId: currentItem.id,
            previousProductId: currentItem.productId,
            previousProductName: currentItem.product.name,
            nextProductId: newProduct.id,
            nextProductName: newProduct.name,
            quantity: currentItem.quantity,
            unitPriceDelta: unitDelta.toFixed(3),
            priceDelta: adjustmentTotal.toFixed(3),
          },
        });

        if (!invoiceSummary.totalAdjustmentAmount.equals(0) || invoiceSummary.createdInvoice) {
          await recordOrderActivity(tx, {
            orderId,
            userId: actorContext.actorUserId ?? null,
            type: OrderActivityType.INVOICE_ADJUSTED,
            title: invoiceSummary.createdInvoice ? "Invoice created" : "Invoice adjusted",
            description: `Invoice ${invoiceSummary.invoiceNumber} now totals ${invoiceSummary.totalAmount}.`,
            metadata: {
              invoiceId: invoiceSummary.invoiceId,
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
      }),
    "Failed to upgrade package item",
    undefined,
    shouldRetryOrderFinancialEditError
  );

  const workspace = await getPOSWorkspace(orderId);
  if (!workspace) throw new Error("Order not found after package item upgrade");
  return workspace;
}

export async function addOrderProductAddOn(
  orderId: string,
  input: AddOrderProductAddOnInput,
  actorContext: ActorContext
): Promise<POSWorkspace> {
  const data = addOrderProductAddOnSchema.parse(input);
  assertFinancialActorContext(actorContext);
  assertActorPermission(actorContext, PERMISSIONS.ORDER_FINANCIAL_UPDATE);

  await withRetry(
    () =>
      db.$transaction(async (tx) => {
        const [order, product] = await Promise.all([
          tx.order.findUnique({
            where: { id: orderId },
            include: {
              invoices: {
                where: FINAL_PARENT_INVOICE_WHERE,
                select: { id: true, isLocked: true },
                orderBy: { createdAt: "asc" },
                take: 1,
              },
              orderAddOns: {
                select: {
                  productId: true,
                  nameSnapshot: true,
                  priceSnapshot: true,
                  quantity: true,
                },
                orderBy: { createdAt: "asc" },
              },
              packageItemUpgrades: {
                select: packageItemUpgradeSelect,
                orderBy: { createdAt: "asc" },
              },
              packages: {
                select: {
                  selectedPhotoCount: true,
                  package: { select: { photoCount: true } },
                },
              },
            },
          }),
          tx.product.findUnique({
            where: { id: data.productId },
            select: {
              id: true,
              name: true,
              canonicalPrice: true,
              isActive: true,
              isAddOn: true,
              isPackageDeliverable: true,
            },
          }),
        ]);

        if (!order) throw new Error("Order not found");
        if (order.status === OrderStatus.DELIVERED) {
          throw new Error("Delivered orders cannot be edited");
        }
        assertDirectPOSMutationAllowed(order.invoices[0]);
        if (!product || !product.isActive || (!product.isAddOn && !product.isPackageDeliverable)) {
          throw new Error("Selected add-on product is not available");
        }
        const previousAddOns = mapStructuredAddOns(
          combineFinancialAddOnRows(order.orderAddOns, order.packageItemUpgrades)
        );
        const addOn = await tx.orderAddOn.create({
          data: {
            orderId,
            productId: product.id,
            nameSnapshot: product.name,
            priceSnapshot: product.canonicalPrice,
            quantity: 1,
          },
          select: { id: true },
        });

        const invoiceSummary = await syncOrderInvoiceForFinancialEdit(tx, {
          orderId,
          actorContext,
          previousAddOns,
          previousSelectedPhotoCount: getOrderTotalSelectedPhotoCount(order.packages),
          previousIncludedPhotoCount: null,
        });

        await recordOrderActivity(tx, {
          orderId,
          userId: actorContext.actorUserId ?? null,
          type: OrderActivityType.ADD_ON_CHANGED,
          title: "Add-on added",
          description: `${product.name} was added for ${formatMoney(product.canonicalPrice)}.`,
          metadata: {
            orderAddOnId: addOn.id,
            productId: product.id,
            productName: product.name,
            price: product.canonicalPrice.toFixed(3),
            addOnAdjustmentAmount: invoiceSummary.addOnAdjustmentAmount.toFixed(3),
          },
        });

        if (!invoiceSummary.totalAdjustmentAmount.equals(0) || invoiceSummary.createdInvoice) {
          await recordOrderActivity(tx, {
            orderId,
            userId: actorContext.actorUserId ?? null,
            type: OrderActivityType.INVOICE_ADJUSTED,
            title: invoiceSummary.createdInvoice ? "Invoice created" : "Invoice adjusted",
            description: `Invoice ${invoiceSummary.invoiceNumber} now totals ${invoiceSummary.totalAmount}.`,
            metadata: {
              invoiceId: invoiceSummary.invoiceId,
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
      }),
    "Failed to add order add-on"
  );

  const workspace = await getPOSWorkspace(orderId);
  if (!workspace) throw new Error("Order not found after add-on update");
  return workspace;
}

export async function removeOrderAddOn(
  orderId: string,
  input: RemoveOrderAddOnInput,
  actorContext: ActorContext
): Promise<POSWorkspace> {
  const data = removeOrderAddOnSchema.parse(input);
  assertFinancialActorContext(actorContext);
  assertActorPermission(actorContext, PERMISSIONS.ORDER_FINANCIAL_UPDATE);

  await withRetry(
    () =>
      db.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: {
            invoices: {
              where: FINAL_PARENT_INVOICE_WHERE,
              select: { id: true, isLocked: true },
              orderBy: { createdAt: "asc" },
              take: 1,
            },
            orderAddOns: {
              select: {
                productId: true,
                nameSnapshot: true,
                priceSnapshot: true,
                quantity: true,
              },
              orderBy: { createdAt: "asc" },
            },
            packageItemUpgrades: {
              select: packageItemUpgradeSelect,
              orderBy: { createdAt: "asc" },
            },
            packages: {
              select: {
                selectedPhotoCount: true,
                package: { select: { photoCount: true } },
              },
            },
          },
        });

        if (!order) throw new Error("Order not found");
        if (order.status === OrderStatus.DELIVERED) {
          throw new Error("Delivered orders cannot be edited");
        }
        assertDirectPOSMutationAllowed(order.invoices[0]);

        const previousAddOns = mapStructuredAddOns(
          combineFinancialAddOnRows(order.orderAddOns, order.packageItemUpgrades)
        );
        const addOn = await tx.orderAddOn.findFirst({
          where: {
            id: data.addOnId,
            orderId,
          },
          select: {
            id: true,
            productId: true,
            nameSnapshot: true,
            priceSnapshot: true,
            quantity: true,
          },
        });
        if (!addOn) {
          throw new Error("Selected add-on is not on this order");
        }
        const selectionOwner =
          await tx.orderPackageSessionConfigurationSelection.findFirst({
            where: { orderAddOnId: addOn.id },
            select: { id: true, snapshotLabel: true },
          });
        if (selectionOwner) {
          console.info(
            JSON.stringify({
              metric: "add_on.delete_blocked_by_session_configuration",
              orderId,
              orderAddOnId: addOn.id,
              selectionId: selectionOwner.id,
            })
          );
          throw new OrderAddOnOwnedBySessionConfigurationError(
            selectionOwner.snapshotLabel
          );
        }

        if (addOn.quantity > 1) {
          await tx.orderAddOn.update({
            where: { id: addOn.id },
            data: { quantity: addOn.quantity - 1 },
          });
        } else {
          await tx.orderAddOn.delete({ where: { id: addOn.id } });
        }

        const invoiceSummary = await syncOrderInvoiceForFinancialEdit(tx, {
          orderId,
          actorContext,
          previousAddOns,
          previousSelectedPhotoCount: getOrderTotalSelectedPhotoCount(order.packages),
          previousIncludedPhotoCount: null,
          managerApprovedReductionByUserId:
            data.managerApprovedReductionByUserId,
          managerApprovedReason: data.managerApprovedReason,
        });

        await recordOrderActivity(tx, {
          orderId,
          userId: actorContext.actorUserId ?? null,
          type: OrderActivityType.ADD_ON_CHANGED,
          title: "Add-on removed",
          description: `${addOn.nameSnapshot} was removed.`,
          metadata: {
            orderAddOnId: addOn.id,
            productId: addOn.productId,
            productName: addOn.nameSnapshot,
            price: addOn.priceSnapshot.toFixed(3),
            previousQuantity: addOn.quantity,
            nextQuantity: Math.max(addOn.quantity - 1, 0),
            addOnAdjustmentAmount: invoiceSummary.addOnAdjustmentAmount.toFixed(3),
          },
        });

        if (!invoiceSummary.totalAdjustmentAmount.equals(0) || invoiceSummary.createdInvoice) {
          await recordOrderActivity(tx, {
            orderId,
            userId: actorContext.actorUserId ?? null,
            type: OrderActivityType.INVOICE_ADJUSTED,
            title: invoiceSummary.createdInvoice ? "Invoice created" : "Invoice adjusted",
            description: `Invoice ${invoiceSummary.invoiceNumber} now totals ${invoiceSummary.totalAmount}.`,
            metadata: {
              invoiceId: invoiceSummary.invoiceId,
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
      }),
    "Failed to remove order add-on",
    undefined,
    shouldRetryOrderFinancialEditError
  );

  const workspace = await getPOSWorkspace(orderId);
  if (!workspace) throw new Error("Order not found after add-on removal");
  return workspace;
}

export async function updateOrderSelectedPhotoCount(
  orderId: string,
  input: UpdateOrderSelectedPhotoCountInput,
  actorContext: ActorContext
): Promise<POSWorkspace> {
  const data = updateOrderSelectedPhotoCountSchema.parse(input);
  assertFinancialActorContext(actorContext);
  assertActorPermission(actorContext, PERMISSIONS.ORDER_FINANCIAL_UPDATE);

  await withRetry(
    () =>
      db.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: {
            packages: {
              where: { id: data.orderPackageId },
              include: {
                package: { select: { price: true, photoCount: true } },
              },
              take: 1,
            },
            invoices: {
              where: FINAL_PARENT_INVOICE_WHERE,
              select: { id: true, isLocked: true },
              orderBy: { createdAt: "asc" },
              take: 1,
            },
            orderAddOns: {
              select: {
                productId: true,
                nameSnapshot: true,
                priceSnapshot: true,
                quantity: true,
              },
              orderBy: { createdAt: "asc" },
            },
            packageItemUpgrades: {
              select: packageItemUpgradeSelect,
              orderBy: { createdAt: "asc" },
            },
          },
        });

        if (!order) throw new Error("Order not found");
        if (order.status === OrderStatus.DELIVERED) {
          throw new Error("Delivered orders cannot be edited");
        }
        assertDirectPOSMutationAllowed(order.invoices[0]);

        const orderPackage = order.packages[0] ?? null;
        if (!orderPackage) throw new Error("Package line not found on this order");
        const currentPackage = orderPackage.package;
        if (data.selectedPhotoCount < currentPackage.photoCount) {
          throw new Error("Selected photos cannot be below included package photos");
        }
        const derivedExtraCount = Math.max(
          data.selectedPhotoCount - currentPackage.photoCount,
          0
        );
        if (data.extraDigitalCount + data.extraPrintCount !== derivedExtraCount) {
          throw new Error(
            "Digital and print extra allocations must equal the derived extra-photo count."
          );
        }

        const previousAddOns = mapStructuredAddOns(
          combineFinancialAddOnRows(order.orderAddOns, order.packageItemUpgrades)
        );
        const previousExtraPhotoCharge = await calculateOrderPackageLineExtraPhotoTotal(
          tx,
          {
            sessionTypeId: orderPackage.sessionTypeId,
            extraDigitalCount: orderPackage.extraDigitalCount,
            extraPrintCount: orderPackage.extraPrintCount,
          }
        );
        await tx.orderPackage.update({
          where: { id: orderPackage.id },
          data: {
            selectedPhotoCount: data.selectedPhotoCount,
            extraDigitalCount: data.extraDigitalCount,
            extraPrintCount: data.extraPrintCount,
          },
        });
        await syncOrderSelectedPhotoCountFromPackageLines(tx, orderId);

        const invoiceSummary = await syncOrderInvoiceForFinancialEdit(tx, {
          orderId,
          actorContext,
          previousAddOns,
          previousSelectedPhotoCount: null,
          previousIncludedPhotoCount: currentPackage.photoCount,
          previousExtraPhotoCharge,
          managerApprovedReductionByUserId:
            data.managerApprovedReductionByUserId,
          managerApprovedReason: data.managerApprovedReason,
        });

        if (
          orderPackage.selectedPhotoCount !== data.selectedPhotoCount ||
          orderPackage.extraDigitalCount !== data.extraDigitalCount ||
          orderPackage.extraPrintCount !== data.extraPrintCount
        ) {
          await recordOrderActivity(tx, {
            orderId,
            userId: actorContext.actorUserId ?? null,
            type: OrderActivityType.ORDER_PACKAGE_EXTRAS_CHANGED,
            title: "Package line photo selection updated",
            description: `Selected photos changed to ${data.selectedPhotoCount}.`,
            metadata: {
              orderPackageId: orderPackage.id,
              previousSelectedPhotoCount: orderPackage.selectedPhotoCount,
              nextSelectedPhotoCount: data.selectedPhotoCount,
              includedPhotoCount: currentPackage.photoCount,
              previousExtraDigitalCount: orderPackage.extraDigitalCount,
              previousExtraPrintCount: orderPackage.extraPrintCount,
              nextExtraDigitalCount: data.extraDigitalCount,
              nextExtraPrintCount: data.extraPrintCount,
              extraPhotoCount: data.extraDigitalCount + data.extraPrintCount,
            },
          });
        }

        if (!invoiceSummary.totalAdjustmentAmount.equals(0) || invoiceSummary.createdInvoice) {
          await recordOrderActivity(tx, {
            orderId,
            userId: actorContext.actorUserId ?? null,
            type: OrderActivityType.INVOICE_ADJUSTED,
            title: invoiceSummary.createdInvoice ? "Invoice created" : "Invoice adjusted",
            description: `Invoice ${invoiceSummary.invoiceNumber} now totals ${invoiceSummary.totalAmount}.`,
            metadata: {
              invoiceId: invoiceSummary.invoiceId,
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
      }),
    "Failed to update selected photo count",
    undefined,
    shouldRetryOrderFinancialEditError
  );

  const workspace = await getPOSWorkspace(orderId);
  if (!workspace) throw new Error("Order not found after selected photo update");
  return workspace;
}

export async function updateOrderEditingWorkflow(
  orderId: string,
  input: UpdateOrderEditingWorkflowInput,
  actorContext: ActorContext
): Promise<OrderEditingWorkflow> {
  const data = updateOrderEditingWorkflowSchema.parse(input);
  assertActorPermission(actorContext, PERMISSIONS.WORKFLOW_EDITING_UPDATE);

  await withRetry(
    () =>
      db.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: {
            editingJob: {
              include: {
                assignedEditor: { select: { id: true, name: true } },
              },
            },
            productionJob: {
              select: productionJobSelect,
            },
            booking: {
              select: {
                financialCase: {
                  select: {
                    invoices: {
                      where: {
                        parentInvoiceId: null,
                        invoiceType: InvoiceType.DEPOSIT,
                      },
                      select: { invoiceType: true, remainingAmount: true },
                      take: 1,
                    },
                  },
                },
              },
            },
            invoices: {
              where: FINAL_PARENT_INVOICE_WHERE,
              select: {
                remainingAmount: true,
              },
              orderBy: { createdAt: "asc" },
              take: 1,
            },
          },
        });

        if (!order) {
          throw new Error("Order not found");
        }
        if (order.status === OrderStatus.CANCELLED) {
          throw new Error("Cancelled orders cannot be moved through editing");
        }
        if (order.status === OrderStatus.DELIVERED) {
          throw new Error("Delivered orders cannot be moved through editing");
        }

        const basePaymentVerified = basePaymentSettled(order);
        const outstandingBalance = order.invoices.reduce(
          (sum, invoice) => sum.plus(invoice.remainingAmount),
          zeroMoney()
        );
        const now = new Date();
        let editingJob = order.editingJob;
        if (!editingJob) {
          try {
            editingJob = await tx.editingJob.create({
              data: {
                jobId: order.jobId,
                orderId: order.id,
              },
              include: {
                assignedEditor: { select: { id: true, name: true } },
              },
            });
          } catch (error) {
            const isP2002 =
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === "P2002";
            if (!isP2002) throw error;
            const existing = await tx.editingJob.findUnique({
              where: { orderId: order.id },
              include: { assignedEditor: { select: { id: true, name: true } } },
            });
            if (!existing) throw error;
            editingJob = existing;
          }
        }
        const previousEditingStatus = editingJob.status;
        const previousAssignedEditorId = editingJob.assignedEditorId;
        const previousAssignedEditorName = editingJob.assignedEditor?.name ?? null;
        const previousEditedPhotoCount = editingJob.editedPhotoCount;
        const previousRevisionCount = editingJob.revisionCount;
        const previousEstimatedEditingCompletionAt =
          editingJob.estimatedEditingCompletionAt;

        switch (data.action) {
          case "assignEditor": {
            if (!data.assignedEditorId) {
              throw new Error("Editor is required");
            }
            const editor = await tx.user.findFirst({
              where: { id: data.assignedEditorId, role: UserRole.EDITOR },
              select: { id: true, name: true },
            });
            if (!editor) {
              throw new Error("Selected editor does not exist");
            }

            const nextStatus =
              previousEditingStatus === OrderEditingStatus.NOT_STARTED
                ? OrderEditingStatus.ASSIGNED
                : previousEditingStatus;
            if (nextStatus !== previousEditingStatus) {
              assertWorkflowTransition(
                "editingStatus",
                previousEditingStatus,
                nextStatus
              );
            }

            editingJob = await tx.editingJob.update({
              where: { orderId: order.id },
              data: {
                assignedEditorId: editor.id,
                editingAssignedAt: now,
                estimatedEditingCompletionAt:
                  data.estimatedEditingCompletionAt ?? previousEstimatedEditingCompletionAt,
                status: nextStatus,
              },
              include: {
                assignedEditor: { select: { id: true, name: true } },
              },
            });

            await recordOrderActivity(tx, {
              orderId,
              userId: actorContext.actorUserId ?? null,
              type: OrderActivityType.EDITOR_ASSIGNED,
              title: previousAssignedEditorId ? "Editor reassigned" : "Editor assigned",
              description: `${editor.name} was assigned to editing.`,
              metadata: {
                previousEditorId: previousAssignedEditorId,
                previousEditorName: previousAssignedEditorName,
                nextEditorId: editor.id,
                nextEditorName: editor.name,
                previousStatus: previousEditingStatus,
                nextStatus,
                estimatedEditingCompletionAt:
                  data.estimatedEditingCompletionAt?.toISOString() ?? null,
              },
            });
            break;
          }

          case "markStarted": {
            assertEditingReadyToStart(
              {
                selectionStatus: order.selectionStatus,
                assignedEditorId: previousAssignedEditorId,
              },
              basePaymentVerified,
              outstandingBalance
            );
            assertWorkflowTransition(
              "editingStatus",
              previousEditingStatus,
              OrderEditingStatus.IN_PROGRESS
            );
            editingJob = await tx.editingJob.update({
              where: { orderId: order.id },
              data: {
                status: OrderEditingStatus.IN_PROGRESS,
                editingStartedAt: editingJob.editingStartedAt ?? now,
                editedPhotoCount: data.editedPhotoCount ?? previousEditedPhotoCount,
                estimatedEditingCompletionAt:
                  data.estimatedEditingCompletionAt ?? previousEstimatedEditingCompletionAt,
              },
              include: {
                assignedEditor: { select: { id: true, name: true } },
              },
            });
            await tx.order.update({
              where: { id: orderId },
              data: {
                status: OrderStatus.EDITING,
              },
            });
            await recordEditingStatusActivity(tx, orderId, {
              previousStatus: previousEditingStatus,
              nextStatus: OrderEditingStatus.IN_PROGRESS,
              title: "Editing started",
            }, actorContext);
            break;
          }

          case "requestRevision": {
            assertWorkflowTransition(
              "editingStatus",
              previousEditingStatus,
              OrderEditingStatus.REVISION_REQUESTED
            );
            editingJob = await tx.editingJob.update({
              where: { orderId: order.id },
              data: {
                status: OrderEditingStatus.REVISION_REQUESTED,
                revisionCount: { increment: 1 },
              },
              include: {
                assignedEditor: { select: { id: true, name: true } },
              },
            });
            await recordEditingStatusActivity(tx, orderId, {
              previousStatus: previousEditingStatus,
              nextStatus: OrderEditingStatus.REVISION_REQUESTED,
              title: "Revision requested",
              metadata: { nextRevisionCount: previousRevisionCount + 1 },
            }, actorContext);
            break;
          }

          case "markComplete": {
            assertWorkflowTransition(
              "editingStatus",
              previousEditingStatus,
              OrderEditingStatus.AWAITING_APPROVAL
            );
            editingJob = await tx.editingJob.update({
              where: { orderId: order.id },
              data: {
                status: OrderEditingStatus.AWAITING_APPROVAL,
                editingCompletedAt: now,
                editedPhotoCount: data.editedPhotoCount ?? previousEditedPhotoCount,
              },
              include: {
                assignedEditor: { select: { id: true, name: true } },
              },
            });
            await recordEditingStatusActivity(tx, orderId, {
              previousStatus: previousEditingStatus,
              nextStatus: OrderEditingStatus.AWAITING_APPROVAL,
              title: "Editing marked complete",
            }, actorContext);
            break;
          }

          case "markApproved": {
            assertWorkflowTransition(
              "editingStatus",
              previousEditingStatus,
              OrderEditingStatus.APPROVED
            );
            editingJob = await tx.editingJob.update({
              where: { orderId: order.id },
              data: {
                status: OrderEditingStatus.APPROVED,
                customerApprovedAt: now,
              },
              include: {
                assignedEditor: { select: { id: true, name: true } },
              },
            });
            await recordEditingStatusActivity(tx, orderId, {
              previousStatus: previousEditingStatus,
              nextStatus: OrderEditingStatus.APPROVED,
              title: "Customer approved editing",
            }, actorContext);
            break;
          }

          case "sendToProduction": {
            const previousProductionStatus =
              order.productionJob?.status ?? resolveDefaultProductionStatus(previousEditingStatus);
            assertWorkflowTransition(
              "editingStatus",
              previousEditingStatus,
              OrderEditingStatus.COMPLETED
            );
            assertWorkflowTransition(
              "productionStatus",
              previousProductionStatus,
              OrderProductionStatus.IN_PROGRESS
            );
            editingJob = await tx.editingJob.update({
              where: { orderId: order.id },
              data: {
                status: OrderEditingStatus.COMPLETED,
                sentToProductionAt: now,
              },
              include: {
                assignedEditor: { select: { id: true, name: true } },
              },
            });
            await tx.productionJob.upsert({
              where: { orderId: order.id },
              update: {
                status: OrderProductionStatus.IN_PROGRESS,
                productionStartedAt: order.productionJob?.productionStartedAt ?? now,
              },
              create: {
                jobId: order.jobId,
                orderId: order.id,
                status: OrderProductionStatus.IN_PROGRESS,
                productionStartedAt: now,
              },
            });
            await tx.order.update({
              where: { id: orderId },
              data: {
                status: OrderStatus.PRODUCTION,
              },
            });
            await recordEditingStatusActivity(tx, orderId, {
              previousStatus: previousEditingStatus,
              nextStatus: OrderEditingStatus.COMPLETED,
              title: "Editing sent to production",
            }, actorContext);
            await recordOrderActivity(tx, {
              orderId,
              userId: actorContext.actorUserId ?? null,
              type: OrderActivityType.PRODUCTION_STATUS_CHANGED,
              title: "Production started",
              metadata: {
                field: "productionStatus",
                previousStatus: previousProductionStatus,
                nextStatus: OrderProductionStatus.IN_PROGRESS,
              },
            });
            break;
          }
        }
      }),
    "Failed to update editing workflow"
  );

  const workflow = await getOrderEditingWorkflowById(orderId);
  if (!workflow) throw new Error("Order not found after editing update");
  return workflow;
}

export async function updateOrderProductionWorkflow(
  orderId: string,
  input: UpdateOrderProductionWorkflowInput,
  actorContext: ActorContext
): Promise<OrderProductionWorkflow> {
  const data = updateOrderProductionWorkflowSchema.parse(input);
  assertActorPermission(actorContext, PERMISSIONS.WORKFLOW_PRODUCTION_UPDATE);

  await withRetry(
    () =>
      db.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            status: true,
            jobId: true,
            editingJob: {
              select: {
                status: true,
              },
            },
            deliveryStatus: true,
            productionJob: {
              select: productionJobSelect,
            },
          },
        });

        if (!order) {
          throw new Error("Order not found");
        }
        assertProductionWorkflowWritable(order.status);

        let next: ReturnType<typeof resolveProductionUpdate>;
        try {
          next = resolveProductionUpdate(order, data.action);
        } catch (err) {
          if (err instanceof WorkflowGuardError) {
            await recordGuardBlockedActivity({
              orderId,
              userId: actorContext.actorUserId,
              attemptedAction: data.action,
              reason: err.message,
              metadata: { guardCode: err.code, action: data.action },
            });
          }
          throw err;
        }

        const previousProductionStatus = getProductionStatus(order);
        if (next.productionStatus && next.productionStatus !== previousProductionStatus) {
          assertWorkflowTransition(
            "productionStatus",
            previousProductionStatus,
            next.productionStatus
          );
        }
        if (next.deliveryStatus && next.deliveryStatus !== order.deliveryStatus) {
          assertWorkflowTransition(
            "deliveryStatus",
            order.deliveryStatus,
            next.deliveryStatus
          );
        }

        await tx.order.update({
          where: { id: orderId },
          data: next.orderData.order,
        });

        await tx.productionJob.upsert({
          where: { orderId: order.id },
          update: next.orderData.productionJob,
          create: {
            jobId: order.jobId,
            orderId: order.id,
            ...next.orderData.productionJob,
          },
        });

        await recordOrderActivity(tx, {
          orderId,
          userId: actorContext.actorUserId ?? null,
          type: OrderActivityType.PRODUCTION_STATUS_CHANGED,
          title: next.title,
          description: next.description,
          metadata: next.metadata,
        });

        if (next.deliveryStatus && next.deliveryStatus !== order.deliveryStatus) {
          await recordOrderActivity(tx, {
            orderId,
            userId: actorContext.actorUserId ?? null,
            type: OrderActivityType.DELIVERY_STATUS_CHANGED,
            title: "Delivery readiness updated",
            description: "Order is ready for customer pickup.",
            metadata: {
              field: "deliveryStatus",
              previousStatus: order.deliveryStatus,
              nextStatus: next.deliveryStatus,
              source: "production",
            },
          });
        }
      }),
    "Failed to update production workflow",
    3,
    (err) => !(err instanceof WorkflowGuardError)
  );

  const workflow = await getOrderProductionWorkflowById(orderId);
  if (!workflow) throw new Error("Order not found after production update");
  return workflow;
}

export async function updateOrderDeliveryWorkflow(
  orderId: string,
  input: UpdateOrderDeliveryWorkflowInput,
  actorContext: ActorContext
): Promise<OrderDeliveryWorkflow> {
  const data = updateOrderDeliveryWorkflowSchema.parse(input);
  assertActorPermission(actorContext, PERMISSIONS.DELIVERY_UPDATE);
  if (data.action === "markPickedUp") {
    assertActorPermission(actorContext, PERMISSIONS.DELIVERY_COMPLETE);
  }
  if (data.allowPaymentOverride) {
    assertActorPermission(actorContext, PERMISSIONS.DELIVERY_PAYMENT_OVERRIDE);
  }

  await withRetry(
    () =>
      db.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          select: deliveryOrderSelect,
        });

        if (!order) {
          throw new Error("Order not found");
        }
        assertDeliveryWorkflowWritable(order.status);

        let next: ReturnType<typeof resolveDeliveryUpdate>;
        try {
          next = resolveDeliveryUpdate(order, data, actorContext);
        } catch (err) {
          if (err instanceof WorkflowGuardError) {
            await recordGuardBlockedActivity({
              orderId,
              userId: actorContext.actorUserId,
              attemptedAction: data.action,
              reason: err.message,
              metadata: {
                guardCode: err.code,
                allowPaymentOverride: data.allowPaymentOverride,
                overrideReasonProvided: Boolean(data.overrideReason?.trim()),
              },
            });
          }
          throw err;
        }

        const previousProductionStatus = getProductionStatus(order);
        if (next.deliveryStatus && next.deliveryStatus !== order.deliveryStatus) {
          assertWorkflowTransition(
            "deliveryStatus",
            order.deliveryStatus,
            next.deliveryStatus
          );
        }
        if (next.productionStatus && next.productionStatus !== previousProductionStatus) {
          assertWorkflowTransition(
            "productionStatus",
            previousProductionStatus,
            next.productionStatus
          );
        }

        await tx.order.update({
          where: { id: orderId },
          data: next.orderData.order,
        });

        await tx.productionJob.upsert({
          where: { orderId: order.id },
          update: next.orderData.productionJob,
          create: {
            jobId: order.jobId,
            orderId: order.id,
            ...next.orderData.productionJob,
          },
        });

        await recordOrderActivity(tx, {
          orderId,
          userId: actorContext.actorUserId ?? null,
          type: OrderActivityType.DELIVERY_STATUS_CHANGED,
          title: next.title,
          description: next.description,
          metadata: next.metadata,
        });

        if (next.completed) {
          for (const invoice of order.invoices) {
            if (invoice.isLocked || invoice.parentInvoiceId !== null) continue;
            if (invoice.orderId) {
              await snapshotInvoiceLineItemsWithClient(tx, invoice.id, invoice.orderId);
            }
            const closedAt = new Date();
            const updateResult = await tx.invoice.updateMany({
              where: { id: invoice.id, isLocked: false },
              data: {
                status: InvoiceStatus.CLOSED,
                isLocked: true,
                closedAt,
              },
            });
            if (updateResult.count === 0) continue;

            await recordInvoiceLockSnapshot(tx, invoice, actorContext.actorUserId);

            await recordAuditLog(tx, actorContext, {
              entityType: AuditEntityType.INVOICE,
              entityId: invoice.id,
              action: AuditAction.INVOICE_LOCKED,
              before: {
                isLocked: invoice.isLocked,
                status: invoice.status,
                closedAt: invoice.closedAt?.toISOString() ?? null,
              },
              after: {
                isLocked: true,
                status: InvoiceStatus.CLOSED,
                closedAt: closedAt.toISOString(),
              },
              context: {
                financialCaseId: invoice.financialCaseId,
                orderId: invoice.orderId ?? null,
                bookingId: invoice.bookingId ?? null,
                invoiceType: invoice.invoiceType,
              },
            });
          }

          await recordOrderActivity(tx, {
            orderId,
            userId: actorContext.actorUserId ?? null,
            type: OrderActivityType.ORDER_COMPLETED,
            title: "Order completed",
            description: "Order was completed through the delivery workflow.",
            metadata: {
              completedById: next.completedById ?? null,
              completedAt: new Date().toISOString(),
              paymentOverrideUsed: next.paymentOverrideUsed,
              overrideReason: data.overrideReason?.trim() ?? null,
            },
          });
        }
      }),
    "Failed to update delivery workflow",
    3,
    (err) => !(err instanceof WorkflowGuardError)
  );

  const workflow = await getOrderDeliveryWorkflowById(orderId);
  if (!workflow) throw new Error("Order not found after delivery update");
  return workflow;
}

export async function updateOrderWorkflowStatus(
  orderId: string,
  input: UpdateOrderWorkflowInput,
  actorContext: ActorContext
): Promise<OrderDetail> {
  const data = updateOrderWorkflowSchema.parse(input);

  const row = await withRetry(
    () =>
      db.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            jobId: true,
            status: true,
            selectionStatus: true,
            editingJob: {
              select: {
                status: true,
              },
            },
            deliveryStatus: true,
            productionJob: {
              select: productionJobSelect,
            },
          },
        });

        if (!order) {
          throw new Error("Order not found");
        }
        if (order.status === OrderStatus.CANCELLED) {
          throw new Error("Cancelled orders cannot be moved through workflow");
        }
        const editingStatus = order.editingJob?.status ?? OrderEditingStatus.NOT_STARTED;
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
            editingStatus,
            data.editingStatus
          );
        }
        if (data.productionStatus) {
          assertWorkflowTransition(
            "productionStatus",
            order.productionJob?.status ??
              resolveDefaultProductionStatus(editingStatus),
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

        const orderData: Prisma.OrderUpdateInput = {};
        if (data.selectionStatus) {
          orderData.selectionStatus = data.selectionStatus;
          if (
            data.selectionStatus === OrderSelectionStatus.COMPLETED &&
            order.status === OrderStatus.WAITING_SELECTION
          ) {
            orderData.status = OrderStatus.SELECTION_COMPLETED;
          }
        }
        if (data.productionStatus) {
          await tx.productionJob.upsert({
            where: { orderId },
            update: buildProductionJobStatusUpdate(data.productionStatus),
            create: {
              jobId: order.jobId,
              orderId,
              ...buildProductionJobStatusUpdate(data.productionStatus),
            },
          });
        }
        if (data.deliveryStatus) {
          orderData.deliveryStatus = data.deliveryStatus;
        }
        if (Object.keys(orderData).length > 0) {
          await tx.order.update({
            where: { id: orderId },
            data: orderData,
          });
        }

        if (data.editingStatus) {
          await tx.editingJob.upsert({
            where: { orderId },
            update: {
              status: data.editingStatus,
            },
            create: {
              jobId: order.jobId,
              orderId,
              status: data.editingStatus,
            },
          });
        }

        await recordWorkflowActivities(tx, orderId, {
          selectionStatus: order.selectionStatus,
          editingStatus,
          productionStatus:
            order.productionJob?.status ?? resolveDefaultProductionStatus(editingStatus),
          deliveryStatus: order.deliveryStatus,
        }, data, actorContext);

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
  bookingId: string,
  actorContext: ActorContext
): Promise<{ id: string }> {
  return withRetry(
    () =>
      db.$transaction((tx) =>
        createOrderFromBookingWithClient(tx, bookingId, OrderStatus.ACTIVE, actorContext)
      ),
    "Failed to create order from booking",
    2
  );
}

export async function createOrderFromBookingWithClient(
  client: OrderWriteClient,
  bookingId: string,
  initialStatus: OrderStatus = OrderStatus.ACTIVE,
  actorContext: ActorContext
): Promise<{ id: string }> {
  const booking = await client.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      jobId: true,
      jobNumber: true,
      customer: { select: { id: true } },
      packages: {
        include: {
          package: { select: { id: true, price: true, photoCount: true } },
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
      order: { select: { id: true } },
    },
  });

  if (!booking) {
    throw new Error("Booking not found");
  }
  const firstPackageLine = booking.packages[0] ?? null;
  if (!firstPackageLine) {
    throw new Error("Booking package is required to create an order");
  }
  const firstPackage = firstPackageLine.package;
  if (!booking.jobId || !booking.jobNumber) {
    throw new Error("Booking must have a job before an order can be created");
  }
  if (booking.order) {
    await client.editingJob.upsert({
      where: { orderId: booking.order.id },
      update: {},
      create: {
        jobId: booking.jobId,
        orderId: booking.order.id,
      },
    });
    await client.productionJob.upsert({
      where: { orderId: booking.order.id },
      update: {},
      create: {
        jobId: booking.jobId,
        orderId: booking.order.id,
      },
    });
    return booking.order;
  }

  const order = await client.order.create({
    data: {
      publicId: await generatePublicId(client, PUBLIC_ID_KIND.ORDER),
      jobId: booking.jobId,
      jobNumber: booking.jobNumber,
      bookingId: booking.id,
      customerId: booking.customer.id,
      packages: {
        create: booking.packages.map((line, index) => {
          if (!line.sessionTypeId) {
            throw new Error("Booking package session type is required to create an order");
          }
          return {
            packageId: line.packageId,
            sessionTypeId: line.sessionTypeId,
            originalPackagePriceSnapshot: line.package.price,
            selectedPhotoCount: line.package.photoCount,
            sortOrder: line.sortOrder ?? index,
          };
        }),
      },
      status: initialStatus,
      editingJob: {
        create: {
          jobId: booking.jobId,
        },
      },
      productionJob: {
        create: {
          jobId: booking.jobId,
        },
      },
    },
    select: { id: true },
  });
  await syncOrderSelectedPhotoCountFromPackageLines(client, order.id);

  await recordOrderActivity(client, {
    orderId: order.id,
    userId: actorContext.actorUserId ?? null,
    type: OrderActivityType.ORDER_CREATED,
    title: "Order created",
    description: "Order was created from the completed booking.",
    metadata: {
      bookingId: booking.id,
      jobNumber: booking.jobNumber,
      packageLinePackageId: firstPackage.id,
      packageId: firstPackage.id,
    },
  });

  return order;
}

async function fetchOrders(filters: OrderFilters) {
  const sessionDateFilter: Prisma.DateTimeFilter | undefined =
    filters.sessionDateFrom || filters.sessionDateTo
      ? {
          ...(filters.sessionDateFrom
            ? { gte: toUtcDateBoundary(filters.sessionDateFrom, "start") }
            : {}),
          ...(filters.sessionDateTo
            ? { lte: toUtcDateBoundary(filters.sessionDateTo, "end") }
            : {}),
        }
      : undefined;
  const normalizedPhone = normalizePhoneSearch(filters.search);

  const where: Prisma.OrderWhereInput = {
    ...(filters.search
      ? {
          OR: [
            {
              customer: {
                phone: {
                  contains: filters.search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
            },
            ...(normalizedPhone
              ? [
                  {
                    customer: {
                      phone: {
                        contains: normalizedPhone,
                        mode: Prisma.QueryMode.insensitive,
                      },
                    },
                  },
                ]
              : []),
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
      ? {
          invoices: {
            some: { ...FINAL_PARENT_INVOICE_WHERE, status: filters.invoiceStatus },
          },
        }
      : {}),
    ...(sessionDateFilter
      ? { booking: { sessionDate: sessionDateFilter } }
      : {}),
    ...(filters.editorId
      ? { editingJob: { assignedEditorId: filters.editorId } }
      : {}),
    ...(filters.hasOpenWorkspace
      ? {
          adjustmentWorkspaces: {
            some: { status: AdjustmentWorkspaceStatus.OPEN },
          },
        }
      : {}),
  };

  return db.order.findMany({
    where,
    include: {
      customer: { select: { name: true, phone: true } },
      booking: {
        select: {
          sessionDate: true,
          financialCase: {
            select: {
              invoices: {
                select: {
                  invoiceType: true,
                  totalAmount: true,
                  remainingAmount: true,
                },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              },
            },
          },
        },
      },
      packages: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          package: { select: { name: true, photoCount: true } },
        },
      },
      invoices: {
        where: FINAL_PARENT_INVOICE_WHERE,
        select: {
          id: true,
          invoiceNumber: true,
          invoiceType: true,
          totalAmount: true,
          paidAmount: true,
          remainingAmount: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
      adjustmentWorkspaces: {
        where: { status: AdjustmentWorkspaceStatus.OPEN },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

function fetchOrdersByCustomerId(customerId: string, limit: number) {
  return db.order.findMany({
    where: { customerId },
    select: {
      id: true,
      jobNumber: true,
      status: true,
      booking: { select: { sessionDate: true } },
      packages: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { package: { select: { name: true } } },
      },
      invoices: {
        where: FINAL_PARENT_INVOICE_WHERE,
        select: {
          invoiceType: true,
          totalAmount: true,
          paidAmount: true,
          remainingAmount: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
      adjustmentWorkspaces: {
        where: { status: AdjustmentWorkspaceStatus.OPEN },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
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
      customer: { select: { name: true, phone: true } },
      booking: {
        select: {
          sessionDate: true,
          financialCase: {
            select: {
              invoices: {
                select: {
                  invoiceType: true,
                  totalAmount: true,
                  remainingAmount: true,
                },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              },
            },
          },
        },
      },
      packages: {
        include: {
          sessionType: { select: { name: true } },
          package: {
            select: {
              name: true,
              photoCount: true,
              bundleAdjustment: true,
              items: {
                select: packageItemDisplaySelect,
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              },
            },
          },
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
      editingJob: {
        select: {
          status: true,
        },
      },
      productionJob: {
        select: productionJobSelect,
      },
      invoices: {
        where: FINAL_PARENT_INVOICE_WHERE,
        select: {
          id: true,
          invoiceNumber: true,
          invoiceType: true,
          totalAmount: true,
          paidAmount: true,
          remainingAmount: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
      orderAddOns: {
        select: {
          productId: true,
          nameSnapshot: true,
          priceSnapshot: true,
          quantity: true,
        },
        orderBy: { createdAt: "asc" },
      },
      packageItemUpgrades: {
        select: packageItemUpgradeSelect,
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

function mapOrderRow(
  row: OrderRow | OrderDetailRow,
  financial: OrdersTableRowProjection | null = null
): Order {
  const invoiceSummary = summarizeInvoices(row.invoices);
  const settlementSummary = computeOrderSettlementSummary({
    invoices: getOrderSettlementInvoices(row),
  });

  return {
    id: row.id,
    jobNumber: row.jobNumber,
    customerPhone: formatCustomerPhone(row.customer.phone),
    bookingDate: formatDate(row.booking.sessionDate),
    originalPackageName: formatOrderPackageNames(row.packages),
    finalPackageName: formatOrderPackageNames(row.packages),
    orderStatus: mapOrderStatus(row.status),
    invoiceStatus: invoiceSummary.status,
    paymentStatus: invoiceSummary.paymentStatus,
    totalAmount: formatMoney(new Prisma.Decimal(settlementSummary.totalOrderValue)),
    paidAmount: formatMoney(new Prisma.Decimal(settlementSummary.paidAmount)),
    remainingAmount: formatMoney(new Prisma.Decimal(settlementSummary.outstandingAmount)),
    financial,
    createdAt: formatDate(row.createdAt),
    primaryInvoiceId: row.invoices[0]?.id ?? null,
    primaryInvoiceNumber: row.invoices[0]?.invoiceNumber ?? null,
    hasOpenAdjustmentWorkspace:
      "adjustmentWorkspaces" in row && row.adjustmentWorkspaces.length > 0,
  };
}

function getOrderSettlementInvoices(
  row: OrderRow | OrderDetailRow
): Array<{
  invoiceType: InvoiceType;
  totalAmount: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
}> {
  if (
    "financialCase" in row.booking &&
    row.booking.financialCase?.invoices &&
    row.booking.financialCase.invoices.length > 0
  ) {
    return row.booking.financialCase.invoices;
  }

  return row.invoices;
}

type CustomerOrderHistoryRow = Awaited<ReturnType<typeof fetchOrdersByCustomerId>>[number];

function formatOrderPackageNames(
  packages: Array<{ package: { name: string } }>
): string {
  if (packages.length === 0) return "—";
  return packages.map((line) => line.package.name).join(", ");
}

function mapCustomerOrderHistoryRow(
  row: CustomerOrderHistoryRow
): CustomerOrderHistoryItem {
  const invoiceSummary = summarizeInvoices(row.invoices);

  return {
    id: row.id,
    jobNumber: row.jobNumber,
    sessionDate: formatDate(row.booking.sessionDate),
    packageName: formatOrderPackageNames(row.packages),
    orderStatus: mapOrderStatus(row.status),
    invoiceStatus: invoiceSummary.status,
    paymentStatus: invoiceSummary.paymentStatus,
  };
}

type InvoiceSummaryRow = Array<{
  invoiceType: InvoiceType;
  totalAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
  status: InvoiceStatus;
}>;

function summarizeInvoices(invoices: InvoiceSummaryRow): {
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
    case OrderStatus.SELECTION_COMPLETED:
      return "Selection Completed";
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
    default:
      throw new Error(`Unhandled OrderStatus: ${status as string}`);
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
  invoices: InvoiceSummaryRow,
  totalAmount: Prisma.Decimal,
  paidAmount: Prisma.Decimal,
  remainingAmount: Prisma.Decimal
): OrderPaymentStatusLabel {
  if (invoices.some((invoice) => invoice.status === InvoiceStatus.CLOSED && remainingAmount.gt(0))) {
    return "Overridden";
  }
  if (invoices.length === 0) {
    return "Pending";
  }
  if (totalAmount.gt(0) && remainingAmount.lte(0)) {
    return "Paid";
  }
  if (paidAmount.lte(0)) {
    return "Pending";
  }
  return "Partially paid";
}

function sanitizeCustomerOrderHistoryLimit(limit: number): number {
  const parsedLimit = Number.isFinite(limit) ? Math.trunc(limit) : 10;

  return Math.min(Math.max(parsedLimit, 1), MAX_CUSTOMER_ORDER_HISTORY_LIMIT);
}

function mapWorkflowStatus(row: {
  selectionStatus: OrderSelectionStatus;
  editingStatus: OrderEditingStatus;
  productionStatus: OrderProductionStatus;
  deliveryStatus: OrderDeliveryStatus;
}): Pick<OrderDetail, "selectionStatus" | "editingStatus" | "productionStatus" | "deliveryStatus"> {
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
  orderStatus: OrderStatusLabel;
  selectionStatus: string;
  editingStatus: string;
  productionStatus: string;
  deliveryStatus: string;
}): string {
  if (input.invoiceStatus === "No Invoice") {
    return "Create the order invoice";
  }
  if (input.orderStatus === "Active") {
    return "Record base payment on booking to begin selection";
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

function formatDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
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

function parseDateInput(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return undefined;
  }

  const [yearText, monthText, dayText] = trimmed.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }

  return trimmed;
}

function toUtcDateBoundary(value: string, boundary: "start" | "end"): Date {
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  return boundary === "start"
    ? new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
    : new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
}

function zeroMoney(): Prisma.Decimal {
  return new Prisma.Decimal(0);
}

async function calculateOrderPackageLineExtraPhotoTotal(
  client: Prisma.TransactionClient,
  input: {
    sessionTypeId: string;
    extraDigitalCount: number;
    extraPrintCount: number;
  }
): Promise<Prisma.Decimal> {
  const pricingRows = await client.sessionTypeExtraPhotoPricing.findMany({
    where: {
      sessionTypeId: input.sessionTypeId,
      mediaType: { in: [MediaType.DIGITAL, MediaType.PRINT] },
    },
    select: { mediaType: true, unitPrice: true },
  });
  const priceByMedia = new Map(
    pricingRows.map((row) => [row.mediaType, row.unitPrice])
  );
  const digitalUnitPrice = priceByMedia.get(MediaType.DIGITAL);
  const printUnitPrice = priceByMedia.get(MediaType.PRINT);
  if (!digitalUnitPrice || !printUnitPrice) {
    throw new Error("Extra-photo pricing is required for this package line");
  }

  return digitalUnitPrice
    .mul(input.extraDigitalCount)
    .plus(printUnitPrice.mul(input.extraPrintCount));
}

async function syncOrderSelectedPhotoCountFromPackageLines(
  client: OrderWriteClient,
  orderId: string
): Promise<void> {
  const lines = await client.orderPackage.findMany({
    where: { orderId },
    select: {
      selectedPhotoCount: true,
      package: { select: { photoCount: true } },
    },
  });
  const selectedPhotoCount = getOrderTotalSelectedPhotoCount(lines);

  await client.order.update({
    where: { id: orderId },
    data: { selectedPhotoCount },
  });
}

function sumOrderPackageFinalPriceDecimal(
  lines: Array<{
    finalPackagePriceSnapshot: Prisma.Decimal | null;
    package: { price: Prisma.Decimal };
  }>
): Prisma.Decimal {
  return lines.reduce(
    (sum, line) => sum.plus(line.finalPackagePriceSnapshot ?? line.package.price),
    zeroMoney()
  );
}

function sumAddOnsDecimal(addOns: OrderAddOn[]): Prisma.Decimal {
  return addOns.reduce(
    (sum, addOn) => sum.plus(new Prisma.Decimal(addOn.price)),
    zeroMoney()
  );
}

function combineFinancialAddOnRows(
  addOns: Array<{
    productId: string | null;
    nameSnapshot: string;
    priceSnapshot: Prisma.Decimal;
    quantity: number;
  }>,
  packageItemUpgrades: Array<{
    id?: string;
    nameSnapshot: string;
    priceSnapshot: Prisma.Decimal;
    quantity: number;
  }>
): FinancialAddOnRow[] {
  return [
    ...addOns,
    ...packageItemUpgrades.map((upgrade) => ({
      ...(upgrade.id ? { id: upgrade.id } : {}),
      productId: null,
      nameSnapshot: upgrade.nameSnapshot,
      priceSnapshot: upgrade.priceSnapshot,
      quantity: upgrade.quantity,
    })),
  ];
}

function sumOrderAddOnRowsDecimal(
  rows: Array<{
    priceSnapshot: Prisma.Decimal;
    quantity: number;
  }>
): Prisma.Decimal {
  return rows.reduce(
    (sum, row) => sum.plus(row.priceSnapshot.mul(row.quantity)),
    zeroMoney()
  );
}

function mapStructuredAddOns(
  rows: Array<{
    productId: string | null;
    nameSnapshot: string;
    priceSnapshot: Prisma.Decimal;
    quantity: number;
  }>
): OrderAddOn[] {
  return rows.flatMap((row) => {
    const entries: OrderAddOn[] = [];
    for (let i = 0; i < row.quantity; i++) {
      entries.push({
        ...(row.productId ? { productId: row.productId } : {}),
        name: row.nameSnapshot,
        price: row.priceSnapshot.toNumber(),
      });
    }
    return entries;
  });
}

function formatAddOnsSummary(addOns: OrderAddOn[]): string {
  if (addOns.length === 0) return "—";

  return addOns
    .map((addOn) => `${addOn.name} (${formatMoney(new Prisma.Decimal(addOn.price))})`)
    .join(", ");
}

function mapOrderAddOnDisplays(
  rows: Array<{
    productId: string | null;
    nameSnapshot: string;
    priceSnapshot: Prisma.Decimal;
    quantity: number;
  }>
): OrderAddOnDisplay[] {
  return rows.map((row) => ({
    productId: row.productId,
    name: row.nameSnapshot,
    quantity: row.quantity,
    unitPrice: formatMoney(row.priceSnapshot),
    lineTotal: formatMoney(row.priceSnapshot.mul(row.quantity)),
  }));
}

function mapPOSPackage(packageRow: {
  id: string;
  name: string;
  price: Prisma.Decimal;
  photoCount: number;
  bundleAdjustment: Prisma.Decimal;
}): POSPackage {
  return {
    id: packageRow.id,
    name: packageRow.name,
    price: packageRow.price.toNumber(),
    priceLabel: formatMoney(packageRow.price),
    photoCount: packageRow.photoCount,
    bundleAdjustment: packageRow.bundleAdjustment.toNumber(),
  };
}

function mapPOSPackageItems(
  rows: Array<{
    id: string;
    productId: string;
    quantity: number;
    priceSnapshot: Prisma.Decimal;
    product: {
      name: string;
      category: ProductCategory;
    };
  }>
): POSPackageItem[] {
  return rows.map((row) => ({
    id: row.id,
    productId: row.productId,
    productName: row.product.name,
    category: row.product.category,
    quantity: row.quantity,
    priceSnapshot: row.priceSnapshot.toNumber(),
    priceSnapshotLabel: formatMoney(row.priceSnapshot),
  }));
}

function mapPOSAddOns(
  rows: Array<{
    id?: string;
    productId: string | null;
    nameSnapshot: string;
    priceSnapshot: Prisma.Decimal;
    quantity: number;
  }>
): POSAddOn[] {
  return rows.flatMap((row) => {
    const entries: POSAddOn[] = [];
    const rowId = row.id ?? row.nameSnapshot;
    for (let index = 0; index < row.quantity; index++) {
      entries.push({
        id: row.quantity === 1 ? rowId : `${rowId}-${index + 1}`,
        addOnRowId: rowId,
        productId: row.productId,
        name: row.nameSnapshot,
        price: row.priceSnapshot.toNumber(),
        priceLabel: formatMoney(row.priceSnapshot),
      });
    }
    return entries;
  });
}

function mapPOSPackageLines(input: {
  lines: Array<{
    id: string;
    sortOrder: number;
    sessionTypeId: string;
    selectedPhotoCount: number | null;
    extraDigitalCount: number;
    extraPrintCount: number;
    originalPackagePriceSnapshot: Prisma.Decimal | null;
    finalPackagePriceSnapshot: Prisma.Decimal | null;
    sessionType: { id: string; name: string };
    package: {
      id: string;
      name: string;
      price: Prisma.Decimal;
      photoCount: number;
      bundleAdjustment: Prisma.Decimal;
      items: Parameters<typeof mapPOSPackageItems>[0];
    };
  }>;
  packageOptions: Array<{
    id: string;
    name: string;
    price: Prisma.Decimal;
    packageFamily: { sessionTypeId: string };
  }>;
  pricingRows: Array<{
    sessionTypeId: string;
    mediaType: MediaType;
    unitPrice: Prisma.Decimal;
  }>;
  resolvedConfigurationsByPackageId?: Map<string, ResolvedOrderPackageConfigs>;
}): POSPackageLine[] {
  const priceByKey = new Map(
    input.pricingRows.map((row) => [
      `${row.sessionTypeId}:${row.mediaType}`,
      row.unitPrice,
    ])
  );

  return input.lines.map((line) => {
    const currentPackage = line.package;
    const selectedPhotoCount = line.selectedPhotoCount ?? currentPackage.photoCount;
    const extraPhotoCount = line.extraDigitalCount + line.extraPrintCount;
    const digitalUnitPrice =
      priceByKey.get(`${line.sessionTypeId}:${MediaType.DIGITAL}`) ?? zeroMoney();
    const printUnitPrice =
      priceByKey.get(`${line.sessionTypeId}:${MediaType.PRINT}`) ?? zeroMoney();
    const extraPhotoTotal = digitalUnitPrice
      .mul(line.extraDigitalCount)
      .plus(printUnitPrice.mul(line.extraPrintCount));
    const originalPrice = line.originalPackagePriceSnapshot ?? currentPackage.price;
    const finalPrice = line.finalPackagePriceSnapshot ?? currentPackage.price;
    const upgradeDelta = finalPrice.minus(originalPrice);
    const packageSubtotal = finalPrice.plus(extraPhotoTotal);
    const scopedPackageOptions = input.packageOptions.filter(
      (option) => option.packageFamily.sessionTypeId === line.sessionTypeId
    );
    const resolvedConfigurations =
      input.resolvedConfigurationsByPackageId?.get(line.id) ?? null;
    const sessionConfigurationPricing = priceSelections(
      resolvedConfigurations?.selections ?? []
    );

    return {
      id: line.id,
      sortOrder: line.sortOrder,
      sessionTypeId: line.sessionTypeId,
      sessionTypeName: line.sessionType.name,
      originalPackage: mapPOSPackage({
        ...currentPackage,
        price: originalPrice,
      }),
      currentPackage: mapPOSPackage({
        ...currentPackage,
        price: finalPrice,
      }),
      packageItems: mapPOSPackageItems(currentPackage.items),
      includedPhotoCount: currentPackage.photoCount,
      selectedPhotoCount,
      extraDigitalCount: line.extraDigitalCount,
      extraPrintCount: line.extraPrintCount,
      extraPhotoCount,
      extraDigitalUnitPrice: digitalUnitPrice.toNumber(),
      extraPrintUnitPrice: printUnitPrice.toNumber(),
      extraPhotoTotal: extraPhotoTotal.toNumber(),
      packageSubtotal: packageSubtotal.toNumber(),
      upgradeDelta: upgradeDelta.toNumber(),
      upgradeDeltaLabel: formatSignedMoney(upgradeDelta),
      packageOptions: mapPOSPackageOptions(scopedPackageOptions, {
        id: currentPackage.id,
        price: finalPrice,
      }),
      sessionConfigurationSummary: mapSessionConfigurationSummary(
        resolvedConfigurations?.selections ?? []
      ),
      sessionConfigurationSubtotal:
        sessionConfigurationPricing.totalDelta.toNumber(),
      missingRequiredConfigurationCodes:
        resolvedConfigurations?.missingRequiredConfigurationCodes ?? [],
      availableConfigurations:
        resolvedConfigurations?.activeConfigurations.map((configuration) => ({
          id: configuration.id,
          code: configuration.code,
          name: configuration.name,
          required: configuration.required,
          sortOrder: configuration.sortOrder,
          inputType: configuration.inputType,
          pricingMode: configuration.pricingMode,
          financialBehavior: configuration.financialBehavior,
          fixedPriceDelta: configuration.fixedPriceDelta?.toNumber() ?? null,
          linkedProductId: configuration.linkedProductId,
          linkedProductName: configuration.linkedProductName,
          linkedProductPrice: configuration.linkedProductPrice?.toNumber() ?? null,
          counterUnitPrice: configuration.counterUnitPrice?.toNumber() ?? null,
          options: configuration.options.map((option) => ({
            id: option.id,
            label: option.label,
            priceDelta: option.priceDelta.toNumber(),
          })),
        })) ?? [],
      sessionConfigurationFinancialBehaviorByConfigurationId: Object.fromEntries(
        (resolvedConfigurations?.activeConfigurations ?? []).map((configuration) => [
          configuration.id,
          configuration.financialBehavior,
        ])
      ),
      currentSelections: (resolvedConfigurations?.selections ?? []).map(
        mapCurrentSessionConfigurationSelection
      ),
    };
  });
}

function mapSessionConfigurationSummary(
  selections: ResolvedSelection[]
): POSPackageLine["sessionConfigurationSummary"] {
  return selections.map((selection) => ({
    configurationId: selection.configurationId,
    code: selection.snapshotConfigurationCode,
    label: selection.snapshotLabel,
    optionLabel: selection.snapshotOptionLabel,
    numericValue: selection.numericValue?.toString() ?? null,
    textValue: selection.textValue,
    priceDelta: selection.snapshotPriceDelta.toNumber(),
    financialBehavior: selection.snapshotFinancialBehavior,
    inputType: selection.snapshotInputType,
  }));
}

function mapCurrentSessionConfigurationSelection(
  selection: ResolvedSelection
): POSPackageLine["currentSelections"][number] {
  const base = {
    configurationId: selection.configurationId,
    selectionId: selection.id,
    snapshotLabel: selection.snapshotLabel,
    snapshotPriceDelta: selection.snapshotPriceDelta.toNumber(),
  };

  switch (selection.snapshotInputType) {
    case "TOGGLE":
      return { ...base, kind: "toggle" };
    case "SELECT":
      return {
        ...base,
        kind: "select",
        optionId: selection.optionId ?? "",
      };
    case "NUMBER":
      return {
        ...base,
        kind: "number",
        numericValue: selection.numericValue?.toNumber() ?? 0,
      };
    case "TEXT":
      return {
        ...base,
        kind: "text",
        textValue: selection.textValue ?? "",
      };
    case "COUNTER":
      return {
        ...base,
        kind: "counter",
        numericValue: selection.numericValue?.toNumber() ?? 0,
        ...(selection.optionId ? { optionId: selection.optionId } : {}),
      };
  }
}

function mapPOSPackageOptions(
  packages: Array<{
    id: string;
    name: string;
    price: Prisma.Decimal;
  }>,
  currentPackage: { id: string; price: Prisma.Decimal } | null
): POSPackageOption[] {
  const currentPackagePrice = currentPackage?.price ?? zeroMoney();

  return packages.map((packageRow) => {
    const upgradeDelta = packageRow.price.minus(currentPackagePrice);
    return {
      id: packageRow.id,
      name: packageRow.name,
      price: packageRow.price.toNumber(),
      priceLabel: formatMoney(packageRow.price),
      isCurrentPackage: packageRow.id === currentPackage?.id,
      upgradeDelta: upgradeDelta.toNumber(),
      upgradeDeltaLabel: formatSignedMoney(upgradeDelta),
    };
  });
}

function mapPOSProductOption(option: {
  id: string;
  name: string;
  category: ProductCategory;
  canonicalPrice: Prisma.Decimal;
}): POSProductOption {
  return {
    id: option.id,
    name: option.name,
    category: option.category,
    canonicalPrice: option.canonicalPrice.toNumber(),
    canonicalPriceLabel: formatMoney(option.canonicalPrice),
  };
}

function mapPOSAddOnCatalogItem(option: {
  id: string;
  name: string;
  category: ProductCategory;
  canonicalPrice: Prisma.Decimal;
}): POSAddOnCatalogItem {
  return {
    id: option.id,
    name: option.name,
    category: option.category,
    price: option.canonicalPrice.toNumber(),
    priceLabel: formatMoney(option.canonicalPrice),
  };
}

function mapPOSInvoiceSummary(input: {
  invoice: {
    id: string;
    financialCaseId: string;
    invoiceNumber: string;
    invoiceType: InvoiceType;
    status: InvoiceStatus;
    isLocked: boolean;
    totalAmount: Prisma.Decimal;
    remainingAmount: Prisma.Decimal;
    lineItems: Array<{
      id: string;
      lineType: string;
      description: string;
      quantity: number;
      unitPrice: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
    }>;
  };
  packageBaseTotal: Prisma.Decimal;
  bundleAdjustment: Prisma.Decimal;
  addOnTotal: Prisma.Decimal;
  extraPhotoTotal: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  depositInvoice: {
    invoiceNumber: string;
    paidAmount: Prisma.Decimal;
  } | null;
}): POSInvoiceSummary {
  const hasSnapshotLineItems = input.invoice.lineItems.length > 0;
  const depositPaidAmount = input.depositInvoice?.paidAmount ?? zeroMoney();

  return {
    invoiceId: input.invoice.id,
    financialCaseId: input.invoice.financialCaseId,
    invoiceNumber: input.invoice.invoiceNumber,
    invoiceType: input.invoice.invoiceType as Extract<
      InvoiceType,
      "FINAL" | "ADJUSTMENT"
    >,
    invoiceStatus: mapInvoiceStatus(input.invoice.status),
    isLocked: input.invoice.isLocked,
    renderMode: hasSnapshotLineItems ? "SNAPSHOT" : "COMPUTED",
    packageBaseTotal: input.packageBaseTotal.toNumber(),
    bundleAdjustment: input.bundleAdjustment.toNumber(),
    addOnTotal: input.addOnTotal.toNumber(),
    extraPhotoTotal: input.extraPhotoTotal.toNumber(),
    invoiceTotal: input.invoice.totalAmount.toNumber(),
    paidAmount: input.paidAmount.toNumber(),
    depositInvoiceNumber: input.depositInvoice?.invoiceNumber ?? null,
    depositPaidAmount: depositPaidAmount.toNumber(),
    remainingAmount: input.invoice.remainingAmount.toNumber(),
    lineItems: input.invoice.lineItems.map(mapPOSInvoiceLineItem),
  };
}

function recordPOSCounter(
  metric: string,
  fields: Record<string, string | number | null>
): void {
  console.info(JSON.stringify({ metric, ...fields }));
}

function mapPOSInvoiceLineItem(row: {
  id: string;
  lineType: string;
  description: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
}) {
  return {
    id: row.id,
    lineType: formatEnum(row.lineType),
    description: row.description,
    quantity: row.quantity,
    unitPriceLabel: formatMoney(row.unitPrice),
    lineTotalLabel: formatMoney(row.lineTotal),
  };
}

function sumPOSPackageItemsDecimal(items: POSPackageItem[]): Prisma.Decimal {
  return items.reduce(
    (sum, item) => sum.plus(new Prisma.Decimal(item.priceSnapshot).mul(item.quantity)),
    zeroMoney()
  );
}

function mapPackageItemDisplays(
  rows: Array<{
    id: string;
    productId: string;
    quantity: number;
    priceSnapshot: Prisma.Decimal;
    product: {
      name: string;
      category: ProductCategory;
    };
  }>
): PackageItemDisplay[] {
  return rows.map((row) => ({
    id: row.id,
    productId: row.productId,
    productName: row.product.name,
    productCategory: formatEnum(row.product.category),
    quantity: row.quantity,
    unitPrice: formatMoney(row.priceSnapshot),
    lineTotal: formatMoney(row.priceSnapshot.mul(row.quantity)),
  }));
}

function formatSignedMoney(value: Prisma.Decimal): string {
  return `${value.greaterThan(0) ? "+" : ""}${formatMoney(value)}`;
}

function mapOrderEditingWorkflow(
  order: {
    id: string;
    selectionStatus: OrderSelectionStatus;
    editingJob: {
      assignedEditorId: string | null;
      assignedEditor: { id: string; name: string } | null;
      status: OrderEditingStatus;
      editingAssignedAt: Date | null;
      editingStartedAt: Date | null;
      editingCompletedAt: Date | null;
      customerApprovedAt: Date | null;
      sentToProductionAt: Date | null;
      editedPhotoCount: number;
      revisionCount: number;
      estimatedEditingCompletionAt: Date | null;
    } | null;
    productionJob: ProductionJobState | null;
    booking: {
      financialCase: {
        invoices: Array<{
          invoiceType: InvoiceType;
          remainingAmount: Prisma.Decimal;
        }>;
      } | null;
    };
    packages: Array<{
      selectedPhotoCount: number | null;
      package: { photoCount: number };
    }>;
    invoices: Array<{
      id: string;
      remainingAmount: Prisma.Decimal;
    }>;
  },
  editors: OrderEditorOption[]
): OrderEditingWorkflow {
  const editingJob = order.editingJob;
  const editingStatus = editingJob?.status ?? OrderEditingStatus.NOT_STARTED;
  const assignedEditorId = editingJob?.assignedEditorId ?? null;
  const assignedEditor = editingJob?.assignedEditor ?? null;
  const editingAssignedAt = editingJob?.editingAssignedAt ?? null;
  const editingStartedAt = editingJob?.editingStartedAt ?? null;
  const editingCompletedAt = editingJob?.editingCompletedAt ?? null;
  const customerApprovedAt = editingJob?.customerApprovedAt ?? null;
  const sentToProductionAt = editingJob?.sentToProductionAt ?? null;
  const editedPhotoCount = editingJob?.editedPhotoCount ?? 0;
  const revisionCount = editingJob?.revisionCount ?? 0;
  const estimatedEditingCompletionAt = editingJob?.estimatedEditingCompletionAt ?? null;
  const targetPhotoCount = getOrderTotalSelectedPhotoCount(order.packages);
  const progressPercent =
    targetPhotoCount > 0
      ? Math.min(Math.round((editedPhotoCount / targetPhotoCount) * 100), 100)
      : 0;
  const basePaymentVerified = basePaymentSettled(order);
  const outstandingBalance = order.invoices.reduce(
    (sum, invoice) => sum.plus(invoice.remainingAmount),
    zeroMoney()
  );
  const productionStatus =
    order.productionJob?.status ?? resolveDefaultProductionStatus(editingStatus);

  return {
    orderId: order.id,
    invoiceId: order.invoices[0]?.id ?? null,
    assignedEditorId,
    assignedEditorName: assignedEditor?.name ?? "Unassigned",
    assignedAt: editingAssignedAt ? formatDateTime(editingAssignedAt) : null,
    editingStatus: ORDER_EDITING_STATUS_LABELS[editingStatus],
    productionStatus: ORDER_PRODUCTION_STATUS_LABELS[productionStatus],
    progressPercent,
    editedPhotoCount,
    targetPhotoCount,
    revisionCount,
    revisionState: resolveRevisionState(editingStatus, revisionCount),
    approvalState: resolveApprovalState(editingStatus),
    estimatedCompletionDate: estimatedEditingCompletionAt
      ? formatDate(estimatedEditingCompletionAt)
      : null,
    estimatedCompletionDateInput: estimatedEditingCompletionAt
      ? formatDateInput(estimatedEditingCompletionAt)
      : formatDateInput(addDays(new Date(), 14)),
    startedAt: editingStartedAt ? formatDateTime(editingStartedAt) : null,
    completedAt: editingCompletedAt ? formatDateTime(editingCompletedAt) : null,
    customerApprovedAt: customerApprovedAt
      ? formatDateTime(customerApprovedAt)
      : null,
    sentToProductionAt: sentToProductionAt
      ? formatDateTime(sentToProductionAt)
      : null,
    basePaymentVerified,
    outstandingBalanceAmount: outstandingBalance.gt(0)
      ? outstandingBalance.toNumber()
      : null,
    outstandingBalanceLabel: outstandingBalance.gt(0)
      ? formatMoney(outstandingBalance)
      : null,
    canAssignEditor: editingStatus !== OrderEditingStatus.COMPLETED,
    canMarkStarted:
      basePaymentVerified &&
      outstandingBalance.lte(0) &&
      order.selectionStatus === OrderSelectionStatus.COMPLETED &&
      Boolean(assignedEditorId) &&
      (
        editingStatus === OrderEditingStatus.ASSIGNED ||
        editingStatus === OrderEditingStatus.REVISION_REQUESTED
      ),
    canRequestRevision: editingStatus === OrderEditingStatus.AWAITING_APPROVAL,
    canMarkComplete:
      editingStatus === OrderEditingStatus.IN_PROGRESS ||
      editingStatus === OrderEditingStatus.REVISION_REQUESTED,
    canMarkApproved: editingStatus === OrderEditingStatus.AWAITING_APPROVAL,
    canSendToProduction: editingStatus === OrderEditingStatus.APPROVED,
    editorOptions: editors,
  };
}

function resolveRevisionState(
  status: OrderEditingStatus,
  revisionCount: number
): string {
  if (status === OrderEditingStatus.REVISION_REQUESTED) {
    return `Revision ${revisionCount} requested`;
  }
  if (revisionCount === 0) {
    return "No revisions";
  }
  return `${revisionCount} revision${revisionCount === 1 ? "" : "s"} recorded`;
}

function resolveApprovalState(status: OrderEditingStatus): string {
  if (
    status === OrderEditingStatus.APPROVED ||
    status === OrderEditingStatus.COMPLETED
  ) {
    return "Customer approved";
  }
  if (status === OrderEditingStatus.AWAITING_APPROVAL) {
    return "Awaiting customer approval";
  }
  if (status === OrderEditingStatus.REVISION_REQUESTED) {
    return "Revision requested";
  }
  return "Not ready for approval";
}

const productionJobSelect = {
  status: true,
  albumDesignStatus: true,
  printingStatus: true,
  assemblyStatus: true,
  vendorStatus: true,
  framedPrintsStatus: true,
  finalStatus: true,
  productionStartedAt: true,
  readyForPickupAt: true,
  completedAt: true,
} satisfies Prisma.ProductionJobSelect;

type ProductionJobState = Prisma.ProductionJobGetPayload<{
  select: typeof productionJobSelect;
}>;

type ProductionJobData = Omit<
  Prisma.ProductionJobUncheckedCreateInput,
  "jobId" | "orderId"
>;

type ProductionOrderState = {
  id: string;
  status: OrderStatus;
  jobId: string;
  editingJob: {
    status: OrderEditingStatus;
  } | null;
  deliveryStatus: OrderDeliveryStatus;
  productionJob: ProductionJobState | null;
};

type ProductionWorkflowUpdate = {
  orderData: {
    order: Prisma.OrderUpdateInput;
    productionJob: ProductionJobData;
  };
  productionStatus?: OrderProductionStatus;
  deliveryStatus?: OrderDeliveryStatus;
  title: string;
  description: string;
  metadata: Prisma.InputJsonObject;
};

const deliveryOrderSelect = {
  id: true,
  jobId: true,
  status: true,
  deliveryStatus: true,
  productionJob: {
    select: productionJobSelect,
  },
  deliveryPreparedAt: true,
  customerNotifiedAt: true,
  pickedUpAt: true,
  deliveryCompletedAt: true,
  deliveryCompletedById: true,
  deliveryCompletedByUser: { select: { id: true, name: true } },
  deliveryCompletedBy: true,
  deliveryPickupNotes: true,
  deliveryOverrideReason: true,
  invoices: {
    where: FINAL_PARENT_INVOICE_WHERE,
    select: {
      ...invoiceLockSnapshotSelect,
      id: true,
      financialCaseId: true,
      orderId: true,
      bookingId: true,
      invoiceType: true,
      parentInvoiceId: true,
      isLocked: true,
      totalAmount: true,
      paidAmount: true,
      remainingAmount: true,
      status: true,
      closedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  },
} satisfies Prisma.OrderSelect;

type DeliveryOrderState = Prisma.OrderGetPayload<{
  select: typeof deliveryOrderSelect;
}>;

type DeliveryWorkflowUpdate = {
  orderData: {
    order: Prisma.OrderUpdateInput;
    productionJob: ProductionJobData;
  };
  productionStatus?: OrderProductionStatus;
  deliveryStatus?: OrderDeliveryStatus;
  title: string;
  description: string;
  metadata: Prisma.InputJsonObject;
  completed?: boolean;
  completedById?: string;
  paymentOverrideUsed?: boolean;
};

function mapOrderProductionWorkflow(order: ProductionOrderState): OrderProductionWorkflow {
  const canUpdateProduction =
    order.status !== OrderStatus.CANCELLED && order.status !== OrderStatus.DELIVERED;
  const productionStatus = getProductionStatus(order);
  const readyAt = order.productionJob?.readyForPickupAt ?? null;
  const sections = buildProductionSections(order, canUpdateProduction);

  return {
    orderId: order.id,
    productionStatus: ORDER_PRODUCTION_STATUS_LABELS[productionStatus],
    deliveryStatus: ORDER_DELIVERY_STATUS_LABELS[order.deliveryStatus],
    editingStatus: ORDER_EDITING_STATUS_LABELS[order.editingJob?.status ?? OrderEditingStatus.NOT_STARTED],
    readyAt: readyAt ? formatDateTime(readyAt) : null,
    readinessWarning: resolveProductionReadinessWarning(order),
    canUpdateProduction,
    canMarkReadyForPickup:
      canUpdateProduction &&
      productionStatus !== OrderProductionStatus.READY_FOR_PICKUP &&
      productionStatus !== OrderProductionStatus.COMPLETED &&
      (order.editingJob?.status === OrderEditingStatus.APPROVED ||
        order.editingJob?.status === OrderEditingStatus.COMPLETED),
    sections,
  };
}

function buildProductionSections(
  order: ProductionOrderState,
  canUpdateProduction: boolean
): OrderProductionSection[] {
  return [
    productionSection({
      key: "albumDesign",
      title: "Album Design",
      description: "Layout and customer album design preparation.",
      status: getProductionSectionStatus(order.productionJob, "albumDesignStatus"),
      startAction: "markAlbumDesignStarted",
      completeAction: "markAlbumDesignCompleted",
      canUpdateProduction,
    }),
    productionSection({
      key: "printing",
      title: "Printing",
      description: "Album pages and print items sent to production.",
      status: getProductionSectionStatus(order.productionJob, "printingStatus"),
      startAction: "markSentToPrint",
      completeAction: "markPrintsReady",
      startLabel: "Send to print",
      completeLabel: "Prints ready",
      canUpdateProduction,
    }),
    productionSection({
      key: "assembly",
      title: "Album Assembly",
      description: "Final album build, binding, and finishing.",
      status: getProductionSectionStatus(order.productionJob, "assemblyStatus"),
      startAction: "markAssemblyStarted",
      completeAction: "markAssemblyCompleted",
      canUpdateProduction:
        canUpdateProduction &&
        getProductionSectionStatus(order.productionJob, "albumDesignStatus") ===
          OrderProductionSectionStatus.COMPLETED,
    }),
    productionSection({
      key: "vendor",
      title: "Vendor / Outsource",
      description: "Outsourced production work and vendor handoff.",
      status: getProductionSectionStatus(order.productionJob, "vendorStatus"),
      startAction: "markVendorInProgress",
      completeAction: "markVendorCompleted",
      startLabel: "Vendor in progress",
      completeLabel: "Vendor complete",
      canUpdateProduction,
    }),
    productionSection({
      key: "framedPrints",
      title: "Framed Prints",
      description: "Frames, enlargements, and standalone print deliverables.",
      status: getProductionSectionStatus(order.productionJob, "framedPrintsStatus"),
      startAction: null,
      completeAction: "markPrintsReady",
      completeLabel: "Prints ready",
      canUpdateProduction,
    }),
    {
      key: "finalReadiness",
      title: "Final Production Readiness",
      description: "Final production check before pickup handoff.",
      status: ORDER_PRODUCTION_SECTION_STATUS_LABELS[
        getProductionSectionStatus(order.productionJob, "finalStatus")
      ],
      action:
        canUpdateProduction &&
        getProductionStatus(order) !== OrderProductionStatus.READY_FOR_PICKUP &&
        getProductionStatus(order) !== OrderProductionStatus.COMPLETED
          ? "markProductionReadyForPickup"
          : null,
      actionLabel:
        canUpdateProduction &&
        getProductionStatus(order) !== OrderProductionStatus.READY_FOR_PICKUP &&
        getProductionStatus(order) !== OrderProductionStatus.COMPLETED
          ? "Ready for pickup"
          : null,
    },
  ];
}

function productionSection(input: {
  key: OrderProductionSection["key"];
  title: string;
  description: string;
  status: OrderProductionSectionStatus;
  startAction: OrderProductionAction | null;
  completeAction: OrderProductionAction;
  startLabel?: string;
  completeLabel?: string;
  canUpdateProduction: boolean;
}): OrderProductionSection {
  const action =
    input.canUpdateProduction && input.status === OrderProductionSectionStatus.NOT_STARTED
      ? input.startAction
      : input.canUpdateProduction && input.status === OrderProductionSectionStatus.IN_PROGRESS
        ? input.completeAction
        : null;
  const actionLabel =
    input.status === OrderProductionSectionStatus.NOT_STARTED
      ? input.startLabel ?? "Start"
      : input.status === OrderProductionSectionStatus.IN_PROGRESS
        ? input.completeLabel ?? "Complete"
        : null;

  return {
    key: input.key,
    title: input.title,
    description: input.description,
    status: ORDER_PRODUCTION_SECTION_STATUS_LABELS[input.status],
    action,
    actionLabel: action ? actionLabel : null,
  };
}

function resolveProductionReadinessWarning(order: ProductionOrderState): string | null {
  const editingStatus = order.editingJob?.status ?? OrderEditingStatus.NOT_STARTED;
  if (
    editingStatus !== OrderEditingStatus.APPROVED &&
    editingStatus !== OrderEditingStatus.COMPLETED
  ) {
    return "Editing must be approved or completed before production can be marked ready for pickup.";
  }

  if (
    getProductionSectionStatus(order.productionJob, "assemblyStatus") !==
      OrderProductionSectionStatus.NOT_STARTED &&
    getProductionSectionStatus(order.productionJob, "albumDesignStatus") !==
      OrderProductionSectionStatus.COMPLETED
  ) {
    return "Album assembly is in progress but album design is not yet completed. Complete album design first.";
  }

  const productionStatus = getProductionStatus(order);
  if (
    productionStatus === OrderProductionStatus.READY_FOR_PICKUP &&
    hasIncompleteProductionSections(order)
  ) {
    return "Production is marked ready while one or more section checks are still open.";
  }

  return null;
}

function hasIncompleteProductionSections(order: ProductionOrderState): boolean {
  return [
    getProductionSectionStatus(order.productionJob, "albumDesignStatus"),
    getProductionSectionStatus(order.productionJob, "printingStatus"),
    getProductionSectionStatus(order.productionJob, "assemblyStatus"),
    getProductionSectionStatus(order.productionJob, "vendorStatus"),
    getProductionSectionStatus(order.productionJob, "framedPrintsStatus"),
  ].some((status) => status !== OrderProductionSectionStatus.COMPLETED);
}

function assertProductionWorkflowWritable(status: OrderStatus): void {
  if (status === OrderStatus.CANCELLED) {
    throw new Error("Cancelled orders cannot be moved through production");
  }
  if (status === OrderStatus.DELIVERED) {
    throw new Error("Delivered orders cannot be moved through production");
  }
}

function resolveAdvancedSelectionStatus(
  current: OrderSelectionStatus,
  next: OrderSelectionStatus
): OrderSelectionStatus | null {
  const rank: Record<OrderSelectionStatus, number> = {
    [OrderSelectionStatus.PENDING]: 0,
    [OrderSelectionStatus.IN_PROGRESS]: 1,
    [OrderSelectionStatus.COMPLETED]: 2,
  };

  return rank[next] >= rank[current] ? next : null;
}

function resolveProductionUpdate(
  order: ProductionOrderState,
  action: UpdateOrderProductionWorkflowInput["action"]
): ProductionWorkflowUpdate {
  const now = new Date();
  const productionStatus = getProductionStatus(order);
  const inProgressStatus =
    productionStatus === OrderProductionStatus.READY_FOR_PICKUP ||
    productionStatus === OrderProductionStatus.COMPLETED
      ? productionStatus
      : OrderProductionStatus.IN_PROGRESS;

  switch (action) {
    case "markAlbumDesignStarted":
      return productionSectionUpdate(order, {
        field: "albumDesignStatus",
        previousStatus: getProductionSectionStatus(order.productionJob, "albumDesignStatus"),
        nextStatus: OrderProductionSectionStatus.IN_PROGRESS,
        productionStatus: inProgressStatus,
        title: "Album design started",
        description: "Album design was marked in progress.",
      });
    case "markAlbumDesignCompleted":
      return productionSectionUpdate(order, {
        field: "albumDesignStatus",
        previousStatus: getProductionSectionStatus(order.productionJob, "albumDesignStatus"),
        nextStatus: OrderProductionSectionStatus.COMPLETED,
        productionStatus: inProgressStatus,
        title: "Album design completed",
        description: "Album design was marked completed.",
      });
    case "markSentToPrint":
      return productionSectionUpdate(order, {
        field: "printingStatus",
        previousStatus: getProductionSectionStatus(order.productionJob, "printingStatus"),
        nextStatus: OrderProductionSectionStatus.IN_PROGRESS,
        productionStatus: inProgressStatus,
        title: "Sent to print",
        description: "Production was marked sent to print.",
      });
    case "markAssemblyStarted": {
      if (
        getProductionSectionStatus(order.productionJob, "albumDesignStatus") !==
        OrderProductionSectionStatus.COMPLETED
      ) {
        throw new Error(
          "Album assembly cannot be started until album design is completed"
        );
      }
      return productionSectionUpdate(order, {
        field: "assemblyStatus",
        previousStatus: getProductionSectionStatus(order.productionJob, "assemblyStatus"),
        nextStatus: OrderProductionSectionStatus.IN_PROGRESS,
        productionStatus: inProgressStatus,
        title: "Album assembly started",
        description: "Album assembly was marked in progress.",
      });
    }
    case "markAssemblyCompleted": {
      if (
        getProductionSectionStatus(order.productionJob, "albumDesignStatus") !==
        OrderProductionSectionStatus.COMPLETED
      ) {
        throw new Error(
          "Album assembly cannot be completed until album design is completed"
        );
      }
      return productionSectionUpdate(order, {
        field: "assemblyStatus",
        previousStatus: getProductionSectionStatus(order.productionJob, "assemblyStatus"),
        nextStatus: OrderProductionSectionStatus.COMPLETED,
        productionStatus: inProgressStatus,
        title: "Album assembly completed",
        description: "Album assembly was marked completed.",
      });
    }
    case "markVendorInProgress":
      return productionSectionUpdate(order, {
        field: "vendorStatus",
        previousStatus: getProductionSectionStatus(order.productionJob, "vendorStatus"),
        nextStatus: OrderProductionSectionStatus.IN_PROGRESS,
        productionStatus: OrderProductionStatus.WAITING_FOR_VENDOR,
        title: "Vendor work in progress",
        description: "Outsourced production work was marked in progress.",
      });
    case "markVendorCompleted":
      return productionSectionUpdate(order, {
        field: "vendorStatus",
        previousStatus: getProductionSectionStatus(order.productionJob, "vendorStatus"),
        nextStatus: OrderProductionSectionStatus.COMPLETED,
        productionStatus: inProgressStatus,
        title: "Vendor work completed",
        description: "Outsourced production work was marked completed.",
      });
    case "markPrintsReady":
      return {
        orderData: {
          order: {
            status: order.status === OrderStatus.READY ? OrderStatus.READY : OrderStatus.PRODUCTION,
          },
          productionJob: {
            status: inProgressStatus,
            printingStatus: OrderProductionSectionStatus.COMPLETED,
            framedPrintsStatus: OrderProductionSectionStatus.COMPLETED,
            productionStartedAt: order.productionJob?.productionStartedAt ?? now,
            readyForPickupAt: order.productionJob?.readyForPickupAt ?? null,
            completedAt: order.productionJob?.completedAt ?? null,
            albumDesignStatus: getProductionSectionStatus(order.productionJob, "albumDesignStatus"),
            assemblyStatus: getProductionSectionStatus(order.productionJob, "assemblyStatus"),
            vendorStatus: getProductionSectionStatus(order.productionJob, "vendorStatus"),
            finalStatus: getProductionSectionStatus(order.productionJob, "finalStatus"),
            updatedAt: now,
          },
        },
        productionStatus: inProgressStatus,
        title: "Prints ready",
        description: "Printing and framed prints were marked ready.",
        metadata: {
          fields: ["printingStatus", "framedPrintsStatus"],
          previousPrintingStatus: getProductionSectionStatus(order.productionJob, "printingStatus"),
          nextPrintingStatus: OrderProductionSectionStatus.COMPLETED,
          previousFramedPrintsStatus: getProductionSectionStatus(order.productionJob, "framedPrintsStatus"),
          nextFramedPrintsStatus: OrderProductionSectionStatus.COMPLETED,
          previousProductionStatus: productionStatus,
          nextProductionStatus: inProgressStatus,
        },
      };
    case "markProductionReadyForPickup": {
      const editingStatus = order.editingJob?.status ?? OrderEditingStatus.NOT_STARTED;
      if (
        editingStatus !== OrderEditingStatus.APPROVED &&
        editingStatus !== OrderEditingStatus.COMPLETED
      ) {
        throw new WorkflowGuardError(
          "EDITING_INCOMPLETE",
          "Production cannot be marked ready for pickup until editing is approved or completed"
        );
      }
      if (
        getProductionSectionStatus(order.productionJob, "assemblyStatus") !==
          OrderProductionSectionStatus.NOT_STARTED &&
        getProductionSectionStatus(order.productionJob, "albumDesignStatus") !==
          OrderProductionSectionStatus.COMPLETED
      ) {
        throw new WorkflowGuardError(
          "ALBUM_DESIGN_INCOMPLETE",
          "Album design must be completed before assembly can contribute to production readiness"
        );
      }
      return {
        orderData: {
          order: {
            deliveryStatus: OrderDeliveryStatus.READY_FOR_PICKUP,
            status: OrderStatus.READY,
          },
          productionJob: {
            status: OrderProductionStatus.READY_FOR_PICKUP,
            finalStatus: OrderProductionSectionStatus.COMPLETED,
            productionStartedAt: order.productionJob?.productionStartedAt ?? now,
            readyForPickupAt: order.productionJob?.readyForPickupAt ?? now,
            completedAt: order.productionJob?.completedAt ?? null,
            albumDesignStatus: getProductionSectionStatus(order.productionJob, "albumDesignStatus"),
            printingStatus: getProductionSectionStatus(order.productionJob, "printingStatus"),
            assemblyStatus: getProductionSectionStatus(order.productionJob, "assemblyStatus"),
            vendorStatus: getProductionSectionStatus(order.productionJob, "vendorStatus"),
            framedPrintsStatus: getProductionSectionStatus(order.productionJob, "framedPrintsStatus"),
            updatedAt: now,
          },
        },
        productionStatus: OrderProductionStatus.READY_FOR_PICKUP,
        deliveryStatus: OrderDeliveryStatus.READY_FOR_PICKUP,
        title: "Production ready for pickup",
        description: "Production was marked ready for customer pickup.",
        metadata: {
          field: "productionStatus",
          previousStatus: productionStatus,
          nextStatus: OrderProductionStatus.READY_FOR_PICKUP,
          previousDeliveryStatus: order.deliveryStatus,
          nextDeliveryStatus: OrderDeliveryStatus.READY_FOR_PICKUP,
          incompleteSectionsAtReady: hasIncompleteProductionSections(order),
        },
      };
    }
  }
}

function productionSectionUpdate(
  order: ProductionOrderState,
  input: {
    field:
      | "albumDesignStatus"
      | "printingStatus"
      | "assemblyStatus"
      | "vendorStatus"
      | "framedPrintsStatus";
    previousStatus: OrderProductionSectionStatus;
    nextStatus: OrderProductionSectionStatus;
    productionStatus: OrderProductionStatus;
    title: string;
    description: string;
  }
): ProductionWorkflowUpdate {
  const now = new Date();
  return {
    orderData: {
      order: {
        status: order.status === OrderStatus.READY ? OrderStatus.READY : OrderStatus.PRODUCTION,
      },
      productionJob: {
        status: input.productionStatus,
        albumDesignStatus:
          input.field === "albumDesignStatus"
            ? input.nextStatus
            : getProductionSectionStatus(order.productionJob, "albumDesignStatus"),
        printingStatus:
          input.field === "printingStatus"
            ? input.nextStatus
            : getProductionSectionStatus(order.productionJob, "printingStatus"),
        assemblyStatus:
          input.field === "assemblyStatus"
            ? input.nextStatus
            : getProductionSectionStatus(order.productionJob, "assemblyStatus"),
        vendorStatus:
          input.field === "vendorStatus"
            ? input.nextStatus
            : getProductionSectionStatus(order.productionJob, "vendorStatus"),
        framedPrintsStatus:
          input.field === "framedPrintsStatus"
            ? input.nextStatus
            : getProductionSectionStatus(order.productionJob, "framedPrintsStatus"),
        finalStatus: getProductionSectionStatus(order.productionJob, "finalStatus"),
        productionStartedAt: order.productionJob?.productionStartedAt ?? now,
        readyForPickupAt: order.productionJob?.readyForPickupAt ?? null,
        completedAt: order.productionJob?.completedAt ?? null,
        updatedAt: now,
      },
    },
    productionStatus: input.productionStatus,
    title: input.title,
    description: input.description,
    metadata: {
      field: input.field,
      previousStatus: input.previousStatus,
      nextStatus: input.nextStatus,
      previousProductionStatus: getProductionStatus(order),
      nextProductionStatus: input.productionStatus,
      earlyProduction:
        (order.editingJob?.status ?? OrderEditingStatus.NOT_STARTED) !== OrderEditingStatus.COMPLETED &&
        (order.editingJob?.status ?? OrderEditingStatus.NOT_STARTED) !== OrderEditingStatus.APPROVED,
    },
  };
}

function mapOrderDeliveryWorkflow(order: DeliveryOrderState): OrderDeliveryWorkflow {
  const invoiceSummary = summarizeInvoices(order.invoices);
  const paymentSettled =
    invoiceSummary.paymentStatus === "Paid" || invoiceSummary.paymentStatus === "Overridden";
  const completionBlockers = resolveDeliveryCompletionBlockers(order, paymentSettled);
  const productionStatus = getProductionStatus(order);
  const readyAt = order.productionJob?.readyForPickupAt ?? null;

  return {
    orderId: order.id,
    deliveryStatus: ORDER_DELIVERY_STATUS_LABELS[order.deliveryStatus],
    productionStatus: ORDER_PRODUCTION_STATUS_LABELS[productionStatus],
    paymentStatus: invoiceSummary.paymentStatus,
    readyAt: readyAt ? formatDateTime(readyAt) : null,
    preparedAt: order.deliveryPreparedAt ? formatDateTime(order.deliveryPreparedAt) : null,
    customerNotifiedAt: order.customerNotifiedAt
      ? formatDateTime(order.customerNotifiedAt)
      : null,
    pickedUpAt: order.pickedUpAt ? formatDateTime(order.pickedUpAt) : null,
    completedAt: order.deliveryCompletedAt ? formatDateTime(order.deliveryCompletedAt) : null,
    completedById: order.deliveryCompletedById ?? null,
    completedBy: order.deliveryCompletedByUser?.name ?? order.deliveryCompletedBy ?? "",
    pickupNotes: order.deliveryPickupNotes ?? "",
    overrideReason: order.deliveryOverrideReason ?? "",
    completionBlockers,
    requiresPaymentOverride: !paymentSettled,
    canRecordNotification:
      order.status !== OrderStatus.CANCELLED &&
      order.status !== OrderStatus.DELIVERED &&
      order.deliveryStatus === OrderDeliveryStatus.READY_FOR_PICKUP,
    canMarkPickedUp:
      order.status !== OrderStatus.CANCELLED &&
      order.status !== OrderStatus.DELIVERED &&
      (
        order.deliveryStatus === OrderDeliveryStatus.READY_FOR_PICKUP ||
        order.deliveryStatus === OrderDeliveryStatus.CUSTOMER_NOTIFIED ||
        order.deliveryStatus === OrderDeliveryStatus.PICKED_UP
     ),
  };
}

function getProductionSectionStatus(
  productionJob: ProductionJobState | null,
  field:
    | "albumDesignStatus"
    | "printingStatus"
    | "assemblyStatus"
    | "vendorStatus"
    | "framedPrintsStatus"
    | "finalStatus"
): OrderProductionSectionStatus {
  return productionJob?.[field] ?? OrderProductionSectionStatus.NOT_STARTED;
}

function resolveDefaultProductionStatus(
  editingStatus: OrderEditingStatus
): OrderProductionStatus {
  return editingStatus === OrderEditingStatus.COMPLETED
    ? OrderProductionStatus.NOT_STARTED
    : OrderProductionStatus.WAITING_FOR_EDITING;
}

function getProductionStatus(input: {
  editingJob?: { status: OrderEditingStatus } | null;
  productionJob?: ProductionJobState | null;
  deliveryStatus?: OrderDeliveryStatus;
  status?: OrderStatus;
}): OrderProductionStatus {
  if (input.deliveryStatus === OrderDeliveryStatus.COMPLETED || input.status === OrderStatus.DELIVERED) {
    return OrderProductionStatus.COMPLETED;
  }
  if (input.productionJob) {
    return input.productionJob.status;
  }
  return resolveDefaultProductionStatus(
    input.editingJob?.status ?? OrderEditingStatus.NOT_STARTED
  );
}

function buildProductionJobStatusUpdate(
  status: OrderProductionStatus
): ProductionJobData {
  const now = new Date();
  return {
    status,
    albumDesignStatus: OrderProductionSectionStatus.NOT_STARTED,
    printingStatus: OrderProductionSectionStatus.NOT_STARTED,
    assemblyStatus: OrderProductionSectionStatus.NOT_STARTED,
    vendorStatus: OrderProductionSectionStatus.NOT_STARTED,
    framedPrintsStatus: OrderProductionSectionStatus.NOT_STARTED,
    finalStatus:
      status === OrderProductionStatus.READY_FOR_PICKUP ||
      status === OrderProductionStatus.COMPLETED
        ? OrderProductionSectionStatus.COMPLETED
        : OrderProductionSectionStatus.NOT_STARTED,
    productionStartedAt:
      status === OrderProductionStatus.NOT_STARTED ||
      status === OrderProductionStatus.WAITING_FOR_EDITING
        ? null
        : now,
    readyForPickupAt:
      status === OrderProductionStatus.READY_FOR_PICKUP ||
      status === OrderProductionStatus.COMPLETED
        ? now
        : null,
    completedAt: status === OrderProductionStatus.COMPLETED ? now : null,
    updatedAt: now,
  };
}

function assertDeliveryWorkflowWritable(status: OrderStatus): void {
  if (status === OrderStatus.CANCELLED) {
    throw new Error("Cancelled orders cannot be moved through delivery");
  }
  if (status === OrderStatus.DELIVERED) {
    throw new Error("Delivered orders cannot be moved through delivery");
  }
}

function resolveDeliveryUpdate(
  order: DeliveryOrderState,
  input: UpdateOrderDeliveryWorkflowInput,
  actorContext: ActorContext
): DeliveryWorkflowUpdate {
  const now = new Date();
  const pickupNotes = input.pickupNotes?.trim() || null;
  const productionStatus = getProductionStatus(order);

  switch (input.action) {
    case "recordCustomerNotification": {
      if (order.deliveryStatus !== OrderDeliveryStatus.READY_FOR_PICKUP) {
        throw new Error("Customer notification can only be recorded after pickup readiness");
      }
      return {
        orderData: {
          order: {
            deliveryStatus: OrderDeliveryStatus.CUSTOMER_NOTIFIED,
            customerNotifiedAt: order.customerNotifiedAt ?? now,
          },
          productionJob: {
            status: productionStatus,
            albumDesignStatus: getProductionSectionStatus(order.productionJob, "albumDesignStatus"),
            printingStatus: getProductionSectionStatus(order.productionJob, "printingStatus"),
            assemblyStatus: getProductionSectionStatus(order.productionJob, "assemblyStatus"),
            vendorStatus: getProductionSectionStatus(order.productionJob, "vendorStatus"),
            framedPrintsStatus: getProductionSectionStatus(order.productionJob, "framedPrintsStatus"),
            finalStatus: getProductionSectionStatus(order.productionJob, "finalStatus"),
            productionStartedAt: order.productionJob?.productionStartedAt ?? now,
            readyForPickupAt: order.productionJob?.readyForPickupAt ?? now,
            completedAt: order.productionJob?.completedAt ?? null,
            updatedAt: now,
          },
        },
        deliveryStatus: OrderDeliveryStatus.CUSTOMER_NOTIFIED,
        title: "Customer notification recorded",
        description: "Customer pickup notification was recorded.",
        metadata: {
          field: "deliveryStatus",
          previousStatus: order.deliveryStatus,
          nextStatus: OrderDeliveryStatus.CUSTOMER_NOTIFIED,
          customerNotifiedAt: (order.customerNotifiedAt ?? now).toISOString(),
        },
      };
    }

    case "markPickedUp": {
      if (
        order.deliveryStatus !== OrderDeliveryStatus.READY_FOR_PICKUP &&
        order.deliveryStatus !== OrderDeliveryStatus.CUSTOMER_NOTIFIED &&
        order.deliveryStatus !== OrderDeliveryStatus.PICKED_UP
      ) {
        throw new Error("Pickup can only be recorded after delivery is ready");
      }
      assertProductionReadyForDelivery(order);

      const invoiceSummary = summarizeInvoices(order.invoices);
      const paymentSettled =
        invoiceSummary.paymentStatus === "Paid" || invoiceSummary.paymentStatus === "Overridden";
      const completedById = actorContext.actorUserId;
      if (!completedById) {
        throw new WorkflowGuardError(
          "ACTOR_MISSING",
          "A linked authenticated staff user is required to complete delivery"
        );
      }

      const overrideReason = input.overrideReason?.trim();
      const paymentOverrideUsed = !paymentSettled;
      if (paymentOverrideUsed && !input.allowPaymentOverride) {
        throw new WorkflowGuardError(
          "PAYMENT_OVERRIDE_NOT_ALLOWED",
          "Payment must be settled or explicitly overridden by an authorized manager or admin"
        );
      }
      if (paymentOverrideUsed && !overrideReason) {
        throw new WorkflowGuardError(
          "PAYMENT_OVERRIDE_REASON_MISSING",
          "Override reason is required when payment is not settled"
        );
      }

      return {
        orderData: {
          order: {
            deliveryStatus: OrderDeliveryStatus.COMPLETED,
            pickedUpAt: order.pickedUpAt ?? now,
            deliveryCompletedAt: order.deliveryCompletedAt ?? now,
            deliveryCompletedByUser: { connect: { id: completedById } },
            deliveryPickupNotes: pickupNotes ?? order.deliveryPickupNotes,
            deliveryOverrideReason: paymentOverrideUsed ? overrideReason : null,
            status: OrderStatus.DELIVERED,
          },
          productionJob: {
            status: OrderProductionStatus.COMPLETED,
            albumDesignStatus: getProductionSectionStatus(order.productionJob, "albumDesignStatus"),
            printingStatus: getProductionSectionStatus(order.productionJob, "printingStatus"),
            assemblyStatus: getProductionSectionStatus(order.productionJob, "assemblyStatus"),
            vendorStatus: getProductionSectionStatus(order.productionJob, "vendorStatus"),
            framedPrintsStatus: getProductionSectionStatus(order.productionJob, "framedPrintsStatus"),
            finalStatus: getProductionSectionStatus(order.productionJob, "finalStatus"),
            productionStartedAt: order.productionJob?.productionStartedAt ?? now,
            readyForPickupAt: order.productionJob?.readyForPickupAt ?? now,
            completedAt: order.productionJob?.completedAt ?? now,
            updatedAt: now,
          },
        },
        deliveryStatus: OrderDeliveryStatus.COMPLETED,
        productionStatus: OrderProductionStatus.COMPLETED,
        title: "Order picked up",
        description: "Customer pickup was recorded and the order was completed.",
        metadata: {
          field: "deliveryStatus",
          previousStatus: order.deliveryStatus,
          nextStatus: OrderDeliveryStatus.COMPLETED,
          previousProductionStatus: productionStatus,
          nextProductionStatus: OrderProductionStatus.COMPLETED,
          pickedUpAt: (order.pickedUpAt ?? now).toISOString(),
          completedById,
          completedAt: (order.deliveryCompletedAt ?? now).toISOString(),
          paymentStatus: invoiceSummary.paymentStatus,
          paymentOverrideUsed,
          overrideReason: paymentOverrideUsed ? overrideReason ?? null : null,
          pickupNotesUpdated: Boolean(pickupNotes),
        },
        completed: true,
        completedById,
        paymentOverrideUsed,
      };
    }
  }
}

const PAYMENT_OVERRIDE_BLOCKER = "Payment needs manager/admin override before pickup completion." as const;

function resolveDeliveryCompletionBlockers(
  order: DeliveryOrderState,
  paymentSettled: boolean
): string[] {
  const blockers: string[] = [];
  if (!paymentSettled) {
    blockers.push(PAYMENT_OVERRIDE_BLOCKER);
  }
  if (!isProductionReadyForDelivery(order)) {
    blockers.push("Production must be ready for pickup or completed.");
  }
  return blockers;
}

function assertProductionReadyForDelivery(order: DeliveryOrderState): void {
  if (!isProductionReadyForDelivery(order)) {
    throw new Error("Order cannot be completed until production is ready for pickup or completed");
  }
}

function isProductionReadyForDelivery(order: DeliveryOrderState): boolean {
  const productionStatus = getProductionStatus(order);
  return (
    productionStatus === OrderProductionStatus.READY_FOR_PICKUP ||
    productionStatus === OrderProductionStatus.COMPLETED
  );
}

export function basePaymentSettled(order: {
  booking: {
    financialCase: {
      invoices: Array<{
        invoiceType: InvoiceType;
        remainingAmount: Prisma.Decimal;
      }>;
    } | null;
  };
}): boolean {
  const depositInvoice = order.booking.financialCase?.invoices.find(
    (invoice) => invoice.invoiceType === InvoiceType.DEPOSIT
  );
  if (!depositInvoice) {
    return true;
  }
  return depositInvoice.remainingAmount.lessThanOrEqualTo(0);
}

function assertEditingReadyToStart(
  order: {
    selectionStatus: OrderSelectionStatus;
    assignedEditorId: string | null;
  },
  basePaymentVerified: boolean,
  outstandingBalance: Prisma.Decimal
): void {
  if (order.selectionStatus !== OrderSelectionStatus.COMPLETED) {
    throw new Error("Editing cannot start until selection is completed");
  }
  if (!basePaymentVerified) {
    throw new Error("Editing cannot start until base package payment is recorded");
  }
  if (outstandingBalance.gt(0)) {
    throw new Error("Editing cannot start until the outstanding invoice balance is paid");
  }
  if (!order.assignedEditorId) {
    throw new Error("Assign an editor before starting editing");
  }
}

async function recordEditingStatusActivity(
  client: OrderWriteClient,
  orderId: string,
  input: {
    previousStatus: OrderEditingStatus;
    nextStatus: OrderEditingStatus;
    title: string;
    metadata?: Prisma.InputJsonObject;
  },
  actorContext: ActorContext
): Promise<void> {
  await recordOrderActivity(client, {
    orderId,
    userId: actorContext.actorUserId ?? null,
    type: OrderActivityType.EDITING_STATUS_CHANGED,
    title: input.title,
    metadata: {
      field: "editingStatus",
      previousStatus: input.previousStatus,
      nextStatus: input.nextStatus,
      ...input.metadata,
    },
  });
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
  next: UpdateOrderWorkflowInput,
  actorContext: ActorContext
): Promise<void> {
  if (next.selectionStatus && next.selectionStatus !== previous.selectionStatus) {
    await recordOrderActivity(client, {
      orderId,
      userId: actorContext.actorUserId ?? null,
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
      userId: actorContext.actorUserId ?? null,
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
      userId: actorContext.actorUserId ?? null,
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
      userId: actorContext.actorUserId ?? null,
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
        userId: actorContext.actorUserId ?? null,
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

async function fetchEditingQueue() {
  return db.order.findMany({
    where: { status: { in: [OrderStatus.SELECTION_COMPLETED, OrderStatus.EDITING] } },
    include: {
      customer: { select: { name: true } },
      booking: { select: { sessionDate: true } },
      editingJob: {
        select: {
          status: true,
          assignedEditor: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

type EditingQueueRow = Awaited<ReturnType<typeof fetchEditingQueue>>[number];

function mapEditingQueueRow(row: EditingQueueRow): EditingQueueItem {
  return {
    id: row.id,
    jobNumber: row.jobNumber,
    customerName: row.customer.name,
    sessionDate: formatDate(row.booking.sessionDate),
    editingStatus: row.editingJob
      ? ORDER_EDITING_STATUS_LABELS[row.editingJob.status]
      : ORDER_EDITING_STATUS_LABELS[OrderEditingStatus.NOT_STARTED],
    assignedEditorName: row.editingJob?.assignedEditor?.name ?? "—",
  };
}

async function fetchProductionQueue() {
  return db.order.findMany({
    where: { status: OrderStatus.PRODUCTION },
    include: {
      customer: { select: { name: true } },
      booking: { select: { sessionDate: true } },
      editingJob: {
        select: {
          status: true,
        },
      },
      productionJob: {
        select: {
          status: true,
          albumDesignStatus: true,
          printingStatus: true,
          assemblyStatus: true,
          vendorStatus: true,
          framedPrintsStatus: true,
          finalStatus: true,
          productionStartedAt: true,
          readyForPickupAt: true,
          completedAt: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

type ProductionQueueRow = Awaited<ReturnType<typeof fetchProductionQueue>>[number];

function mapProductionQueueRow(row: ProductionQueueRow): ProductionQueueItem {
  const productionStatus = getProductionStatus({
    editingJob: row.editingJob,
    productionJob: row.productionJob,
    status: row.status,
  });

  const completedSections = [
    row.productionJob?.albumDesignStatus,
    row.productionJob?.printingStatus,
    row.productionJob?.assemblyStatus,
    row.productionJob?.vendorStatus,
    row.productionJob?.framedPrintsStatus,
    row.productionJob?.finalStatus,
  ].filter((status) => status === OrderProductionSectionStatus.COMPLETED).length;

  return {
    id: row.id,
    jobNumber: row.jobNumber,
    customerName: row.customer.name,
    sessionDate: formatDate(row.booking.sessionDate),
    productionStatus: ORDER_PRODUCTION_STATUS_LABELS[productionStatus],
    sectionSummary: `${completedSections} of 6 sections complete`,
  };
}

function shouldRetryOrderFinancialEditError(error: unknown): boolean {
  return !(
    error instanceof PendingCreditNoteApprovalError ||
    error instanceof OrderAddOnOwnedBySessionConfigurationError
  );
}
