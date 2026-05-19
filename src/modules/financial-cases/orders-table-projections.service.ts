import {
  InvoiceStatus,
  InvoiceType,
  PaymentDirection,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { db } from "@/lib/db";
import {
  computeOrderSettlementSummary,
  deriveLockedFinancialSidebarSummary,
  deriveSettlementPaidAmount,
} from "@/modules/orders/order-settlement";
import { deriveFinancialCasePaymentStatus } from "./financial-case-payment-status";
import { toOrdersTableRow, type OrdersTableRowProjection } from "./projections";
import type {
  FinancialCaseActiveSummary,
  FinancialCaseDepositInvoiceSummary,
  FinancialCaseInvoiceSummary,
} from "./financial-case-summary.types";

type DbClient = PrismaClient | Prisma.TransactionClient;

type BatchInput = {
  orderIds?: string[];
  financialCaseIds?: string[];
  client?: DbClient;
};

type CaseRow = Awaited<ReturnType<typeof fetchFinancialCaseRows>>[number];
type CaseInvoice = CaseRow["invoices"][number];

export async function getOrdersTableFinancialProjections({
  orderIds = [],
  financialCaseIds = [],
  client = db,
}: BatchInput): Promise<Map<string, OrdersTableRowProjection | null>> {
  const uniqueOrderIds = unique(orderIds);
  const uniqueFinancialCaseIds = unique(financialCaseIds);
  const projectionByOrderId = new Map<string, OrdersTableRowProjection | null>(
    uniqueOrderIds.map((orderId) => [orderId, null])
  );
  if (uniqueOrderIds.length === 0 && uniqueFinancialCaseIds.length === 0) {
    return projectionByOrderId;
  }

  const orderRows =
    uniqueOrderIds.length > 0
      ? await client.order.findMany({
          where: { id: { in: uniqueOrderIds } },
          select: {
            id: true,
            booking: { select: { financialCase: { select: { id: true } } } },
          },
        })
      : [];
  const orderIdByCaseId = new Map<string, string>();
  const caseIds = new Set(uniqueFinancialCaseIds);
  for (const order of orderRows) {
    const financialCaseId = order.booking.financialCase?.id ?? null;
    if (!financialCaseId) continue;
    caseIds.add(financialCaseId);
    orderIdByCaseId.set(financialCaseId, order.id);
  }
  if (caseIds.size === 0) return projectionByOrderId;

  const cases = await fetchFinancialCaseRows([...caseIds], client);
  const effectivePaidByInvoiceId = await fetchEffectivePaidByInvoiceId(
    collectActivePaymentInvoiceIds(cases),
    client
  );

  for (const financialCase of cases) {
    const orderId =
      orderIdByCaseId.get(financialCase.id) ??
      resolveOrderIdFromFinancialCase(financialCase);
    if (!orderId) continue;

    projectionByOrderId.set(
      orderId,
      buildOrdersTableProjection(financialCase, effectivePaidByInvoiceId)
    );
  }

  return projectionByOrderId;
}

function fetchFinancialCaseRows(financialCaseIds: string[], client: DbClient) {
  return client.financialCase.findMany({
    where: { id: { in: financialCaseIds } },
    select: {
      id: true,
      bookingId: true,
      booking: {
        select: {
          order: { select: { id: true } },
        },
      },
      invoices: {
        select: {
          id: true,
          invoiceNumber: true,
          invoiceType: true,
          status: true,
          isLocked: true,
          totalAmount: true,
          paidAmount: true,
          remainingAmount: true,
          orderId: true,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
}

async function fetchEffectivePaidByInvoiceId(
  invoiceIds: string[],
  client: DbClient
): Promise<Map<string, Prisma.Decimal>> {
  const uniqueInvoiceIds = unique(invoiceIds);
  const paidByInvoiceId = new Map<string, Prisma.Decimal>(
    uniqueInvoiceIds.map((invoiceId) => [invoiceId, zeroMoney()])
  );
  if (uniqueInvoiceIds.length === 0) return paidByInvoiceId;

  const [incomingAllocations, outgoingAllocations, documentApplications] =
    await Promise.all([
      client.paymentAllocation.groupBy({
        by: ["invoiceId"],
        where: {
          invoiceId: { in: uniqueInvoiceIds },
          payment: { direction: PaymentDirection.IN },
        },
        _sum: { amount: true },
      }),
      client.paymentAllocation.groupBy({
        by: ["invoiceId"],
        where: {
          invoiceId: { in: uniqueInvoiceIds },
          payment: { direction: PaymentDirection.OUT },
        },
        _sum: { amount: true },
      }),
      client.documentApplication.groupBy({
        by: ["targetInvoiceId"],
        where: { targetInvoiceId: { in: uniqueInvoiceIds } },
        _sum: { amountApplied: true },
      }),
    ]);

  const incomingByInvoiceId = sumByInvoiceId(incomingAllocations);
  const outgoingByInvoiceId = sumByInvoiceId(outgoingAllocations);
  const documentsByInvoiceId = sumByTargetInvoiceId(documentApplications);
  for (const invoiceId of uniqueInvoiceIds) {
    paidByInvoiceId.set(
      invoiceId,
      (incomingByInvoiceId.get(invoiceId) ?? zeroMoney())
        .minus(outgoingByInvoiceId.get(invoiceId) ?? zeroMoney())
        .plus(documentsByInvoiceId.get(invoiceId) ?? zeroMoney())
    );
  }

  return paidByInvoiceId;
}

function buildOrdersTableProjection(
  financialCase: CaseRow,
  effectivePaidByInvoiceId: Map<string, Prisma.Decimal>
): OrdersTableRowProjection | null {
  const finalInvoice = financialCase.invoices.find(
    (invoice) => invoice.invoiceType === InvoiceType.FINAL
  );
  if (!finalInvoice) return null;

  const depositInvoice =
    financialCase.invoices
      .filter((invoice) => invoice.invoiceType === InvoiceType.DEPOSIT)
      .at(-1) ?? null;
  const finalizedAdjustments = financialCase.invoices.filter(
    (invoice) =>
      invoice.invoiceType === InvoiceType.ADJUSTMENT &&
      invoice.status !== InvoiceStatus.DRAFT
  );
  const creditNotes = financialCase.invoices.filter(
    (invoice) => invoice.invoiceType === InvoiceType.CREDIT_NOTE
  );
  const refunds = financialCase.invoices.filter(
    (invoice) => invoice.invoiceType === InvoiceType.REFUND
  );
  const lockedSummary = deriveLockedFinancialSidebarSummary({
    finalInvoice: {
      totalAmount: finalInvoice.totalAmount,
      remainingAmount: finalInvoice.remainingAmount,
      depositPaidAmount: depositInvoice?.paidAmount ?? zeroMoney(),
    },
    finalizedAdjustments: finalizedAdjustments.map((invoice) => ({
      totalAmount: invoice.totalAmount,
      remainingAmount: invoice.remainingAmount,
    })),
    orderId: finalInvoice.orderId ?? undefined,
  });
  const settlementSummary = computeOrderSettlementSummary({
    invoices: financialCase.invoices.map((invoice) => ({
      invoiceType: invoice.invoiceType,
      totalAmount: invoice.totalAmount,
      remainingAmount: invoice.remainingAmount,
    })),
  });
  const effectivePaid = [finalInvoice, ...finalizedAdjustments].reduce(
    (sum, invoice) =>
      sum.plus(effectivePaidByInvoiceId.get(invoice.id) ?? zeroMoney()),
    zeroMoney()
  );
  const summary: FinancialCaseActiveSummary = {
    stage: "active",
    financialCaseId: financialCase.id,
    orderId: finalInvoice.orderId ?? financialCase.booking.order?.id ?? null,
    bookingId: financialCase.bookingId,
    depositInvoice: depositInvoice ? mapDepositInvoiceSummary(depositInvoice) : null,
    finalInvoice: {
      ...mapInvoiceSummary(finalInvoice),
      depositPaidAmount: depositInvoice?.paidAmount.toNumber() ?? 0,
    },
    finalizedAdjustments: finalizedAdjustments.map(mapInvoiceSummary),
    creditNotes: creditNotes.map(mapInvoiceSummary),
    refunds: refunds.map(mapInvoiceSummary),
    customerTotal: lockedSummary.customerTotal,
    effectivePaid: effectivePaid.toNumber(),
    paidSoFar: lockedSummary.paidSoFar,
    depositApplied: 0,
    remaining: lockedSummary.remaining,
    totalAdjustments: lockedSummary.totalAdjustments,
    finalTotal: lockedSummary.finalTotal,
    overpaymentCapacity: 0,
    creditNoteCapacity: 0,
    linkedDocuments: [],
    paymentStatusEnum: deriveFinancialCasePaymentStatus({
      settlementSummary,
      effectivePaid: effectivePaid.toNumber(),
      customerTotal: lockedSummary.customerTotal,
      refunds: refunds.length,
    }),
  };

  return toOrdersTableRow(summary);
}

function collectActivePaymentInvoiceIds(cases: CaseRow[]): string[] {
  return cases.flatMap((financialCase) =>
    financialCase.invoices
      .filter(
        (invoice) =>
          invoice.invoiceType === InvoiceType.FINAL ||
          (invoice.invoiceType === InvoiceType.ADJUSTMENT &&
            invoice.status !== InvoiceStatus.DRAFT)
      )
      .map((invoice) => invoice.id)
  );
}

function resolveOrderIdFromFinancialCase(financialCase: CaseRow): string | null {
  return (
    financialCase.invoices.find((invoice) => invoice.invoiceType === InvoiceType.FINAL)
      ?.orderId ??
    financialCase.booking.order?.id ??
    null
  );
}

function mapInvoiceSummary(invoice: CaseInvoice): FinancialCaseInvoiceSummary {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    invoiceType: invoice.invoiceType,
    total: invoice.totalAmount.toNumber(),
    remaining: invoice.remainingAmount.toNumber(),
    status: invoice.status,
    isLocked: invoice.isLocked,
  };
}

function mapDepositInvoiceSummary(
  invoice: CaseInvoice
): FinancialCaseDepositInvoiceSummary {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    total: invoice.totalAmount.toNumber(),
    status: invoice.status,
    isLocked: invoice.isLocked,
    paidAmount: deriveSettlementPaidAmount(invoice).toNumber(),
  };
}

function sumByInvoiceId(
  rows: Array<{ invoiceId: string; _sum: { amount: Prisma.Decimal | null } }>
): Map<string, Prisma.Decimal> {
  return new Map(
    rows.map((row) => [row.invoiceId, row._sum.amount ?? zeroMoney()])
  );
}

function sumByTargetInvoiceId(
  rows: Array<{
    targetInvoiceId: string;
    _sum: { amountApplied: Prisma.Decimal | null };
  }>
): Map<string, Prisma.Decimal> {
  return new Map(
    rows.map((row) => [
      row.targetInvoiceId,
      row._sum.amountApplied ?? zeroMoney(),
    ])
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function zeroMoney(): Prisma.Decimal {
  return new Prisma.Decimal(0);
}
