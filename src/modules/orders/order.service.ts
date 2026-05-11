import {
  InvoiceStatus,
  OrderActivityType,
  OrderDeliveryStatus,
  OrderEditingStatus,
  OrderProductionSectionStatus,
  OrderProductionStatus,
  OrderSelectionStatus,
  OrderStatus,
  PaymentType,
  Prisma,
  ProductCategory,
  UserRole,
} from "@prisma/client";
import { addDays } from "date-fns";
import type { ActorContext } from "@/lib/auth";
import { hasPermission, PERMISSIONS, type Permission } from "@/lib/permissions";
import { WorkflowGuardError } from "./order.errors";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import { syncUpgradeCommissionForOrder } from "@/modules/commissions/commission.service";
import { formatCustomerPhone } from "@/modules/customers/customer.utils";
import { PUBLIC_ID_KIND } from "@/modules/identifiers/identifier.constants";
import { generatePublicId } from "@/modules/identifiers/identifier.service";
import { syncOrderInvoiceForFinancialEdit } from "@/modules/invoices/invoice.service";
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
  updateOrderSchema,
  updateOrderEditingWorkflowSchema,
  updateOrderDeliveryWorkflowSchema,
  updateOrderProductionWorkflowSchema,
  updateOrderSelectionWorkflowSchema,
  updateOrderWorkflowSchema,
  type UpdateOrderInput,
  type UpdateOrderEditingWorkflowInput,
  type UpdateOrderDeliveryWorkflowInput,
  type UpdateOrderProductionWorkflowInput,
  type UpdateOrderSelectionWorkflowInput,
  type UpdateOrderWorkflowInput,
} from "./order.schema";
import type {
  EditableOrder,
  EditingQueueItem,
  InvoiceStatusFilter,
  InvoiceStatusLabel,
  Order,
  OrderAddOn,
  OrderAddOnProductOption,
  OrderActivityPreviewItem,
  OrderDetail,
  OrderDeliveryWorkflow,
  OrderEditPackage,
  OrderEditingWorkflow,
  OrderEditorOption,
  OrderFilters,
  OrderFinancialSummary,
  OrderPaymentStatusLabel,
  OrderPaymentStage,
  OrderProductionAction,
  OrderProductionSection,
  ProductionQueueItem,
  OrderProductionWorkflow,
  OrderSelectionPackageOption,
  OrderSelectionWorkflow,
  OrderStatusFilter,
  OrderStatusLabel,
  OrderWorkflowStep,
} from "./order.types";

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

function assertActorPermission(actorContext: ActorContext, permission: Permission): void {
  if (!actorContext.actorRole) return;
  if (!hasPermission({ role: actorContext.actorRole }, permission)) {
    throw new Error(`Permission denied: ${permission}`);
  }
}

type OrderRow = Awaited<ReturnType<typeof fetchOrders>>[number];
type OrderDetailRow = NonNullable<Awaited<ReturnType<typeof fetchOrderById>>>;
type OrderWriteClient = Prisma.TransactionClient;

export function parseOrderFilters(filters: {
  search?: string | string[];
  orderStatus?: string | string[];
  invoiceStatus?: string | string[];
  sessionDateFrom?: string | string[];
  sessionDateTo?: string | string[];
  editorId?: string | string[];
}): OrderFilters {
  const search = singleValue(filters.search)?.trim();
  const orderStatus = singleValue(filters.orderStatus);
  const invoiceStatus = singleValue(filters.invoiceStatus);
  const sessionDateFrom = parseDateInput(singleValue(filters.sessionDateFrom));
  const sessionDateTo = parseDateInput(singleValue(filters.sessionDateTo));
  const editorId = singleValue(filters.editorId)?.trim();

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
  };
}

