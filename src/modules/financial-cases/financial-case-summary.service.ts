import { InvoiceType, Prisma, type PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import {
  computeEffectivePaidFromAllocations,
} from "@/modules/invoices/invoice.calculation";
import {
  computeCreditNoteCapacityForFinal,
  computeOverpaymentCapacity,
} from "@/modules/invoices/invoice.service";
import { deriveFinancialCasePaymentStatus } from "./financial-case-payment-status";
import {
  computeOrderSettlementSummary,
  deriveLockedFinancialSidebarSummary,
  deriveSettlementPaidAmount,
} from "@/modules/orders/order-settlement";
import type { LinkedFinancialDocument } from "@/modules/orders/order.types";
import type {
  FinancialCaseInvoiceSummary,
  FinancialCaseSummary,
  FinancialCaseSummaryInput,
} from "./financial-case-summary.types";

type DbClient = PrismaClient | Prisma.TransactionClient;

type CaseRow = NonNullable<Awaited<ReturnType<typeof fetchFinancialCaseRow>>>;

const LINKED_DOCUMENT_TYPES = [
  InvoiceType.DEPOSIT,
  InvoiceType.FINAL,
  InvoiceType.ADJUSTMENT,
  InvoiceType.REFUND,
  InvoiceType.CREDIT_NOTE,
] as const;

export async function getFinancialCaseSummary(
  input: FinancialCaseSummaryInput,
  client: DbClient = db
): Promise<FinancialCaseSummary | null> {
  const financialCaseId = await resolveFinancialCaseId(input, client);
  if (!financialCaseId) return null;

  const financialCase = await fetchFinancialCaseRow(financialCaseId, client);
  if (!financialCase) return null;

  const finalInvoice = financialCase.invoices.find(
    (invoice) => invoice.invoiceType === InvoiceType.FINAL
  );
  const depositInvoice = financialCase.invoices
    .filter((invoice) => invoice.invoiceType === InvoiceType.DEPOSIT)
    .at(-1);

  if (!finalInvoice) {
    return {
      stage: "booking",
      financialCaseId: financialCase.id,
      bookingId: financialCase.bookingId,
      depositInvoice: depositInvoice
        ? {
            ...mapDepositInvoiceSummary(depositInvoice),
          }
        : null,
      depositPaid: depositInvoice
        ? depositInvoice.remainingAmount.lte(0) ||
          deriveSettlementPaidAmount(depositInvoice).gte(depositInvoice.totalAmount)
        : false,
      awaitingFinalInvoiceAfterCheckIn: Boolean(
        financialCase.jobId ?? financialCase.booking.jobId
      ),
      finalInvoicePending: true,
      linkedDocuments: [],
    };
  }

  const orderId =
    input.orderId ??
    finalInvoice.orderId ??
    financialCase.booking.order?.id ??
    null;
  const finalizedAdjustments = financialCase.invoices.filter(
    (invoice) =>
      invoice.invoiceType === InvoiceType.ADJUSTMENT &&
      invoice.status !== "DRAFT"
  );
  const creditNotes = financialCase.invoices.filter(
    (invoice) => invoice.invoiceType === InvoiceType.CREDIT_NOTE
  );
  const refunds = financialCase.invoices.filter(
    (invoice) => invoice.invoiceType === InvoiceType.REFUND
  );
  const linkedDocuments = orderId
    ? await getLinkedFinancialDocumentsForOrderWithClient(orderId, client)
    : [];
  const depositApplied = await computeDepositAppliedToFinal(finalInvoice.id, client);
  const effectivePaid = await computeCaseEffectivePaid(
    [finalInvoice, ...finalizedAdjustments],
    client
  );
  const lockedSummary = deriveLockedFinancialSidebarSummary({
    finalInvoice: {
      totalAmount: finalInvoice.totalAmount,
      remainingAmount: finalInvoice.remainingAmount,
      depositPaidAmount: depositInvoice?.paidAmount ?? new Prisma.Decimal(0),
    },
    finalizedAdjustments: finalizedAdjustments.map((invoice) => ({
      totalAmount: invoice.totalAmount,
      remainingAmount: invoice.remainingAmount,
    })),
    orderId: orderId ?? undefined,
  });
  const settlementSummary = computeOrderSettlementSummary({
    invoices: financialCase.invoices.map((invoice) => ({
      invoiceType: invoice.invoiceType,
      totalAmount: invoice.totalAmount,
      remainingAmount: invoice.remainingAmount,
    })),
  });

  return {
    stage: "active",
    financialCaseId: financialCase.id,
    orderId,
    bookingId: financialCase.bookingId,
    depositInvoice: depositInvoice
      ? mapDepositInvoiceSummary(depositInvoice)
      : null,
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
    depositApplied: depositApplied.toNumber(),
    remaining: lockedSummary.remaining,
    totalAdjustments: lockedSummary.totalAdjustments,
    finalTotal: lockedSummary.finalTotal,
    overpaymentCapacity: (
      await computeOverpaymentCapacity(finalInvoice.id, client)
    ).toNumber(),
    creditNoteCapacity: (
      await computeCreditNoteCapacityForFinal(finalInvoice.id, client)
    ).toNumber(),
    linkedDocuments,
    paymentStatusEnum: deriveFinancialCasePaymentStatus({
      settlementSummary,
      effectivePaid: effectivePaid.toNumber(),
      customerTotal: lockedSummary.customerTotal,
      refunds: refunds.length,
    }),
  };
}

async function resolveFinancialCaseId(
  input: FinancialCaseSummaryInput,
  client: DbClient
): Promise<string | null> {
  if (input.financialCaseId) return input.financialCaseId;

  if (input.orderId) {
    const order = await client.order.findUnique({
      where: { id: input.orderId },
      select: { booking: { select: { financialCase: { select: { id: true } } } } },
    });
    return order?.booking.financialCase?.id ?? null;
  }

  if (input.bookingId) {
    const booking = await client.booking.findUnique({
      where: { id: input.bookingId },
      select: { financialCase: { select: { id: true } } },
    });
    return booking?.financialCase?.id ?? null;
  }

  return null;
}

function fetchFinancialCaseRow(financialCaseId: string, client: DbClient) {
  return client.financialCase.findUnique({
    where: { id: financialCaseId },
    select: {
      id: true,
      bookingId: true,
      jobId: true,
      booking: {
        select: {
          id: true,
          jobId: true,
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
          issuedAt: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
}

function mapInvoiceSummary(
  invoice: CaseRow["invoices"][number]
): FinancialCaseInvoiceSummary {
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

function mapDepositInvoiceSummary(invoice: CaseRow["invoices"][number]) {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    total: invoice.totalAmount.toNumber(),
    status: invoice.status,
    isLocked: invoice.isLocked,
    paidAmount: deriveSettlementPaidAmount(invoice).toNumber(),
  };
}

async function computeDepositAppliedToFinal(
  finalInvoiceId: string,
  client: DbClient
): Promise<Prisma.Decimal> {
  const aggregate = await client.documentApplication.aggregate({
    _sum: { amountApplied: true },
    where: {
      targetInvoiceId: finalInvoiceId,
      sourceInvoice: { invoiceType: InvoiceType.DEPOSIT },
    },
  });

  return aggregate._sum.amountApplied ?? new Prisma.Decimal(0);
}

async function computeCaseEffectivePaid(
  invoices: Array<{ id: string }>,
  client: DbClient
): Promise<Prisma.Decimal> {
  const paidAmounts = await Promise.all(
    invoices.map((invoice) => computeEffectivePaidFromAllocations(invoice.id, client))
  );

  return paidAmounts.reduce(
    (sum, paidAmount) => sum.plus(paidAmount),
    new Prisma.Decimal(0)
  );
}

async function getLinkedFinancialDocumentsForOrderWithClient(
  orderId: string,
  client: DbClient
): Promise<LinkedFinancialDocument[]> {
  const order = await client.order.findUnique({
    where: { id: orderId },
    select: {
      bookingId: true,
      booking: { select: { financialCase: { select: { id: true } } } },
    },
  });
  if (!order) return [];

  const financialCaseId = order.booking.financialCase?.id ?? null;
  const invoices = await client.invoice.findMany({
    where: {
      invoiceType: { in: [...LINKED_DOCUMENT_TYPES] },
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
