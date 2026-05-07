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
  UserRole,
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
  ORDER_PRODUCTION_SECTION_STATUS_LABELS,
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
  InvoiceStatusFilter,
  InvoiceStatusLabel,
  Order,
  OrderAddOn,
  OrderAddOnOption,
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
  const [order, packageRows, addOnOptionRows, completedActivity] = await withRetry(
    () =>
      Promise.all([
        db.order.findUnique({
          where: { id: orderId },
          include: {
            originalPackage: {
              select: { id: true, name: true, price: true, photoCount: true },
            },
            finalPackage: {
              select: { id: true, name: true, price: true, photoCount: true },
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
          },
        }),
        db.package.findMany({
          where: { isActive: true },
          select: { id: true, name: true, price: true, photoCount: true },
          orderBy: { price: "asc" },
        }),
        db.orderAddOnOption.findMany({
          where: {
            isActive: true,
            category: { not: "EXTRA_PHOTO" },
          },
          select: { id: true, name: true, category: true, price: true },
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

  const addOns = parseAddOns(order.addOns);
  const includedPhotoCount =
    order.finalPackage?.photoCount ?? order.originalPackage?.photoCount ?? 0;
  const selectedPhotos = order.selectedPhotoCount ?? includedPhotoCount;
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
  const packageUpgradeDifference = currentPackage.price.minus(recognizedPackageBaseline);
  const extraPhotoOption = await getExtraPhotoAddOnOption();
  const extraPhotoCharge = extraPhotoOption.price.mul(extraPhotoCount);
  const selectionAddOnTotal = manualAddOnTotal.plus(extraPhotoCharge);

  return {
    orderId: order.id,
    orderStatus: mapOrderStatus(order.status),
    finalPackageId: currentPackage.id,
    originalPackageName: order.originalPackage?.name ?? "—",
    finalPackageName: currentPackage.name,
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
    addOnOptions: addOnOptionRows.map(mapOrderAddOnOption),
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
            assignedEditor: { select: { id: true, name: true } },
            originalPackage: { select: { photoCount: true } },
            finalPackage: { select: { photoCount: true } },
            invoices: {
              select: {
                payments: {
                  where: { paymentType: PaymentType.BASE },
                  select: { id: true },
                  take: 1,
                },
              },
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
          status: true,
          editingStatus: true,
          productionStatus: true,
          deliveryStatus: true,
          productionAlbumDesignStatus: true,
          productionPrintingStatus: true,
          productionAssemblyStatus: true,
          productionVendorStatus: true,
          productionFramedPrintsStatus: true,
          productionFinalStatus: true,
          productionReadyAt: true,
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
  input: UpdateOrderSelectionWorkflowInput
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
  });

  if (data.completeSelection) {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { selectionStatus: true },
    });
    if (!order) throw new Error("Order not found");
    if (order.selectionStatus === OrderSelectionStatus.PENDING) {
      await updateOrderWorkflowStatus(orderId, {
        selectionStatus: OrderSelectionStatus.IN_PROGRESS,
      });
    }
    await updateOrderWorkflowStatus(orderId, {
      selectionStatus: OrderSelectionStatus.COMPLETED,
    });
  } else {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { selectionStatus: true },
    });
    if (order?.selectionStatus === OrderSelectionStatus.PENDING) {
      await updateOrderWorkflowStatus(orderId, {
        selectionStatus: OrderSelectionStatus.IN_PROGRESS,
      });
    }
  }

  const workflow = await getOrderSelectionWorkflowById(orderId);
  if (!workflow) throw new Error("Order not found after selection update");
  return workflow;
}

export async function updateOrderEditingWorkflow(
  orderId: string,
  input: UpdateOrderEditingWorkflowInput
): Promise<OrderEditingWorkflow> {
  const data = updateOrderEditingWorkflowSchema.parse(input);

  await withRetry(
    () =>
      db.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: {
            assignedEditor: { select: { id: true, name: true } },
            invoices: {
              select: {
                payments: {
                  where: { paymentType: PaymentType.BASE },
                  select: { id: true },
                  take: 1,
                },
              },
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
        const now = new Date();

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
              order.editingStatus === OrderEditingStatus.NOT_STARTED
                ? OrderEditingStatus.ASSIGNED
                : order.editingStatus;
            if (nextStatus !== order.editingStatus) {
              assertWorkflowTransition(
                "editingStatus",
                order.editingStatus,
                nextStatus
              );
            }

            await tx.order.update({
              where: { id: orderId },
              data: {
                assignedEditorId: editor.id,
                editingAssignedAt: now,
                estimatedEditingCompletionAt:
                  data.estimatedEditingCompletionAt ?? order.estimatedEditingCompletionAt,
                editingStatus: nextStatus,
              },
            });

            await recordOrderActivity(tx, {
              orderId,
              type: OrderActivityType.EDITOR_ASSIGNED,
              title: order.assignedEditorId ? "Editor reassigned" : "Editor assigned",
              description: `${editor.name} was assigned to editing.`,
              metadata: {
                previousEditorId: order.assignedEditorId,
                previousEditorName: order.assignedEditor?.name ?? null,
                nextEditorId: editor.id,
                nextEditorName: editor.name,
                previousStatus: order.editingStatus,
                nextStatus,
                estimatedEditingCompletionAt:
                  data.estimatedEditingCompletionAt?.toISOString() ?? null,
              },
            });
            break;
          }

          case "markStarted": {
            assertEditingReadyToStart(order, basePaymentVerified);
            assertWorkflowTransition(
              "editingStatus",
              order.editingStatus,
              OrderEditingStatus.IN_PROGRESS
            );
            await tx.order.update({
              where: { id: orderId },
              data: {
                editingStatus: OrderEditingStatus.IN_PROGRESS,
                editingStartedAt: order.editingStartedAt ?? now,
                editedPhotoCount: data.editedPhotoCount ?? order.editedPhotoCount,
                estimatedEditingCompletionAt:
                  data.estimatedEditingCompletionAt ?? order.estimatedEditingCompletionAt,
                status: OrderStatus.EDITING,
              },
            });
            await recordEditingStatusActivity(tx, orderId, {
              previousStatus: order.editingStatus,
              nextStatus: OrderEditingStatus.IN_PROGRESS,
              title: "Editing started",
            });
            break;
          }

          case "requestRevision": {
            assertWorkflowTransition(
              "editingStatus",
              order.editingStatus,
              OrderEditingStatus.REVISION_REQUESTED
            );
            await tx.order.update({
              where: { id: orderId },
              data: {
                editingStatus: OrderEditingStatus.REVISION_REQUESTED,
                revisionCount: { increment: 1 },
              },
            });
            await recordEditingStatusActivity(tx, orderId, {
              previousStatus: order.editingStatus,
              nextStatus: OrderEditingStatus.REVISION_REQUESTED,
              title: "Revision requested",
              metadata: { nextRevisionCount: order.revisionCount + 1 },
            });
            break;
          }

          case "markComplete": {
            assertWorkflowTransition(
              "editingStatus",
              order.editingStatus,
              OrderEditingStatus.AWAITING_APPROVAL
            );
            await tx.order.update({
              where: { id: orderId },
              data: {
                editingStatus: OrderEditingStatus.AWAITING_APPROVAL,
                editingCompletedAt: now,
                editedPhotoCount: data.editedPhotoCount ?? order.editedPhotoCount,
              },
            });
            await recordEditingStatusActivity(tx, orderId, {
              previousStatus: order.editingStatus,
              nextStatus: OrderEditingStatus.AWAITING_APPROVAL,
              title: "Editing marked complete",
            });
            break;
          }

          case "markApproved": {
            assertWorkflowTransition(
              "editingStatus",
              order.editingStatus,
              OrderEditingStatus.APPROVED
            );
            await tx.order.update({
              where: { id: orderId },
              data: {
                editingStatus: OrderEditingStatus.APPROVED,
                customerApprovedAt: now,
              },
            });
            await recordEditingStatusActivity(tx, orderId, {
              previousStatus: order.editingStatus,
              nextStatus: OrderEditingStatus.APPROVED,
              title: "Customer approved editing",
            });
            break;
          }

          case "sendToProduction": {
            assertWorkflowTransition(
              "editingStatus",
              order.editingStatus,
              OrderEditingStatus.COMPLETED
            );
            assertWorkflowTransition(
              "productionStatus",
              order.productionStatus,
              OrderProductionStatus.IN_PROGRESS
            );
            await tx.order.update({
              where: { id: orderId },
              data: {
                editingStatus: OrderEditingStatus.COMPLETED,
                productionStatus: OrderProductionStatus.IN_PROGRESS,
                sentToProductionAt: now,
                status: OrderStatus.PRODUCTION,
              },
            });
            await recordEditingStatusActivity(tx, orderId, {
              previousStatus: order.editingStatus,
              nextStatus: OrderEditingStatus.COMPLETED,
              title: "Editing sent to production",
            });
            await recordOrderActivity(tx, {
              orderId,
              type: OrderActivityType.PRODUCTION_STATUS_CHANGED,
              title: "Production started",
              metadata: {
                field: "productionStatus",
                previousStatus: order.productionStatus,
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
  input: UpdateOrderProductionWorkflowInput
): Promise<OrderProductionWorkflow> {
  const data = updateOrderProductionWorkflowSchema.parse(input);

  await withRetry(
    () =>
      db.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            status: true,
            editingStatus: true,
            productionStatus: true,
            deliveryStatus: true,
            productionAlbumDesignStatus: true,
            productionPrintingStatus: true,
            productionAssemblyStatus: true,
            productionVendorStatus: true,
            productionFramedPrintsStatus: true,
            productionFinalStatus: true,
            productionReadyAt: true,
          },
        });

        if (!order) {
          throw new Error("Order not found");
        }
        assertProductionWorkflowWritable(order.status);

        const next = resolveProductionUpdate(order, data.action);
        if (next.productionStatus && next.productionStatus !== order.productionStatus) {
          assertWorkflowTransition(
            "productionStatus",
            order.productionStatus,
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
          data: next.orderData,
        });

        await recordOrderActivity(tx, {
          orderId,
          type: OrderActivityType.PRODUCTION_STATUS_CHANGED,
          title: next.title,
          description: next.description,
          metadata: next.metadata,
        });

        if (next.deliveryStatus && next.deliveryStatus !== order.deliveryStatus) {
          await recordOrderActivity(tx, {
            orderId,
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
    "Failed to update production workflow"
  );

  const workflow = await getOrderProductionWorkflowById(orderId);
  if (!workflow) throw new Error("Order not found after production update");
  return workflow;
}

export async function updateOrderDeliveryWorkflow(
  orderId: string,
  input: UpdateOrderDeliveryWorkflowInput
): Promise<OrderDeliveryWorkflow> {
  const data = updateOrderDeliveryWorkflowSchema.parse(input);

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

        const next = resolveDeliveryUpdate(order, data);
        if (next.deliveryStatus && next.deliveryStatus !== order.deliveryStatus) {
          assertWorkflowTransition(
            "deliveryStatus",
            order.deliveryStatus,
            next.deliveryStatus
          );
        }
        if (next.productionStatus && next.productionStatus !== order.productionStatus) {
          assertWorkflowTransition(
            "productionStatus",
            order.productionStatus,
            next.productionStatus
          );
        }

        await tx.order.update({
          where: { id: orderId },
          data: next.orderData,
        });

        await recordOrderActivity(tx, {
          orderId,
          type: OrderActivityType.DELIVERY_STATUS_CHANGED,
          title: next.title,
          description: next.description,
          metadata: next.metadata,
        });

        if (next.completed) {
          await recordOrderActivity(tx, {
            orderId,
            type: OrderActivityType.ORDER_COMPLETED,
            title: "Order completed",
            description: "Order was completed through the delivery workflow.",
            metadata: {
              completedBy: data.completedBy?.trim() ?? null,
              completedAt: new Date().toISOString(),
              paymentOverrideUsed: next.paymentOverrideUsed,
              overrideReason: data.overrideReason?.trim() ?? null,
            },
          });
        }
      }),
    "Failed to update delivery workflow"
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
              originalPackage: { select: { id: true, name: true, price: true, photoCount: true } },
              finalPackage: { select: { id: true, name: true, price: true, photoCount: true } },
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
  bookingId: string,
  initialStatus: OrderStatus = OrderStatus.ACTIVE
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
      status: initialStatus,
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

function mapOrderAddOnOption(option: {
  id: string;
  name: string;
  category: string;
  price: Prisma.Decimal;
}): OrderAddOnOption {
  return {
    id: option.id,
    name: option.name,
    category: option.category,
    price: option.price.toNumber(),
    priceLabel: formatMoney(option.price),
  };
}

async function priceSelectionAddOns(addOns: OrderAddOn[]): Promise<OrderAddOn[]> {
  const optionIds = addOns.flatMap((addOn) => addOn.optionId ? [addOn.optionId] : []);
  if (optionIds.length === 0) return addOns;

  const options = await db.orderAddOnOption.findMany({
    where: {
      id: { in: optionIds },
      isActive: true,
      category: { not: "EXTRA_PHOTO" },
    },
    select: { id: true, name: true, price: true },
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
      price: option.price.toNumber(),
    };
  });
}

async function getExtraPhotoAddOnOption(): Promise<{
  price: Prisma.Decimal;
}> {
  const option = await db.orderAddOnOption.findUnique({
    where: { id: "addon-extra-photo" },
    select: { price: true, isActive: true },
  });
  if (!option?.isActive) {
    throw new Error("Active extra-photo add-on price is required");
  }
  return option;
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

function parseAddOns(value: Prisma.JsonValue): OrderAddOn[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isJsonObject(item)) return [];
    const { optionId, name, price } = item;
    if (typeof name !== "string") return [];
    if (typeof price !== "number") return [];
    return [{
      ...(typeof optionId === "string" ? { optionId } : {}),
      name,
      price,
    }];
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

function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    editingStatus: OrderEditingStatus;
    productionStatus: OrderProductionStatus;
    assignedEditorId: string | null;
    assignedEditor: { id: string; name: string } | null;
    editingAssignedAt: Date | null;
    editingStartedAt: Date | null;
    editingCompletedAt: Date | null;
    customerApprovedAt: Date | null;
    sentToProductionAt: Date | null;
    editedPhotoCount: number;
    revisionCount: number;
    estimatedEditingCompletionAt: Date | null;
    selectedPhotoCount: number | null;
    originalPackage: { photoCount: number } | null;
    finalPackage: { photoCount: number } | null;
    invoices: Array<{ payments: Array<{ id: string }> }>;
  },
  editors: OrderEditorOption[]
): OrderEditingWorkflow {
  const targetPhotoCount =
    order.selectedPhotoCount ??
    order.finalPackage?.photoCount ??
    order.originalPackage?.photoCount ??
    0;
  const progressPercent =
    targetPhotoCount > 0
      ? Math.min(Math.round((order.editedPhotoCount / targetPhotoCount) * 100), 100)
      : 0;
  const basePaymentVerified = hasBasePayment(order.invoices);

  return {
    orderId: order.id,
    assignedEditorId: order.assignedEditorId,
    assignedEditorName: order.assignedEditor?.name ?? "Unassigned",
    assignedAt: order.editingAssignedAt ? formatDateTime(order.editingAssignedAt) : null,
    editingStatus: ORDER_EDITING_STATUS_LABELS[order.editingStatus],
    productionStatus: ORDER_PRODUCTION_STATUS_LABELS[order.productionStatus],
    progressPercent,
    editedPhotoCount: order.editedPhotoCount,
    targetPhotoCount,
    revisionCount: order.revisionCount,
    revisionState: resolveRevisionState(order.editingStatus, order.revisionCount),
    approvalState: resolveApprovalState(order.editingStatus),
    estimatedCompletionDate: order.estimatedEditingCompletionAt
      ? formatDate(order.estimatedEditingCompletionAt)
      : null,
    estimatedCompletionDateInput: order.estimatedEditingCompletionAt
      ? formatDateInput(order.estimatedEditingCompletionAt)
      : "",
    startedAt: order.editingStartedAt ? formatDateTime(order.editingStartedAt) : null,
    completedAt: order.editingCompletedAt ? formatDateTime(order.editingCompletedAt) : null,
    customerApprovedAt: order.customerApprovedAt
      ? formatDateTime(order.customerApprovedAt)
      : null,
    sentToProductionAt: order.sentToProductionAt
      ? formatDateTime(order.sentToProductionAt)
      : null,
    basePaymentVerified,
    canAssignEditor: order.editingStatus !== OrderEditingStatus.COMPLETED,
    canMarkStarted:
      basePaymentVerified &&
      order.selectionStatus === OrderSelectionStatus.COMPLETED &&
      Boolean(order.assignedEditorId) &&
      (
        order.editingStatus === OrderEditingStatus.ASSIGNED ||
        order.editingStatus === OrderEditingStatus.REVISION_REQUESTED
      ),
    canRequestRevision: order.editingStatus === OrderEditingStatus.AWAITING_APPROVAL,
    canMarkComplete:
      order.editingStatus === OrderEditingStatus.IN_PROGRESS ||
      order.editingStatus === OrderEditingStatus.REVISION_REQUESTED,
    canMarkApproved: order.editingStatus === OrderEditingStatus.AWAITING_APPROVAL,
    canSendToProduction: order.editingStatus === OrderEditingStatus.APPROVED,
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

type ProductionOrderState = {
  id: string;
  status: OrderStatus;
  editingStatus: OrderEditingStatus;
  productionStatus: OrderProductionStatus;
  deliveryStatus: OrderDeliveryStatus;
  productionAlbumDesignStatus: OrderProductionSectionStatus;
  productionPrintingStatus: OrderProductionSectionStatus;
  productionAssemblyStatus: OrderProductionSectionStatus;
  productionVendorStatus: OrderProductionSectionStatus;
  productionFramedPrintsStatus: OrderProductionSectionStatus;
  productionFinalStatus: OrderProductionSectionStatus;
  productionReadyAt: Date | null;
};

type ProductionWorkflowUpdate = {
  orderData: Prisma.OrderUpdateInput;
  productionStatus?: OrderProductionStatus;
  deliveryStatus?: OrderDeliveryStatus;
  title: string;
  description: string;
  metadata: Prisma.InputJsonObject;
};

const deliveryOrderSelect = {
  id: true,
  status: true,
  productionStatus: true,
  deliveryStatus: true,
  productionAlbumDesignStatus: true,
  productionPrintingStatus: true,
  productionAssemblyStatus: true,
  productionVendorStatus: true,
  productionFramedPrintsStatus: true,
  productionFinalStatus: true,
  productionReadyAt: true,
  deliveryPreparedAt: true,
  customerNotifiedAt: true,
  pickedUpAt: true,
  deliveryCompletedAt: true,
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
  orderData: Prisma.OrderUpdateInput;
  productionStatus?: OrderProductionStatus;
  deliveryStatus?: OrderDeliveryStatus;
  title: string;
  description: string;
  metadata: Prisma.InputJsonObject;
  completed?: boolean;
  paymentOverrideUsed?: boolean;
};

function mapOrderProductionWorkflow(order: ProductionOrderState): OrderProductionWorkflow {
  const canUpdateProduction =
    order.status !== OrderStatus.CANCELLED && order.status !== OrderStatus.DELIVERED;
  const sections = buildProductionSections(order, canUpdateProduction);

  return {
    orderId: order.id,
    productionStatus: ORDER_PRODUCTION_STATUS_LABELS[order.productionStatus],
    deliveryStatus: ORDER_DELIVERY_STATUS_LABELS[order.deliveryStatus],
    editingStatus: ORDER_EDITING_STATUS_LABELS[order.editingStatus],
    readyAt: order.productionReadyAt ? formatDateTime(order.productionReadyAt) : null,
    readinessWarning: resolveProductionReadinessWarning(order),
    canUpdateProduction,
    canMarkReadyForPickup:
      canUpdateProduction &&
      order.productionStatus !== OrderProductionStatus.READY_FOR_PICKUP &&
      order.productionStatus !== OrderProductionStatus.COMPLETED,
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
      status: order.productionAlbumDesignStatus,
      startAction: "markAlbumDesignStarted",
      completeAction: "markAlbumDesignCompleted",
      canUpdateProduction,
    }),
    productionSection({
      key: "printing",
      title: "Printing",
      description: "Album pages and print items sent to production.",
      status: order.productionPrintingStatus,
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
      status: order.productionAssemblyStatus,
      startAction: "markAssemblyStarted",
      completeAction: "markAssemblyCompleted",
      canUpdateProduction,
    }),
    productionSection({
      key: "vendor",
      title: "Vendor / Outsource",
      description: "Outsourced production work and vendor handoff.",
      status: order.productionVendorStatus,
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
      status: order.productionFramedPrintsStatus,
      startAction: null,
      completeAction: "markPrintsReady",
      completeLabel: "Prints ready",
      canUpdateProduction,
    }),
    {
      key: "finalReadiness",
      title: "Final Production Readiness",
      description: "Final production check before pickup handoff.",
      status: ORDER_PRODUCTION_SECTION_STATUS_LABELS[order.productionFinalStatus],
      action:
        canUpdateProduction &&
        order.productionStatus !== OrderProductionStatus.READY_FOR_PICKUP &&
        order.productionStatus !== OrderProductionStatus.COMPLETED
          ? "markProductionReadyForPickup"
          : null,
      actionLabel:
        canUpdateProduction &&
        order.productionStatus !== OrderProductionStatus.READY_FOR_PICKUP &&
        order.productionStatus !== OrderProductionStatus.COMPLETED
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
  if (
    order.editingStatus !== OrderEditingStatus.COMPLETED &&
    order.productionStatus !== OrderProductionStatus.READY_FOR_PICKUP
  ) {
    return "Editing is not marked completed yet. Admin-first mode allows production progress, but this is early.";
  }

  if (
    order.productionStatus === OrderProductionStatus.READY_FOR_PICKUP &&
    hasIncompleteProductionSections(order)
  ) {
    return "Production is marked ready while one or more section checks are still open.";
  }

  return null;
}

function hasIncompleteProductionSections(order: ProductionOrderState): boolean {
  return [
    order.productionAlbumDesignStatus,
    order.productionPrintingStatus,
    order.productionAssemblyStatus,
    order.productionVendorStatus,
    order.productionFramedPrintsStatus,
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
  const inProgressStatus =
    order.productionStatus === OrderProductionStatus.READY_FOR_PICKUP ||
    order.productionStatus === OrderProductionStatus.COMPLETED
      ? order.productionStatus
      : OrderProductionStatus.IN_PROGRESS;

  switch (action) {
    case "markAlbumDesignStarted":
      return productionSectionUpdate(order, {
        field: "productionAlbumDesignStatus",
        previousStatus: order.productionAlbumDesignStatus,
        nextStatus: OrderProductionSectionStatus.IN_PROGRESS,
        productionStatus: inProgressStatus,
        title: "Album design started",
        description: "Album design was marked in progress.",
      });
    case "markAlbumDesignCompleted":
      return productionSectionUpdate(order, {
        field: "productionAlbumDesignStatus",
        previousStatus: order.productionAlbumDesignStatus,
        nextStatus: OrderProductionSectionStatus.COMPLETED,
        productionStatus: inProgressStatus,
        title: "Album design completed",
        description: "Album design was marked completed.",
      });
    case "markSentToPrint":
      return productionSectionUpdate(order, {
        field: "productionPrintingStatus",
        previousStatus: order.productionPrintingStatus,
        nextStatus: OrderProductionSectionStatus.IN_PROGRESS,
        productionStatus: inProgressStatus,
        title: "Sent to print",
        description: "Production was marked sent to print.",
      });
    case "markAssemblyStarted":
      return productionSectionUpdate(order, {
        field: "productionAssemblyStatus",
        previousStatus: order.productionAssemblyStatus,
        nextStatus: OrderProductionSectionStatus.IN_PROGRESS,
        productionStatus: inProgressStatus,
        title: "Album assembly started",
        description: "Album assembly was marked in progress.",
      });
    case "markAssemblyCompleted":
      return productionSectionUpdate(order, {
        field: "productionAssemblyStatus",
        previousStatus: order.productionAssemblyStatus,
        nextStatus: OrderProductionSectionStatus.COMPLETED,
        productionStatus: inProgressStatus,
        title: "Album assembly completed",
        description: "Album assembly was marked completed.",
      });
    case "markVendorInProgress":
      return productionSectionUpdate(order, {
        field: "productionVendorStatus",
        previousStatus: order.productionVendorStatus,
        nextStatus: OrderProductionSectionStatus.IN_PROGRESS,
        productionStatus: OrderProductionStatus.WAITING_FOR_VENDOR,
        title: "Vendor work in progress",
        description: "Outsourced production work was marked in progress.",
      });
    case "markVendorCompleted":
      return productionSectionUpdate(order, {
        field: "productionVendorStatus",
        previousStatus: order.productionVendorStatus,
        nextStatus: OrderProductionSectionStatus.COMPLETED,
        productionStatus: inProgressStatus,
        title: "Vendor work completed",
        description: "Outsourced production work was marked completed.",
      });
    case "markPrintsReady":
      return {
        orderData: {
          productionPrintingStatus: OrderProductionSectionStatus.COMPLETED,
          productionFramedPrintsStatus: OrderProductionSectionStatus.COMPLETED,
          productionStatus: inProgressStatus,
        },
        productionStatus: inProgressStatus,
        title: "Prints ready",
        description: "Printing and framed prints were marked ready.",
        metadata: {
          fields: ["productionPrintingStatus", "productionFramedPrintsStatus"],
          previousPrintingStatus: order.productionPrintingStatus,
          nextPrintingStatus: OrderProductionSectionStatus.COMPLETED,
          previousFramedPrintsStatus: order.productionFramedPrintsStatus,
          nextFramedPrintsStatus: OrderProductionSectionStatus.COMPLETED,
          previousProductionStatus: order.productionStatus,
          nextProductionStatus: inProgressStatus,
        },
      };
    case "markProductionReadyForPickup":
      return {
        orderData: {
          productionFinalStatus: OrderProductionSectionStatus.COMPLETED,
          productionStatus: OrderProductionStatus.READY_FOR_PICKUP,
          deliveryStatus: OrderDeliveryStatus.READY_FOR_PICKUP,
          productionReadyAt: order.productionReadyAt ?? now,
          status: OrderStatus.READY,
        },
        productionStatus: OrderProductionStatus.READY_FOR_PICKUP,
        deliveryStatus: OrderDeliveryStatus.READY_FOR_PICKUP,
        title: "Production ready for pickup",
        description: "Production was marked ready for customer pickup.",
        metadata: {
          field: "productionStatus",
          previousStatus: order.productionStatus,
          nextStatus: OrderProductionStatus.READY_FOR_PICKUP,
          previousDeliveryStatus: order.deliveryStatus,
          nextDeliveryStatus: OrderDeliveryStatus.READY_FOR_PICKUP,
          incompleteSectionsAtReady: hasIncompleteProductionSections(order),
        },
      };
  }
}

function productionSectionUpdate(
  order: ProductionOrderState,
  input: {
    field:
      | "productionAlbumDesignStatus"
      | "productionPrintingStatus"
      | "productionAssemblyStatus"
      | "productionVendorStatus"
      | "productionFramedPrintsStatus";
    previousStatus: OrderProductionSectionStatus;
    nextStatus: OrderProductionSectionStatus;
    productionStatus: OrderProductionStatus;
    title: string;
    description: string;
  }
): ProductionWorkflowUpdate {
  return {
    orderData: {
      [input.field]: input.nextStatus,
      productionStatus: input.productionStatus,
      status: order.status === OrderStatus.READY ? OrderStatus.READY : OrderStatus.PRODUCTION,
    },
    productionStatus: input.productionStatus,
    title: input.title,
    description: input.description,
    metadata: {
      field: input.field,
      previousStatus: input.previousStatus,
      nextStatus: input.nextStatus,
      previousProductionStatus: order.productionStatus,
      nextProductionStatus: input.productionStatus,
      earlyProduction:
        order.editingStatus !== OrderEditingStatus.COMPLETED &&
        order.editingStatus !== OrderEditingStatus.APPROVED,
    },
  };
}

function mapOrderDeliveryWorkflow(order: DeliveryOrderState): OrderDeliveryWorkflow {
  const invoiceSummary = summarizeInvoices(order.invoices);
  const paymentSettled =
    invoiceSummary.paymentStatus === "Paid" || invoiceSummary.paymentStatus === "Overridden";
  const completionBlockers = resolveDeliveryCompletionBlockers(order, paymentSettled);

  return {
    orderId: order.id,
    deliveryStatus: ORDER_DELIVERY_STATUS_LABELS[order.deliveryStatus],
    productionStatus: ORDER_PRODUCTION_STATUS_LABELS[order.productionStatus],
    paymentStatus: invoiceSummary.paymentStatus,
    readyAt: order.productionReadyAt ? formatDateTime(order.productionReadyAt) : null,
    preparedAt: order.deliveryPreparedAt ? formatDateTime(order.deliveryPreparedAt) : null,
    customerNotifiedAt: order.customerNotifiedAt
      ? formatDateTime(order.customerNotifiedAt)
      : null,
    pickedUpAt: order.pickedUpAt ? formatDateTime(order.pickedUpAt) : null,
    completedAt: order.deliveryCompletedAt ? formatDateTime(order.deliveryCompletedAt) : null,
    completedBy: order.deliveryCompletedBy ?? "",
    pickupNotes: order.deliveryPickupNotes ?? "",
    overrideReason: order.deliveryOverrideReason ?? "",
    completionBlockers,
    requiresPaymentOverride: !paymentSettled,
    canPrepareForPickup:
      order.status !== OrderStatus.CANCELLED &&
      order.status !== OrderStatus.DELIVERED &&
      (
        order.deliveryStatus === OrderDeliveryStatus.NOT_READY ||
        (
          order.deliveryStatus === OrderDeliveryStatus.READY_FOR_PICKUP &&
          !order.deliveryPreparedAt
        )
      ) &&
      isProductionReadyForDelivery(order),
    canRecordNotification:
      order.status !== OrderStatus.CANCELLED &&
      order.status !== OrderStatus.DELIVERED &&
      order.deliveryStatus === OrderDeliveryStatus.READY_FOR_PICKUP,
    canMarkPickedUp:
      order.status !== OrderStatus.CANCELLED &&
      order.status !== OrderStatus.DELIVERED &&
      (
        order.deliveryStatus === OrderDeliveryStatus.READY_FOR_PICKUP ||
        order.deliveryStatus === OrderDeliveryStatus.CUSTOMER_NOTIFIED
      ),
    canCompleteOrder:
      order.status !== OrderStatus.CANCELLED &&
      order.status !== OrderStatus.DELIVERED &&
      order.deliveryStatus === OrderDeliveryStatus.PICKED_UP &&
      completionBlockers.every((blocker) => blocker === "Payment needs admin override before completion."),
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
  input: UpdateOrderDeliveryWorkflowInput
): DeliveryWorkflowUpdate {
  const now = new Date();
  const pickupNotes = input.pickupNotes?.trim() || null;

  switch (input.action) {
    case "prepareForPickup": {
      assertProductionReadyForDelivery(order);
      return {
        orderData: {
          deliveryStatus: OrderDeliveryStatus.READY_FOR_PICKUP,
          deliveryPreparedAt: order.deliveryPreparedAt ?? now,
          status: OrderStatus.READY,
        },
        deliveryStatus: OrderDeliveryStatus.READY_FOR_PICKUP,
        title: "Prepared for pickup",
        description: "Order was prepared for customer pickup.",
        metadata: {
          field: "deliveryStatus",
          previousStatus: order.deliveryStatus,
          nextStatus: OrderDeliveryStatus.READY_FOR_PICKUP,
          preparedAt: (order.deliveryPreparedAt ?? now).toISOString(),
        },
      };
    }

    case "recordCustomerNotification": {
      if (order.deliveryStatus !== OrderDeliveryStatus.READY_FOR_PICKUP) {
        throw new Error("Customer notification can only be recorded after pickup readiness");
      }
      return {
        orderData: {
          deliveryStatus: OrderDeliveryStatus.CUSTOMER_NOTIFIED,
          customerNotifiedAt: order.customerNotifiedAt ?? now,
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
        order.deliveryStatus !== OrderDeliveryStatus.CUSTOMER_NOTIFIED
      ) {
        throw new Error("Pickup can only be recorded after delivery is ready");
      }
      return {
        orderData: {
          deliveryStatus: OrderDeliveryStatus.PICKED_UP,
          pickedUpAt: order.pickedUpAt ?? now,
          deliveryPickupNotes: pickupNotes ?? order.deliveryPickupNotes,
        },
        deliveryStatus: OrderDeliveryStatus.PICKED_UP,
        title: "Order picked up",
        description: "Customer pickup was recorded.",
        metadata: {
          field: "deliveryStatus",
          previousStatus: order.deliveryStatus,
          nextStatus: OrderDeliveryStatus.PICKED_UP,
          pickedUpAt: (order.pickedUpAt ?? now).toISOString(),
          pickupNotesUpdated: Boolean(pickupNotes),
        },
      };
    }

    case "completeOrder": {
      if (order.deliveryStatus !== OrderDeliveryStatus.PICKED_UP) {
        throw new Error("Order completion requires recorded pickup");
      }
      assertProductionReadyForDelivery(order);

      const invoiceSummary = summarizeInvoices(order.invoices);
      const paymentSettled =
        invoiceSummary.paymentStatus === "Paid" || invoiceSummary.paymentStatus === "Overridden";
      const completedBy = input.completedBy?.trim();
      if (!completedBy) {
        throw new Error("Completed by is required");
      }

      const overrideReason = input.overrideReason?.trim();
      const paymentOverrideUsed = !paymentSettled;
      if (paymentOverrideUsed && !input.allowPaymentOverride) {
        throw new Error("Payment must be settled or explicitly overridden by admin");
      }
      if (paymentOverrideUsed && !overrideReason) {
        throw new Error("Admin override reason is required when payment is not settled");
      }

      return {
        orderData: {
          deliveryStatus: OrderDeliveryStatus.COMPLETED,
          productionStatus: OrderProductionStatus.COMPLETED,
          deliveryCompletedAt: order.deliveryCompletedAt ?? now,
          deliveryCompletedBy: completedBy,
          deliveryPickupNotes: pickupNotes ?? order.deliveryPickupNotes,
          deliveryOverrideReason: paymentOverrideUsed ? overrideReason : null,
          status: OrderStatus.DELIVERED,
        },
        deliveryStatus: OrderDeliveryStatus.COMPLETED,
        productionStatus: OrderProductionStatus.COMPLETED,
        title: "Delivery completed",
        description: "Order delivery was marked complete.",
        metadata: {
          field: "deliveryStatus",
          previousStatus: order.deliveryStatus,
          nextStatus: OrderDeliveryStatus.COMPLETED,
          previousProductionStatus: order.productionStatus,
          nextProductionStatus: OrderProductionStatus.COMPLETED,
          completedBy,
          completedAt: (order.deliveryCompletedAt ?? now).toISOString(),
          paymentStatus: invoiceSummary.paymentStatus,
          paymentOverrideUsed,
          overrideReason: paymentOverrideUsed ? overrideReason ?? null : null,
          pickupNotesUpdated: Boolean(pickupNotes),
        },
        completed: true,
        paymentOverrideUsed,
      };
    }
  }
}

function resolveDeliveryCompletionBlockers(
  order: DeliveryOrderState,
  paymentSettled: boolean
): string[] {
  const blockers: string[] = [];
  if (!paymentSettled) {
    blockers.push("Payment needs admin override before completion.");
  }
  if (!isProductionReadyForDelivery(order)) {
    blockers.push("Production must be ready and all production sections must be complete.");
  }
  if (order.deliveryStatus !== OrderDeliveryStatus.PICKED_UP) {
    blockers.push("Pickup must be recorded before completion.");
  }
  return blockers;
}

function assertProductionReadyForDelivery(order: DeliveryOrderState): void {
  if (!isProductionReadyForDelivery(order)) {
    throw new Error("Order cannot be completed until production is ready and all production sections are complete");
  }
}

function isProductionReadyForDelivery(order: DeliveryOrderState): boolean {
  return (
    (
      order.productionStatus === OrderProductionStatus.READY_FOR_PICKUP ||
      order.productionStatus === OrderProductionStatus.COMPLETED
    ) &&
    !hasIncompleteDeliveryProductionSections(order)
  );
}

function hasIncompleteDeliveryProductionSections(order: DeliveryOrderState): boolean {
  return [
    order.productionAlbumDesignStatus,
    order.productionPrintingStatus,
    order.productionAssemblyStatus,
    order.productionVendorStatus,
    order.productionFramedPrintsStatus,
    order.productionFinalStatus,
  ].some((status) => status !== OrderProductionSectionStatus.COMPLETED);
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
  basePaymentVerified: boolean
): void {
  if (order.selectionStatus !== OrderSelectionStatus.COMPLETED) {
    throw new Error("Editing cannot start until selection is completed");
  }
  if (!basePaymentVerified) {
    throw new Error("Editing cannot start until base package payment is recorded");
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
  }
): Promise<void> {
  await recordOrderActivity(client, {
    orderId,
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
              publicId: true,
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
        },
      }),
    "Failed to fetch order financial summary"
  );

  if (!order) return null;

  const invoice = order.invoices[0] ?? null;
  const originalPackage = order.originalPackage;
  const finalPackage = order.finalPackage ?? originalPackage;
  const addOns = parseAddOns(order.addOns);
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
    invoicePublicId: invoice?.publicId ?? null,
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
