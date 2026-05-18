import {
  AuditAction,
  AuditEntityType,
  InvoiceLineType,
  InvoiceStatus,
  InvoiceType,
  MediaType,
  OrderEntityKind,
  OrderActivityType,
  OrderStatus,
  PaymentDirection,
  PaymentMethod,
  Prisma,
  UserRole,
  type Invoice,
} from "@prisma/client";
import type { ActorContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import { recordAuditLog } from "@/modules/audit/audit-log.service";
import {
  BlockedEditError,
  type AdjustmentReversal,
  adjustmentCauseKey,
  classifyEditDelta,
  type OpenAdjustmentLine,
  PendingCreditNoteApprovalError,
} from "@/modules/financial/edit-classifier";
import { assertFinancialCaseInvariants } from "@/modules/financial/invariants";
import { formatCustomerPhone } from "@/modules/customers/customer.utils";
import { PUBLIC_ID_KIND } from "@/modules/identifiers/identifier.constants";
import { generatePublicId } from "@/modules/identifiers/identifier.service";
import {
  invoiceLockSnapshotSelect,
  recordInvoiceLockSnapshot,
} from "@/modules/invoices/invoice-lock.service";
import {
  computeOrderEditDelta,
  type EditDelta,
  type ReductionEvent,
} from "@/modules/orders/order.delta";
import { recordOrderActivity } from "@/modules/orders/order-activity.service";
import { getExtraPhotoUnitPriceWithClient } from "@/modules/pricing/pricing.service";
import {
  priceSelections,
} from "@/modules/session-configurations/session-configuration-pricing";
import {
  pricedSessionConfigurationSelectionSelect,
  resolveOrderSessionConfigurations,
  SessionConfigurationRequiredSelectionMissingError,
} from "@/modules/session-configurations/session-configuration-resolver";
import { computeEffectivePaidFromAllocations } from "./invoice.calculation";
import type {
  CreateAdjustmentInvoiceInput,
  CreateCreditNoteInput,
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
  actorContext: ActorContext;
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
  totalAmount: Prisma.Decimal,
  actorContext: ActorContext
) {
  const beforeInvoice = await client.invoice.findUnique({
    where: { id },
    select: {
      id: true,
      financialCaseId: true,
      orderId: true,
      bookingId: true,
      totalAmount: true,
    },
  });
  if (!beforeInvoice) {
    throw new Error("Invoice not found before update");
  }

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

  await recordAuditLog(client, actorContext, {
    entityType: AuditEntityType.INVOICE,
    entityId: invoice.id,
    action: AuditAction.INVOICE_TOTAL_MUTATED,
    before: { totalAmount: beforeInvoice.totalAmount.toFixed(3) },
    after: { totalAmount: invoice.totalAmount.toFixed(3) },
    context: {
      financialCaseId: beforeInvoice.financialCaseId,
      orderId: beforeInvoice.orderId ?? null,
      bookingId: beforeInvoice.bookingId ?? null,
    },
  });

  return invoice;
}

export async function createInvoiceForOrder(
  orderId: string,
  actorContext: ActorContext
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
  actorContext: ActorContext
): Promise<{ id: string; status: InvoiceStatus }> {
  const order = await client.order.findUnique({
    where: { id: orderId },
    include: {
      customer: { select: { id: true } },
      booking: { select: { financialCase: { select: { id: true } } } },
      packages: {
        include: {
          package: { select: { price: true } },
          sessionConfigurationSelections: {
            select: pricedSessionConfigurationSelectionSelect,
          },
        },
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

  const sessionConfigurationPrice =
    await priceRequiredSessionConfigurationsForOrder(client, order.id);

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
    .plus(extraPhotoCharge)
    .plus(sessionConfigurationPrice.totalDelta);

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
  const sessionConfigurationPrice =
    await priceRequiredSessionConfigurationsForOrder(client, order.id);
  const previousExtraPhotoCharge =
    input.previousExtraPhotoCharge ??
    nextExtraPhotoCharge;
  const previousSelectionAddOnTotal = previousAddOnTotal.plus(previousExtraPhotoCharge);
  const nextSelectionAddOnTotal = nextAddOnTotal.plus(nextExtraPhotoCharge);
  const targetTotalAmount = packagePrice
    .plus(nextSelectionAddOnTotal)
    .plus(sessionConfigurationPrice.totalDelta);
  const packageAdjustmentBaseline = order.packages.reduce(
    (sum, line) =>
      sum.plus(line.originalPackagePriceSnapshot ?? line.package.price),
    new Prisma.Decimal(0)
  );
  const packageAdjustmentAmount = packagePrice.minus(packageAdjustmentBaseline);
  const addOnAdjustmentAmount = nextSelectionAddOnTotal.minus(previousSelectionAddOnTotal);
  const totalAdjustmentAmount = packageAdjustmentAmount.plus(addOnAdjustmentAmount);

  if (existingInvoice?.isLocked) {
    const openAdjustmentLines = await buildOpenAdjustmentLineMap(client, order.id);
    const delta = await computeOrderEditDelta(order.id, client);
    const adjustmentCauseReductions =
      await buildAdjustmentCauseReductions(
        client,
        order.id,
        openAdjustmentLines
      );
    const classifiedDelta: EditDelta = {
      ...delta,
      reductions: [...delta.reductions, ...adjustmentCauseReductions],
    };
    const result = classifyEditDelta(classifiedDelta, openAdjustmentLines);

    if (result.blocked.length > 0) {
      throw new BlockedEditError(result.blocked);
    }

    if (result.netZero && result.adjustmentLines.length === 0) {
      await recordAuditLog(client, input.actorContext, {
        entityType: AuditEntityType.ORDER,
        entityId: order.id,
        action: AuditAction.ORDER_LOCKED_FIELD_MUTATED,
        before: {
          swaps: delta.swaps.map((swap) => ({
            removedName: swap.removedLineSnapshot.name,
          })),
        },
        after: {
          swaps: delta.swaps.map((swap) => ({
            addedName: swap.addedLineSnapshot.name,
            amount: swap.addedPriceSnapshot.toFixed(3),
          })),
        },
        context: {
          financialCaseId,
          invoiceId: existingInvoice.id,
        },
      });

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
    let adjustmentReversalCreditNotes: Invoice[] = [];
    if (
      result.creditNoteRequired.length > 0 ||
      result.adjustmentReversals.length > 0
    ) {
      if (!input.managerApprovedReductionByUserId) {
        throw new PendingCreditNoteApprovalError(
          [
            ...result.creditNoteRequired,
            ...result.adjustmentReversals.map((reversal) => ({
              reason: "REMOVED_ADDON" as const,
              amount: reversal.amount,
              lineSnapshot: reversal.lineSnapshot,
            })),
          ],
          result.adjustmentLines
        );
      }
    }

    if (result.creditNoteRequired.length > 0) {
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
          createdByUserId: input.managerApprovedReductionByUserId!,
        },
        client
      );
    }

    if (result.adjustmentReversals.length > 0) {
      adjustmentReversalCreditNotes = await applyAdjustmentReversalsWithClient({
        client,
        orderId: order.id,
        reversals: result.adjustmentReversals,
        createdByUserId: input.managerApprovedReductionByUserId!,
        reason:
          input.managerApprovedReason?.trim() ||
          "Adjustment reversal from order edit",
      });
    }

    if (result.adjustmentLines.length > 0) {
      adjustmentInvoice = await createAdjustmentInvoice(
        {
          parentFinalInvoiceId: existingInvoice.id,
          lines: result.adjustmentLines,
          notes: `Auto-ADJUSTMENT from order edit on ${new Date().toISOString()}`,
          createdByUserId: input.managerApprovedReductionByUserId ?? input.actorContext.actorUserId,
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
          adjustmentReversals: result.adjustmentReversals.map((reversal) => ({
            adjustmentInvoiceId: reversal.causingInvoiceId,
            adjustmentInvoiceLineId: reversal.causingInvoiceLineId,
            amount: reversal.amount.toFixed(3),
            lineName: reversal.lineSnapshot.name,
            requiresRefund: reversal.requiresRefund,
          })),
        },
      });
    }

    if (adjustmentReversalCreditNotes.length > 0 && !creditNoteInvoice) {
      await recordOrderActivity(client, {
        orderId: order.id,
        userId: input.managerApprovedReductionByUserId ?? null,
        type: OrderActivityType.INVOICE_ADJUSTED,
        title: "Classifier adjustment reversal issued",
        description: `${adjustmentReversalCreditNotes.length} adjustment reversal credit note(s) issued.`,
        metadata: {
          parentInvoiceId: existingInvoice.id,
          creditNoteInvoiceIds: adjustmentReversalCreditNotes.map(
            (invoice) => invoice.id
          ),
          creditNoteInvoiceNumbers: adjustmentReversalCreditNotes.map(
            (invoice) => invoice.invoiceNumber
          ),
          totalAmount: adjustmentReversalCreditNotes
            .reduce(
              (sum, invoice) => sum.plus(invoice.totalAmount),
              new Prisma.Decimal(0)
            )
            .toFixed(3),
          adjustmentReversals: result.adjustmentReversals.map((reversal) => ({
            adjustmentInvoiceId: reversal.causingInvoiceId,
            adjustmentInvoiceLineId: reversal.causingInvoiceLineId,
            amount: reversal.amount.toFixed(3),
            lineName: reversal.lineSnapshot.name,
            requiresRefund: reversal.requiresRefund,
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
    ? await updateUnlockedInvoiceTotal(
        client,
        existingInvoice.id,
        targetTotalAmount,
        input.actorContext
      )
    : await createSyncedOrderInvoice(client, {
        orderId: order.id,
        bookingId: order.bookingId,
        financialCaseId,
        customerId: order.customer.id,
        jobId: order.jobId,
        jobNumber: order.jobNumber,
        totalAmount: targetTotalAmount,
        actorContext: input.actorContext,
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
      settledAmount: formatMoney(computeDisplaySettledAmount(row)),
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
      ? await buildInvoiceLineItems(db, row.orderId, row.id)
      : null;
  const depositInvoice =
    row.invoiceType === InvoiceType.FINAL && row.financialCaseId
      ? await findDepositInvoiceForFinancialCase(row.financialCaseId)
      : null;
  const overpaymentCapacity =
    row.isLocked &&
    (row.invoiceType === InvoiceType.FINAL ||
      row.invoiceType === InvoiceType.ADJUSTMENT)
      ? await computeOverpaymentCapacity(row.id, db)
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
    settledAmount: formatMoney(computeDisplaySettledAmount(row)),
    remainingAmount: formatMoney(row.remainingAmount),
    depositInvoiceNumber: depositInvoice?.invoiceNumber ?? null,
    depositPaidAmount: depositInvoice ? formatMoney(depositInvoice.paidAmount) : null,
    overpaymentCapacity: overpaymentCapacity
      ? formatMoney(overpaymentCapacity)
      : null,
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
  actorContext: ActorContext
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
  actorContext: ActorContext
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

  const lineItems = await buildInvoiceLineItems(client, orderId, invoiceId);
  if (lineItems.length === 0) return;

  await client.invoiceLineItem.createMany({
    data: lineItems.map((item) => ({ invoiceId, ...item })),
    skipDuplicates: true,
  });
}

export async function closeInvoice(
  id: string,
  actorContext: ActorContext
): Promise<void> {
  await withRetry(
    () =>
      db.$transaction(async (tx) => {
        const invoice = await tx.invoice.findUnique({
          where: { id },
          select: {
            ...invoiceLockSnapshotSelect,
            id: true,
            invoiceNumber: true,
            orderId: true,
            bookingId: true,
            financialCaseId: true,
            isLocked: true,
            status: true,
            closedAt: true,
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

        const closedAt = new Date();
        const updateResult = await tx.invoice.updateMany({
          where: { id, isLocked: false },
          data: {
            status: InvoiceStatus.CLOSED,
            isLocked: true,
            closedAt,
          },
        });
        if (updateResult.count === 0) {
          throw new Error("Invoice is already locked");
        }

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
    actorContext: ActorContext;
  }
) {
  const existingInvoice = await findPrimaryWorkflowInvoiceForOrder(client, {
    financialCaseId: data.financialCaseId,
  });
  if (existingInvoice) {
    const beforeInvoice = await client.invoice.findUnique({
      where: { id: existingInvoice.id },
      select: {
        id: true,
        financialCaseId: true,
        orderId: true,
        bookingId: true,
        totalAmount: true,
      },
    });
    if (!beforeInvoice) {
      throw new Error("Invoice not found before update");
    }

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

    await recordAuditLog(client, data.actorContext, {
      entityType: AuditEntityType.INVOICE,
      entityId: refreshedInvoice.id,
      action: AuditAction.INVOICE_TOTAL_MUTATED,
      before: { totalAmount: beforeInvoice.totalAmount.toFixed(3) },
      after: { totalAmount: refreshedInvoice.totalAmount.toFixed(3) },
      context: {
        financialCaseId: beforeInvoice.financialCaseId,
        orderId: beforeInvoice.orderId ?? null,
        bookingId: beforeInvoice.bookingId ?? null,
      },
    });

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

  const existingApplication = await client.documentApplication.findFirst({
    where: {
      sourceInvoiceId: depositInvoice.id,
      targetInvoiceId: finalInvoiceId,
      targetInvoiceLineId: null,
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
  orderId: string,
  invoiceId?: string
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
          sessionConfigurationSelections: {
            select: pricedSessionConfigurationSelectionSelect,
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

  for (const orderPackage of order.packages) {
    const pricedSelections = priceSelections(
      orderPackage.sessionConfigurationSelections
    );
    const emittedLineTotal = pricedSelections.lineItems.reduce(
      (sum, line) => sum.plus(line.lineTotal),
      new Prisma.Decimal(0)
    );
    if (
      !emittedLineTotal
        .plus(pricedSelections.nonLineDelta)
        .equals(pricedSelections.totalDelta)
    ) {
      console.warn(
        JSON.stringify({
          event: "invoice.session_configuration_line_delta_discrepancy",
          invoiceId: invoiceId ?? null,
          orderId,
          orderPackageId: orderPackage.id,
          selectionIds: orderPackage.sessionConfigurationSelections.map(
            (selection) => selection.id
          ),
        })
      );
    }

    for (const lineItem of pricedSelections.lineItems) {
      lines.push({
        ...lineItem,
        sortOrder: sortOrder++,
      });
      recordInvoiceCounter("invoice.session_configuration_lines_emitted", {
        orderId,
        orderPackageId: orderPackage.id,
        selectionId: lineItem.causeOrderEntityId,
      });
    }
  }

  return lines;
}

function createLineItem({
  lineType,
  description,
  quantity = 1,
  unitPrice,
  sortOrder,
  causeOrderEntityKind,
  causeOrderEntityId,
}: {
  lineType: InvoiceLineType;
  description: string;
  quantity?: number;
  unitPrice: Prisma.Decimal;
  sortOrder: number;
  causeOrderEntityKind?: OrderEntityKind;
  causeOrderEntityId?: string;
}): SnapshotInvoiceLineItem {
  return {
    lineType,
    description,
    quantity,
    unitPrice,
    lineTotal: unitPrice.mul(quantity),
    sortOrder,
    ...(causeOrderEntityKind && causeOrderEntityId
      ? { causeOrderEntityKind, causeOrderEntityId }
      : {}),
  };
}

function recordInvoiceCounter(
  metric: string,
  fields: Record<string, string | number | null>
): void {
  console.info(JSON.stringify({ metric, ...fields }));
}

async function priceRequiredSessionConfigurationsForOrder(
  client: DbClient,
  orderId: string
): Promise<ReturnType<typeof priceSelections>> {
  const resolvedSessionConfigurations = await resolveOrderSessionConfigurations(
    client,
    orderId
  );
  const missingRequiredSelections = resolvedSessionConfigurations
    .filter((config) => config.missingRequiredConfigurationCodes.length > 0)
    .map((config) => ({
      orderPackageId: config.orderPackageId,
      missingConfigurationCodes: config.missingRequiredConfigurationCodes,
    }));
  if (missingRequiredSelections.length > 0) {
    recordInvoiceCounter("invoice.session_configuration_required_block", {
      orderId,
      count: missingRequiredSelections.length,
    });
    throw new SessionConfigurationRequiredSelectionMissingError(
      missingRequiredSelections
    );
  }

  return priceSelections(
    resolvedSessionConfigurations.flatMap((config) => config.selections)
  );
}

async function buildOpenAdjustmentLineMap(
  client: DbClient,
  orderId: string
): Promise<Map<string, OpenAdjustmentLine[]>> {
  const adjustmentLines = await client.invoiceLineItem.findMany({
    where: {
      invoice: {
        orderId,
        invoiceType: InvoiceType.ADJUSTMENT,
      },
      causeOrderEntityKind: { not: null },
      causeOrderEntityId: { not: null },
    },
    select: {
      id: true,
      invoiceId: true,
      description: true,
      lineTotal: true,
      causeOrderEntityKind: true,
      causeOrderEntityId: true,
      invoice: {
        select: {
          paymentAllocations: {
            where: { payment: { direction: PaymentDirection.IN } },
            select: { amount: true },
          },
          lineItems: {
            select: { id: true, lineTotal: true },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const openLines = new Map<string, OpenAdjustmentLine[]>();
  for (const line of adjustmentLines) {
    if (!line.causeOrderEntityKind || !line.causeOrderEntityId) continue;

    const credited = await client.documentApplication.aggregate({
      _sum: { amountApplied: true },
      where: {
        targetInvoiceLineId: line.id,
        sourceInvoice: { invoiceType: InvoiceType.CREDIT_NOTE },
      },
    });
    const creditedAmount = credited._sum.amountApplied ?? new Prisma.Decimal(0);
    const remainingAmount = Prisma.Decimal.max(
      line.lineTotal.minus(creditedAmount),
      0
    );
    if (remainingAmount.lessThanOrEqualTo(0)) continue;

    const invoicePaidAmount = line.invoice.paymentAllocations.reduce(
      (sum, allocation) => sum.plus(allocation.amount),
      new Prisma.Decimal(0)
    );
    let paidAmount = new Prisma.Decimal(0);
    let remainingPaidAmount = invoicePaidAmount;
    for (const invoiceLine of line.invoice.lineItems) {
      const linePaidAmount = Prisma.Decimal.min(
        remainingPaidAmount,
        invoiceLine.lineTotal
      );
      if (invoiceLine.id === line.id) {
        paidAmount = linePaidAmount;
        break;
      }
      remainingPaidAmount = Prisma.Decimal.max(
        remainingPaidAmount.minus(invoiceLine.lineTotal),
        0
      );
    }
    const key = adjustmentCauseKey(
      line.causeOrderEntityKind,
      line.causeOrderEntityId
    );
    const bucket = openLines.get(key) ?? [];
    bucket.push({
      invoiceLineId: line.id,
      invoiceId: line.invoiceId,
      causeOrderEntityKind: line.causeOrderEntityKind,
      causeOrderEntityId: line.causeOrderEntityId,
      lineAmount: line.lineTotal,
      remainingAmount,
      isPaid: paidAmount.greaterThan(0),
      lineSnapshot: { name: line.description },
    });
    openLines.set(key, bucket);
  }

  return openLines;
}

async function buildAdjustmentCauseReductions(
  client: DbClient,
  orderId: string,
  openAdjustmentLines: ReadonlyMap<string, readonly OpenAdjustmentLine[]>
): Promise<ReductionEvent[]> {
  if (openAdjustmentLines.size === 0) return [];

  const flattenedOpenAdjustmentLines = [...openAdjustmentLines.values()].flat();
  const currentAmounts = await buildCurrentAdjustmentCauseAmounts(
    client,
    orderId,
    flattenedOpenAdjustmentLines
  );
  const reductions: ReductionEvent[] = [];

  for (const [key, lines] of openAdjustmentLines.entries()) {
    const firstLine = lines[0];
    if (!firstLine) continue;

    const currentAmount =
      currentAmounts.get(key) ?? new Prisma.Decimal(0);
    const totalRemainingAmount = lines.reduce(
      (sum, line) => sum.plus(line.remainingAmount),
      new Prisma.Decimal(0)
    );
    const removedAmount = totalRemainingAmount.minus(currentAmount);
    if (removedAmount.lessThanOrEqualTo(0)) continue;

    const reversalAmount = removedAmount.lessThan(totalRemainingAmount)
      ? removedAmount
      : totalRemainingAmount;
    if (reversalAmount.lessThanOrEqualTo(0)) continue;

    reductions.push(
      toAdjustmentCauseReduction({
        line: firstLine,
        amount: reversalAmount,
      })
    );
  }

  return reductions;
}

async function buildCurrentAdjustmentCauseAmounts(
  client: DbClient,
  orderId: string,
  openAdjustmentLines: OpenAdjustmentLine[]
): Promise<Map<string, Prisma.Decimal>> {
  const amounts = new Map<string, Prisma.Decimal>();
  const addOnIds = openAdjustmentLines
    .filter((line) => line.causeOrderEntityKind === OrderEntityKind.ADDON)
    .map((line) => line.causeOrderEntityId);
  const upgradeIds = openAdjustmentLines
    .filter((line) => line.causeOrderEntityKind === OrderEntityKind.UPGRADE)
    .map((line) => line.causeOrderEntityId);

  const [addOns, upgrades, order] = await Promise.all([
    addOnIds.length > 0
      ? client.orderAddOn.findMany({
          where: { orderId, id: { in: addOnIds } },
          select: { id: true, priceSnapshot: true, quantity: true },
        })
      : Promise.resolve([]),
    upgradeIds.length > 0
      ? client.orderPackageItemUpgrade.findMany({
          where: { orderId, id: { in: upgradeIds } },
          select: { id: true, priceSnapshot: true, quantity: true },
        })
      : Promise.resolve([]),
    client.order.findUnique({
      where: { id: orderId },
      select: {
        packages: {
          select: {
            originalPackagePriceSnapshot: true,
            finalPackagePriceSnapshot: true,
            sessionTypeId: true,
            extraDigitalCount: true,
            extraPrintCount: true,
            package: { select: { name: true, price: true } },
          },
        },
      },
    }),
  ]);

  for (const addOn of addOns) {
    amounts.set(
      adjustmentCauseKey(OrderEntityKind.ADDON, addOn.id),
      addOn.priceSnapshot.mul(addOn.quantity)
    );
  }
  for (const upgrade of upgrades) {
    amounts.set(
      adjustmentCauseKey(OrderEntityKind.UPGRADE, upgrade.id),
      upgrade.priceSnapshot.mul(upgrade.quantity)
    );
  }

  const packageTierCause = openAdjustmentLines.find(
    (line) => line.causeOrderEntityKind === OrderEntityKind.PACKAGE_TIER_UPGRADE
  );
  if (packageTierCause && order) {
    const currentPackageUpgradeAmount = order.packages.reduce((sum, line) => {
      const original = line.originalPackagePriceSnapshot ?? line.package.price;
      const current = line.finalPackagePriceSnapshot ?? line.package.price;
      return sum.plus(current.minus(original));
    }, new Prisma.Decimal(0));
    amounts.set(
      adjustmentCauseKey(
        OrderEntityKind.PACKAGE_TIER_UPGRADE,
        packageTierCause.causeOrderEntityId
      ),
      Prisma.Decimal.max(currentPackageUpgradeAmount, 0)
    );
  }

  const extraPhotoCauses = openAdjustmentLines.filter(
    (line) => line.causeOrderEntityKind === OrderEntityKind.EXTRA_PHOTO
  );
  if (extraPhotoCauses.length > 0 && order) {
    const extraPhotoAmounts = new Map<string, Prisma.Decimal>();
    for (const orderPackage of order.packages) {
      for (const mediaType of [MediaType.DIGITAL, MediaType.PRINT] as const) {
        const quantity =
          mediaType === MediaType.DIGITAL
            ? orderPackage.extraDigitalCount
            : orderPackage.extraPrintCount;
        if (quantity <= 0) continue;

        const description = `Extra photos - ${formatEnum(mediaType)} (${orderPackage.package.name})`;
        const unitPrice = await getExtraPhotoUnitPriceWithClient(
          client,
          orderPackage.sessionTypeId,
          mediaType
        );
        extraPhotoAmounts.set(
          description,
          (extraPhotoAmounts.get(description) ?? new Prisma.Decimal(0)).plus(
            unitPrice.mul(quantity)
          )
        );
      }
    }

    for (const line of extraPhotoCauses) {
      amounts.set(
        adjustmentCauseKey(OrderEntityKind.EXTRA_PHOTO, line.causeOrderEntityId),
        extraPhotoAmounts.get(line.causeOrderEntityId) ?? new Prisma.Decimal(0)
      );
    }
  }

  return amounts;
}

function toAdjustmentCauseReduction({
  line,
  amount,
}: {
  line: OpenAdjustmentLine;
  amount: Prisma.Decimal;
}): ReductionEvent {
  const adjustmentCause = {
    causeOrderEntityKind: line.causeOrderEntityKind,
    causeOrderEntityId: line.causeOrderEntityId,
  };

  if (line.causeOrderEntityKind === OrderEntityKind.UPGRADE) {
    return {
      kind: "REMOVED_UPGRADE",
      lineSnapshot: { name: line.lineSnapshot.name, totalValue: amount },
      adjustmentCause,
      amountOverride: amount,
    };
  }

  if (line.causeOrderEntityKind === OrderEntityKind.EXTRA_PHOTO) {
    return {
      kind: "REMOVED_EXTRA_PHOTO",
      lineSnapshot: { name: line.lineSnapshot.name, totalValue: amount },
      adjustmentCause,
      amountOverride: amount,
    };
  }

  if (line.causeOrderEntityKind === OrderEntityKind.PACKAGE_TIER_UPGRADE) {
    return {
      kind: "PACKAGE_TIER_DOWNGRADE",
      oldPriceSnapshot: amount,
      newPriceSnapshot: new Prisma.Decimal(0),
      adjustmentCause,
      amountOverride: amount,
    };
  }

  return {
    kind: "REMOVED_ADDON",
    lineSnapshot: { name: line.lineSnapshot.name, totalValue: amount },
    adjustmentCause,
    amountOverride: amount,
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
      causeOrderEntityKind: line.causeOrderEntityKind,
      causeOrderEntityId: line.causeOrderEntityId,
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
  if (!input.createdByUserId) {
    throw new Error("createdByUserId is required to issue an adjustment invoice");
  }
  const auditActorContext = await assertManagerApprovalActor(
    client,
    input.createdByUserId,
    "Manager permission is required to issue an adjustment invoice"
  );

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

  await recordAuditLog(client, auditActorContext, {
    entityType: AuditEntityType.INVOICE,
    entityId: invoice.id,
    action: AuditAction.ADJUSTMENT_ISSUED,
    after: {
      adjustmentInvoiceId: invoice.id,
      parentFinalInvoiceId: parent.id,
      lines: input.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: new Prisma.Decimal(line.unitPrice).toFixed(3),
      })),
    },
    context: {
      financialCaseId: parent.financialCaseId,
      orderId: parent.orderId ?? null,
      bookingId: parent.bookingId ?? null,
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

async function assertManagerApprovalActor(
  client: DbClient,
  userId: string,
  message: string
): Promise<ActorContext> {
  const actor = await client.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (
    !actor ||
    (actor.role !== UserRole.ADMIN && actor.role !== UserRole.MANAGER)
  ) {
    throw new Error(message);
  }

  return { actorUserId: actor.id, actorRole: actor.role };
}

export async function computeOverpaymentCapacity(
  sourceInvoiceId: string,
  client: DbClient = db
): Promise<Prisma.Decimal> {
  const source = await client.invoice.findUnique({
    where: { id: sourceInvoiceId },
    select: { id: true, totalAmount: true },
  });

  if (!source) throw new Error("Invoice not found");

  const [effectivePaid, priorRefunds] = await Promise.all([
    computeEffectivePaidFromAllocations(sourceInvoiceId, client),
    client.invoice.aggregate({
      _sum: { totalAmount: true },
      where: {
        parentInvoiceId: sourceInvoiceId,
        invoiceType: InvoiceType.REFUND,
      },
    }),
  ]);
  const refunded = priorRefunds._sum.totalAmount ?? new Prisma.Decimal(0);

  return Prisma.Decimal.max(
    effectivePaid.minus(source.totalAmount).minus(refunded),
    0
  );
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
      lineType: line.lineType ?? InvoiceLineType.MANUAL_DISCOUNT,
      description,
      quantity: line.quantity,
      unitPrice,
      sortOrder: index,
      causeOrderEntityKind: line.causeOrderEntityKind,
      causeOrderEntityId: line.causeOrderEntityId,
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
  const auditActorContext: ActorContext = {
    actorUserId: actor.id,
    actorRole: actor.role,
  };

  const targetInvoiceId = input.targetFinalInvoiceId ?? input.targetAdjustmentInvoiceId;
  if (!targetInvoiceId) {
    throw new Error("Credit note target invoice is required");
  }
  if (input.targetFinalInvoiceId && input.targetAdjustmentInvoiceId) {
    throw new Error("Credit note can only target one invoice");
  }

  const target = await client.invoice.findUnique({
    where: { id: targetInvoiceId },
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
  if (input.targetFinalInvoiceId && target.invoiceType !== InvoiceType.FINAL) {
    throw new Error("Credit notes can only target final invoices");
  }
  if (
    input.targetAdjustmentInvoiceId &&
    target.invoiceType !== InvoiceType.ADJUSTMENT
  ) {
    throw new Error("Adjustment credit notes can only target adjustment invoices");
  }
  if (target.invoiceType === InvoiceType.FINAL && !target.isLocked) {
    throw new Error("Credit notes can only target locked invoices");
  }

  const hasPartialLineTarget = input.lines.some(
    (line) => Boolean(line.targetInvoiceId) !== Boolean(line.targetInvoiceLineId)
  );
  if (hasPartialLineTarget) {
    throw new Error("Credit note line targets require invoice and line ids");
  }

  const lineTargetedApplications = input.lines.filter(
    (line) => line.targetInvoiceId && line.targetInvoiceLineId
  );
  if (
    lineTargetedApplications.length > 0 &&
    lineTargetedApplications.length !== input.lines.length
  ) {
    throw new Error("Credit note line targets must be provided for every line");
  }
  if (
    target.invoiceType === InvoiceType.ADJUSTMENT &&
    lineTargetedApplications.length !== input.lines.length
  ) {
    throw new Error("Adjustment credit notes require line-targeted applications");
  }
  if (lineTargetedApplications.length > 0) {
    const targetLineIds = lineTargetedApplications.map(
      (line) => line.targetInvoiceLineId!
    );
    const targetLines = await client.invoiceLineItem.findMany({
      where: { id: { in: targetLineIds } },
      select: {
        id: true,
        invoiceId: true,
        invoice: {
          select: {
            invoiceType: true,
            financialCaseId: true,
            orderId: true,
          },
        },
      },
    });
    const targetLineById = new Map(targetLines.map((line) => [line.id, line]));
    for (const line of lineTargetedApplications) {
      const targetLine = targetLineById.get(line.targetInvoiceLineId!);
      if (!targetLine) {
        throw new Error("Credit note target line was not found");
      }
      if (targetLine.invoiceId !== line.targetInvoiceId) {
        throw new Error("Credit note target line does not belong to target invoice");
      }
      if (targetLine.invoice.invoiceType !== InvoiceType.ADJUSTMENT) {
        throw new Error("Line-targeted credit notes can only target adjustment lines");
      }
      if (
        targetLine.invoice.financialCaseId !== target.financialCaseId ||
        targetLine.invoice.orderId !== target.orderId
      ) {
        throw new Error("Credit note line target must belong to the same order");
      }
    }
  }

  if (target.invoiceType === InvoiceType.FINAL) {
    const creditCapacity = await computeCreditNoteCapacityForFinal(target.id, client);
    if (totalAmount.greaterThan(creditCapacity)) {
      throw new Error(
        `Credit note amount cannot exceed remaining credit capacity (${creditCapacity.toFixed(3)} KD)`
      );
    }
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

  await recordInvoiceLockSnapshot(client, creditNote, input.createdByUserId);

  if (lineTargetedApplications.length > 0) {
    await client.documentApplication.createMany({
      data: lineTargetedApplications.map((line) => ({
        sourceInvoiceId: creditNote.id,
        targetInvoiceId: line.targetInvoiceId!,
        targetInvoiceLineId: line.targetInvoiceLineId!,
        amountApplied: new Prisma.Decimal(line.unitPrice).mul(line.quantity),
        appliedAt: now,
        appliedByUserId: input.createdByUserId,
        notes: `Credit note for reason: ${reason}`,
      })),
    });
  } else {
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
  }

  await recordAuditLog(client, auditActorContext, {
    entityType: AuditEntityType.CREDIT_NOTE,
    entityId: creditNote.id,
    action: AuditAction.CREDIT_NOTE_ISSUED,
    after: {
      creditNoteInvoiceId: creditNote.id,
      targetInvoiceId: target.id,
      lines: input.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: new Prisma.Decimal(line.unitPrice).toFixed(3),
        targetInvoiceId: line.targetInvoiceId ?? null,
        targetInvoiceLineId: line.targetInvoiceLineId ?? null,
      })),
      managerApprovedReductionByUserId: input.createdByUserId,
    },
    context: {
      financialCaseId: target.financialCaseId,
      orderId: target.orderId ?? null,
      bookingId: target.bookingId ?? null,
      targetInvoiceId: target.id,
    },
  });

  const targetInvoiceIdsToRecalculate = new Set([
    target.id,
    ...lineTargetedApplications
      .map((line) => line.targetInvoiceId)
      .filter((id): id is string => Boolean(id)),
  ]);
  for (const targetInvoiceIdToRecalculate of targetInvoiceIdsToRecalculate) {
    await recalculateInvoiceStatus(targetInvoiceIdToRecalculate, client);
  }
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

async function applyAdjustmentReversalsWithClient({
  client,
  orderId,
  reversals,
  createdByUserId,
  reason,
}: {
  client: DbClient;
  orderId: string;
  reversals: AdjustmentReversal[];
  createdByUserId: string;
  reason: string;
}): Promise<Invoice[]> {
  if (reversals.length === 0) return [];

  const reversalInputs = [];
  for (const reversal of reversals) {
    const causingLine = await client.invoiceLineItem.findUnique({
      where: { id: reversal.causingInvoiceLineId },
      select: {
        id: true,
        invoiceId: true,
        lineType: true,
        description: true,
        causeOrderEntityKind: true,
        causeOrderEntityId: true,
        invoice: {
          select: {
            id: true,
            financialCaseId: true,
            invoiceNumber: true,
            invoiceType: true,
            orderId: true,
            bookingId: true,
            customerId: true,
            jobId: true,
            jobNumber: true,
          },
        },
      },
    });
    if (!causingLine) {
      throw new Error("Adjustment line to reverse was not found");
    }
    if (
      causingLine.invoice.invoiceType !== InvoiceType.ADJUSTMENT ||
      causingLine.invoice.orderId !== orderId
    ) {
      throw new Error("Adjustment reversal must target an order adjustment line");
    }

    reversalInputs.push({
      reversal,
      causingLine,
    });
  }

  const firstReversal = reversalInputs[0];
  if (!firstReversal) return [];
  const now = new Date();
  const creditNote = await createCreditNote(
    {
      targetAdjustmentInvoiceId: firstReversal.causingLine.invoice.id,
      lines: reversalInputs.map(({ reversal, causingLine }) => ({
        lineType: causingLine.lineType,
        description: `Reversal: ${reversal.lineSnapshot.name}`,
        quantity: 1,
        unitPrice: reversal.amount,
        causeOrderEntityKind:
          causingLine.causeOrderEntityKind ?? reversal.causeOrderEntityKind,
        causeOrderEntityId:
          causingLine.causeOrderEntityId ?? reversal.causeOrderEntityId,
        targetInvoiceId: causingLine.invoice.id,
        targetInvoiceLineId: causingLine.id,
      })),
      reason,
      notes: `Auto-CREDIT_NOTE adjustment reversal from order edit on ${now.toISOString()}`,
      createdByUserId,
    },
    client
  );

  for (const { reversal, causingLine } of reversalInputs) {
    if (reversal.requiresRefund) {
      const sourcePayment = await client.payment.findFirst({
        where: {
          invoiceId: causingLine.invoice.id,
          financialCaseId: causingLine.invoice.financialCaseId,
          direction: PaymentDirection.IN,
          allocations: { some: { invoiceId: causingLine.invoice.id } },
        },
        select: { id: true, method: true },
        orderBy: { paidAt: "asc" },
      });
      if (!sourcePayment) {
        throw new Error("Paid adjustment reversal could not find a source payment");
      }

      const { issueRefundWithPayment } = await import(
        "@/modules/refunds/refund.service"
      );
      await issueRefundWithPayment(
        {
          sourceInvoiceId: causingLine.invoice.id,
          amount: reversal.amount,
          reason: `Adjustment reversal: ${reversal.lineSnapshot.name}`,
          createdByUserId,
          method: sourcePayment.method ?? PaymentMethod.CASH,
          refundOfPaymentId: sourcePayment.id,
          notes: `Auto-REFUND from adjustment reversal on ${now.toISOString()}`,
        },
        client
      );
    }

    if (causingLine.invoice.orderId) {
      await recordOrderActivity(client, {
        orderId: causingLine.invoice.orderId,
        userId: createdByUserId,
        type: OrderActivityType.INVOICE_ADJUSTED,
        title: "Adjustment reversal credit note issued",
        description: `Credit note ${creditNote.invoiceNumber} reversed ${reversal.amount.toFixed(3)} KD from ${causingLine.invoice.invoiceNumber}.`,
        metadata: {
          adjustmentInvoiceId: causingLine.invoice.id,
          adjustmentInvoiceLineId: causingLine.id,
          creditNoteInvoiceId: creditNote.id,
          creditNoteInvoiceNumber: creditNote.invoiceNumber,
          amount: reversal.amount.toFixed(3),
          requiresRefund: reversal.requiresRefund,
          causeOrderEntityKind: reversal.causeOrderEntityKind,
          causeOrderEntityId: reversal.causeOrderEntityId,
        },
      });
    }

    await assertFinancialCaseInvariants(causingLine.invoice.financialCaseId, client);
  }

  return [creditNote];
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

function computeDisplaySettledAmount(invoice: {
  totalAmount: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
}): Prisma.Decimal {
  return Prisma.Decimal.max(invoice.totalAmount.minus(invoice.remainingAmount), 0);
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