export async function getOrders(filters: OrderFilters = {}): Promise<Order[]> {
  const rows = await withRetry(
    () => fetchOrders(filters),
    "Failed to fetch orders"
  );

  return rows.map(mapOrderRow);
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

function mapOrderDetailRow(row: OrderDetailRow): OrderDetail {
  const summary = mapOrderRow(row);
  const includedPhotoCount = row.finalPackage?.photoCount ?? row.originalPackage?.photoCount ?? null;
  const selectedPhotoCount = row.selectedPhotoCount ?? null;
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
    addonsSummary: formatAddOnsSummary(mapStructuredAddOns(row.orderAddOns)),
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
  const [order, packageRows, addOnProductRows, completedActivity] = await withRetry(
    () =>
      Promise.all([
        db.order.findUnique({
          where: { id: orderId },
          include: {
            originalPackage: {
              select: {
                id: true,
                name: true,
                price: true,
                photoCount: true,
                description: true,
              },
            },
            finalPackage: {
              select: {
                id: true,
                name: true,
                price: true,
                photoCount: true,
                description: true,
              },
            },
            invoices: {
              where: { parentInvoiceId: null },
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
          },
        }),
        db.package.findMany({
          where: { isActive: true },
          select: { id: true, name: true, price: true, photoCount: true },
          orderBy: { price: "asc" },
        }),
        db.product.findMany({
          where: {
            isActive: true,
            isAddOn: true,
            id: { not: "addon-extra-photo" },
          },
          select: { id: true, name: true, category: true, canonicalPrice: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
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

  const addOns = mapStructuredAddOns(order.orderAddOns);
  const includedPhotoCount =
    order.finalPackage?.photoCount ?? order.originalPackage?.photoCount ?? 0;
  const selectedPhotos = order.selectedPhotoCount || includedPhotoCount;
  const extraPhotoCount = Math.max(selectedPhotos - includedPhotoCount, 0);
  const currentPackage =
    order.finalPackage ?? order.originalPackage ?? packageRows[0] ?? null;
  if (!currentPackage) {
    throw new Error("Order has no package available for selection workflow");
  }

  const manualAddOnTotal = sumAddOnsDecimal(addOns);
  const invoice = order.invoices[0] ?? null;
  const recognizedPackageBaseline = invoice
    ? invoice.totalAmount
        .minus(manualAddOnTotal)
        .minus(await calculateExtraPhotoCharge({
          selectedPhotoCount: order.selectedPhotoCount,
          includedPhotoCount,
        }))
    : currentPackage.price;
  const packageOptions = buildSelectionPackageOptions({
    packages: packageRows,
    currentPackage,
    selectedPhotos,
    recognizedPackageBaseline,
  });
  const recommendedPackage =
    packageOptions.find((option) => option.isRecommended) ?? null;
  const originalPackagePrice = order.originalPackage?.price ?? currentPackage.price;
  const packageUpgradeDifference = currentPackage.price.minus(originalPackagePrice);
  const extraPhotoOption = await getExtraPhotoAddOnOption();
  const extraPhotoCharge = extraPhotoOption.price.mul(extraPhotoCount);
  const selectionAddOnTotal = manualAddOnTotal.plus(extraPhotoCharge);
  const packageDescription =
    order.finalPackage?.description ?? order.originalPackage?.description ?? null;

  return {
    orderId: order.id,
    orderStatus: mapOrderStatus(order.status),
    finalPackageId: currentPackage.id,
    originalPackageName: order.originalPackage?.name ?? "—",
    finalPackageName: currentPackage.name,
    packageDescription:
      packageDescription !== null && packageDescription.trim().length > 0
        ? packageDescription.trim()
        : null,
    selectedPhotos,
    includedPhotoCount,
    extraPhotoCount,
    addOns,
    notes: order.notes ?? "",
    selectionStatus: ORDER_SELECTION_STATUS_LABELS[order.selectionStatus],
    completedAt: completedActivity ? formatDateTime(completedActivity.createdAt) : null,
    manualAddOnTotal: formatMoney(manualAddOnTotal),
    extraPhotoUnitPriceAmount: extraPhotoOption.price.toNumber(),
    extraPhotoUnitPrice: formatMoney(extraPhotoOption.price),
    extraPhotoCharge: formatMoney(extraPhotoCharge),
    selectionAddOnTotal: formatMoney(selectionAddOnTotal),
    packageUpgradeDifference: formatSignedMoney(packageUpgradeDifference),
    nextRecommendedFinancialAction: resolveSelectionFinancialAction({
      extraPhotoCount,
      addOnTotal: selectionAddOnTotal,
      remainingAmount: invoice?.remainingAmount ?? zeroMoney(),
      recommendedPackage,
    }),
    keepCurrentPackageLabel: `Keep current package and review ${formatMoney(selectionAddOnTotal)} in add-ons or extra-photo charges.`,
    upgradePackageLabel: recommendedPackage
      ? `Upgrade to ${recommendedPackage.name} for ${recommendedPackage.upgradeDifferenceLabel}.`
      : "No higher active package covers the current selected-photo count.",
    recommendedPackage,
    invoiceLocked: invoice?.isLocked ?? false,
    packageOptions,
    addOnOptions: addOnProductRows.map(mapOrderAddOnProductOption),
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
            originalPackage: { select: { photoCount: true } },
            finalPackage: { select: { photoCount: true } },
            invoices: {
              where: { parentInvoiceId: null },
              select: {
                id: true,
                remainingAmount: true,
                payments: {
                  where: { paymentType: PaymentType.BASE },
                  select: { id: true },
                  take: 1,
                },
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

export async function updateOrderSelectionWorkflow(
  orderId: string,
  input: UpdateOrderSelectionWorkflowInput,
  actorContext: ActorContext = {}
): Promise<OrderSelectionWorkflow> {
  const orderForGuard = await db.order.findUnique({
    where: { id: orderId },
    select: { status: true },
  });
  if (!orderForGuard) throw new Error("Order not found");
  assertSelectionWorkflowWritable(orderForGuard.status);

  const data = updateOrderSelectionWorkflowSchema.parse(input);
  const [pricedAddOns, selectedPackage] = await Promise.all([
    priceSelectionAddOns(data.addOns),
    db.package.findUnique({
      where: { id: data.finalPackageId },
      select: { photoCount: true },
    }),
  ]);
  if (!selectedPackage) {
    throw new Error("Selected package does not exist");
  }
  const selectedPhotos = selectedPackage.photoCount + data.extraPhotos;

  await updateOrder(orderId, {
    finalPackageId: data.finalPackageId,
    selectedPhotos,
    addOns: pricedAddOns,
    notes: data.notes,
  }, actorContext);

  if (data.completeSelection) {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { selectionStatus: true },
    });
    if (!order) throw new Error("Order not found");
    if (order.selectionStatus === OrderSelectionStatus.PENDING) {
      await updateOrderWorkflowStatus(orderId, {
        selectionStatus: OrderSelectionStatus.IN_PROGRESS,
      }, actorContext);
    }
    await updateOrderWorkflowStatus(orderId, {
      selectionStatus: OrderSelectionStatus.COMPLETED,
    }, actorContext);
  } else {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { selectionStatus: true },
    });
    if (order?.selectionStatus === OrderSelectionStatus.PENDING) {
      await updateOrderWorkflowStatus(orderId, {
        selectionStatus: OrderSelectionStatus.IN_PROGRESS,
      }, actorContext);
    }
  }

  const workflow = await getOrderSelectionWorkflowById(orderId);
  if (!workflow) throw new Error("Order not found after selection update");
  return workflow;
}

export async function updateOrderEditingWorkflow(
  orderId: string,
  input: UpdateOrderEditingWorkflowInput,
  actorContext: ActorContext = {}
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
            invoices: {
              where: { parentInvoiceId: null },
              select: {
                remainingAmount: true,
                payments: {
                  where: { paymentType: PaymentType.BASE },
                  select: { id: true },
                  take: 1,
                },
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

        const basePaymentVerified = hasBasePayment(order.invoices);
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
  actorContext: ActorContext = {}
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
  actorContext: ActorContext = {}
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
  input: UpdateOrderInput,
  actorContext: ActorContext = {}
): Promise<EditableOrder> {
  const data = updateOrderSchema.parse(input);

  const row = await withRetry(
    () =>
      db.$transaction(async (tx) => {
        const [order, selectedPackage] = await Promise.all([
          tx.order.findUnique({
            where: { id: orderId },
            include: {
              originalPackage: { select: { id: true, name: true, price: true, photoCount: true } },
              finalPackage: { select: { id: true, name: true, price: true, photoCount: true } },
              orderAddOns: {
                select: { productId: true, nameSnapshot: true, priceSnapshot: true, quantity: true },
                orderBy: { createdAt: "asc" },
              },
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
        const previousAddOns = mapStructuredAddOns(order.orderAddOns);
        const previousNotes = order.notes?.trim() ?? "";
        const previousIncludedPhotoCount =
          order.finalPackage?.photoCount ?? order.originalPackage?.photoCount ?? null;

        await tx.order.update({
          where: { id: orderId },
          data: {
            finalPackage: { connect: { id: data.finalPackageId } },
            selectedPhotoCount: data.selectedPhotos,
            addOns: data.addOns,
            notes: data.notes?.trim() ? data.notes.trim() : null,
          },
        });

        await tx.orderAddOn.deleteMany({ where: { orderId } });
        if (data.addOns.length > 0) {
          await tx.orderAddOn.createMany({
            data: data.addOns.map((addOn) => ({
              orderId,
              productId: addOn.optionId ?? null,
              nameSnapshot: addOn.name,
              priceSnapshot: new Prisma.Decimal(addOn.price),
              quantity: 1,
            })),
          });
        }
        const invoiceSummary = await syncOrderInvoiceForFinancialEdit(tx, {
          orderId,
          previousPackagePrice,
          previousAddOns,
          previousSelectedPhotoCount: order.selectedPhotoCount,
          previousIncludedPhotoCount,
        });

        await syncUpgradeCommissionForOrder(tx, {
          orderId,
          upgradeAmount: invoiceSummary.packageAdjustmentAmount,
        });

        if (order.finalPackageId !== data.finalPackageId) {
          await recordOrderActivity(tx, {
            orderId,
            userId: actorContext.actorUserId ?? null,
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
            userId: actorContext.actorUserId ?? null,
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

        const nextNotes = data.notes?.trim() ?? "";
        if (previousNotes !== nextNotes && nextNotes) {
          await recordOrderActivity(tx, {
            orderId,
            userId: actorContext.actorUserId ?? null,
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
  input: UpdateOrderWorkflowInput,
  actorContext: ActorContext = {}
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
  actorContext: ActorContext = {}
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
  actorContext: ActorContext = {}
): Promise<{ id: string }> {
  const booking = await client.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      jobId: true,
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
    await client.invoice.updateMany({
      where: {
        bookingId: booking.id,
        jobId: booking.jobId,
        orderId: null,
      },
      data: { orderId: booking.order.id },
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
      originalPackageId: booking.package.id,
      finalPackageId: booking.package.id,
      selectedPhotoCount: 0,
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

  await recordOrderActivity(client, {
    orderId: order.id,
    userId: actorContext.actorUserId ?? null,
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
      jobId: booking.jobId,
      orderId: null,
    },
    data: { orderId: order.id },
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
      ? { invoices: { some: { status: filters.invoiceStatus } } }
      : {}),
    ...(sessionDateFilter
      ? { booking: { sessionDate: sessionDateFilter } }
      : {}),
    ...(filters.editorId
      ? { editingJob: { assignedEditorId: filters.editorId } }
      : {}),
  };

  return db.order.findMany({
    where,
    include: {
      customer: { select: { name: true, phone: true } },
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
          invoiceNumber: true,
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
      customer: { select: { name: true, phone: true } },
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
      editingJob: {
        select: {
          status: true,
        },
      },
      productionJob: {
        select: productionJobSelect,
      },
      invoices: {
        select: {
          id: true,
          invoiceNumber: true,
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
    },
  });
}

const editableOrderInclude = {
  customer: { select: { name: true, phone: true } },
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
  orderAddOns: {
    select: {
      productId: true,
      nameSnapshot: true,
      priceSnapshot: true,
      quantity: true,
    },
    orderBy: { createdAt: "asc" },
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
    jobNumber: row.jobNumber,
    customerPhone: formatCustomerPhone(row.customer.phone),
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
    primaryInvoiceNumber: row.invoices[0]?.invoiceNumber ?? null,
  };
}

type InvoiceSummaryRow = Array<{
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
  if (invoices.length === 0 || paidAmount.lte(0)) {
    return "Pending";
  }
  if (totalAmount.gt(0) && remainingAmount.lte(0)) {
    return "Paid";
  }
  return "Partially paid";
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

type EditableOrderRow = NonNullable<Awaited<ReturnType<typeof fetchEditableOrderById>>>;

function mapEditableOrderRow(order: EditableOrderRow): EditableOrder {
  const addOns = mapStructuredAddOns(order.orderAddOns);
  const invoice = order.invoices[0] ?? null;

  return {
    id: order.id,
    customerPhone: formatCustomerPhone(order.customer.phone),
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

function buildSelectionPackageOptions(input: {
  packages: Array<{
    id: string;
    name: string;
    price: Prisma.Decimal;
    photoCount: number;
  }>;
  currentPackage: {
    id: string;
    name: string;
    price: Prisma.Decimal;
    photoCount: number;
  };
  selectedPhotos: number;
  recognizedPackageBaseline: Prisma.Decimal;
}): OrderSelectionPackageOption[] {
  const byId = new Map<string, typeof input.currentPackage>();
  for (const packageOption of input.packages) {
    byId.set(packageOption.id, packageOption);
  }
  byId.set(input.currentPackage.id, input.currentPackage);

  const sortedPackages = Array.from(byId.values()).sort((a, b) =>
    a.price.minus(b.price).toNumber()
  );
  const recommended = sortedPackages.find(
    (packageOption) =>
      packageOption.id !== input.currentPackage.id &&
      packageOption.photoCount >= input.selectedPhotos &&
      packageOption.price.greaterThan(input.currentPackage.price)
  );

  return sortedPackages.map((packageOption) => {
    const upgradeDifference = packageOption.price.minus(input.recognizedPackageBaseline);
    return {
      id: packageOption.id,
      name: packageOption.name,
      price: packageOption.price.toNumber(),
      priceLabel: formatMoney(packageOption.price),
      photoCount: packageOption.photoCount,
      upgradeDifference: upgradeDifference.toNumber(),
      upgradeDifferenceLabel: formatSignedMoney(upgradeDifference),
      isCurrent: packageOption.id === input.currentPackage.id,
      isRecommended: recommended?.id === packageOption.id,
    };
  });
}

function mapOrderAddOnProductOption(option: {
  id: string;
  name: string;
  category: ProductCategory;
  canonicalPrice: Prisma.Decimal;
}): OrderAddOnProductOption {
  return {
    id: option.id,
    name: option.name,
    category: option.category,
    price: option.canonicalPrice.toNumber(),
    priceLabel: formatMoney(option.canonicalPrice),
  };
}

async function priceSelectionAddOns(addOns: OrderAddOn[]): Promise<OrderAddOn[]> {
  const optionIds = addOns.flatMap((addOn) => addOn.optionId ? [addOn.optionId] : []);
  if (optionIds.length === 0) return addOns;

  const options = await db.product.findMany({
    where: {
      id: { in: optionIds, not: "addon-extra-photo" },
      isActive: true,
      isAddOn: true,
    },
    select: { id: true, name: true, canonicalPrice: true },
  });
  const byId = new Map(options.map((option) => [option.id, option]));

  return addOns.map((addOn) => {
    if (!addOn.optionId) return addOn;
    const option = byId.get(addOn.optionId);
    if (!option) {
      throw new Error("Selected add-on option is not available");
    }
    return {
      optionId: option.id,
      name: option.name,
      price: option.canonicalPrice.toNumber(),
    };
  });
}

async function getExtraPhotoAddOnOption(): Promise<{
  price: Prisma.Decimal;
}> {
  const option = await db.product.findUnique({
    where: { id: "addon-extra-photo" },
    select: { canonicalPrice: true, isActive: true, isAddOn: true },
  });
  if (!option?.isActive || !option.isAddOn) {
    throw new Error("Active extra-photo add-on price is required");
  }
  return { price: option.canonicalPrice };
}

async function calculateExtraPhotoCharge(input: {
  selectedPhotoCount?: number | null;
  includedPhotoCount: number;
}): Promise<Prisma.Decimal> {
  const extraPhotoCount = Math.max(
    (input.selectedPhotoCount ?? input.includedPhotoCount) - input.includedPhotoCount,
    0
  );
  if (extraPhotoCount === 0) return zeroMoney();

  const option = await getExtraPhotoAddOnOption();
  return option.price.mul(extraPhotoCount);
}

function resolveSelectionFinancialAction(input: {
  extraPhotoCount: number;
  addOnTotal: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
  recommendedPackage: OrderSelectionPackageOption | null;
}): string {
  if (input.recommendedPackage && input.extraPhotoCount > 0) {
    return `Review upgrade to ${input.recommendedPackage.name} before completing selection.`;
  }
  if (input.extraPhotoCount > 0) {
    return "Add an extra-photo charge or confirm package upgrade handling before completion.";
  }
  if (input.addOnTotal.greaterThan(0) || input.remainingAmount.greaterThan(0)) {
    return "Confirm the invoice balance and collect any remaining payment adjustment.";
  }
  return "No payment adjustment is currently indicated.";
}

function sumAddOnsDecimal(addOns: OrderAddOn[]): Prisma.Decimal {
  return addOns.reduce(
    (sum, addOn) => sum.plus(new Prisma.Decimal(addOn.price)),
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
        ...(row.productId ? { optionId: row.productId } : {}),
        name: row.nameSnapshot,
        price: row.priceSnapshot.toNumber(),
      });
    }
    return entries;
  });
}

function areAddOnsEqual(first: OrderAddOn[], second: OrderAddOn[]): boolean {
  if (first.length !== second.length) return false;
  return first.every((addOn, index) => {
    const other = second[index];
    return (
      other !== undefined &&
      addOn.optionId === other.optionId &&
      addOn.name === other.name &&
      new Prisma.Decimal(addOn.price).equals(new Prisma.Decimal(other.price))
    );
  });
}

function serializeAddOnsForMetadata(addOns: OrderAddOn[]): Prisma.InputJsonArray {
  return addOns.map((addOn) => ({
    ...(addOn.optionId ? { optionId: addOn.optionId } : {}),
    name: addOn.name,
    price: addOn.price,
  }));
}

function formatAddOnsSummary(addOns: OrderAddOn[]): string {
  if (addOns.length === 0) return "—";

  return addOns
    .map((addOn) => `${addOn.name} (${formatMoney(new Prisma.Decimal(addOn.price))})`)
    .join(", ");
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
    selectedPhotoCount: number | null;
    originalPackage: { photoCount: number } | null;
    finalPackage: { photoCount: number } | null;
    invoices: Array<{
      id: string;
      remainingAmount: Prisma.Decimal;
      payments: Array<{ id: string }>;
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
  const targetPhotoCount =
    order.selectedPhotoCount ??
    order.finalPackage?.photoCount ??
    order.originalPackage?.photoCount ??
    0;
  const progressPercent =
    targetPhotoCount > 0
      ? Math.min(Math.round((editedPhotoCount / targetPhotoCount) * 100), 100)
      : 0;
  const basePaymentVerified = hasBasePayment(order.invoices);
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
    select: {
      totalAmount: true,
      paidAmount: true,
      remainingAmount: true,
      status: true,
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

function assertSelectionWorkflowWritable(status: OrderStatus): void {
  if (status === OrderStatus.ACTIVE) {
    throw new Error(
      "Base payment has not been recorded. Record base payment on the booking to begin selection."
    );
  }
  if (status === OrderStatus.CANCELLED) {
    throw new Error("Cancelled orders cannot be updated through selection");
  }
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
  actorContext: ActorContext = {}
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

function hasBasePayment(
  invoices: Array<{ payments: Array<{ id: string }> }>
): boolean {
  return invoices.some((invoice) => invoice.payments.length > 0);
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
  actorContext: ActorContext = {}
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
  actorContext: ActorContext = {}
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

export async function getOrderFinancialSummary(
  orderId: string
): Promise<OrderFinancialSummary | null> {
  const order = await withRetry(
    () =>
      db.order.findUnique({
        where: { id: orderId },
        include: {
          originalPackage: { select: { name: true, price: true } },
          finalPackage: { select: { name: true, price: true } },
          invoices: {
            where: { parentInvoiceId: null },
            select: {
              id: true,
              invoiceNumber: true,
              totalAmount: true,
              paidAmount: true,
              remainingAmount: true,
              status: true,
              payments: {
                orderBy: { paidAt: "desc" },
                select: {
                  id: true,
                  publicId: true,
                  amount: true,
                  method: true,
                  paymentType: true,
                  paidAt: true,
                  reference: true,
                  notes: true,
                },
              },
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
        },
      }),
    "Failed to fetch order financial summary"
  );

  if (!order) return null;

  const invoice = order.invoices[0] ?? null;
  const originalPackage = order.originalPackage;
  const finalPackage = order.finalPackage ?? originalPackage;
  const addOns = mapStructuredAddOns(order.orderAddOns);
  const addOnTotal = sumAddOnsDecimal(addOns);

  const originalPrice = originalPackage ? new Prisma.Decimal(originalPackage.price) : zeroMoney();
  const finalPrice = finalPackage ? new Prisma.Decimal(finalPackage.price) : originalPrice;
  const upgradeAmount = finalPrice.minus(originalPrice);
  const hasUpgrade =
    finalPackage !== null &&
    originalPackage !== null &&
    finalPackage.name !== originalPackage.name &&
    upgradeAmount.greaterThan(0);

  const invoiceTotal = invoice ? invoice.totalAmount : finalPrice.plus(addOnTotal);
  const extraPhotoTotal = invoice
    ? invoiceTotal.minus(finalPrice).minus(addOnTotal)
    : zeroMoney();
  const extraPhotoTotalClamped = Prisma.Decimal.max(extraPhotoTotal, 0);

  const invoiceSummary = invoice
    ? summarizeInvoices([invoice])
    : {
        status: "No Invoice" as InvoiceStatusLabel,
        paymentStatus: "Pending" as OrderPaymentStatusLabel,
        totalAmount: finalPrice.plus(addOnTotal),
        paidAmount: zeroMoney(),
        remainingAmount: finalPrice.plus(addOnTotal),
      };

  const payments: OrderPaymentStage[] = (invoice?.payments ?? []).map((p) => ({
    id: p.id,
    publicId: p.publicId,
    amount: formatMoney(p.amount),
    method: formatEnum(p.method),
    paymentType: formatEnum(p.paymentType),
    paidAt: formatDate(p.paidAt),
    reference: p.reference ?? "—",
    notes: p.notes ?? "—",
  }));

  return {
    invoiceId: invoice?.id ?? null,
    invoiceNumber: invoice?.invoiceNumber ?? null,
    invoiceStatus: invoiceSummary.status,
    paymentStatus: invoiceSummary.paymentStatus,
    basePackageName: originalPackage?.name ?? "—",
    basePackagePrice: formatMoney(originalPrice),
    upgradePackageName: hasUpgrade ? (finalPackage?.name ?? null) : null,
    upgradeAmount: hasUpgrade ? formatMoney(upgradeAmount) : null,
    addOnTotal: formatMoney(addOnTotal),
    extraPhotoTotal: formatMoney(extraPhotoTotalClamped),
    invoiceTotal: formatMoney(invoiceSummary.totalAmount),
    paidAmount: formatMoney(invoiceSummary.paidAmount),
    balanceDue: formatMoney(invoiceSummary.remainingAmount),
    payments,
  };
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
