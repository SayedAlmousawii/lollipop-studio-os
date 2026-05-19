import { InvoiceType, Prisma, type PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import {
  computeEffectivePaidFromAllocations,
} from "@/modules/invoices/invoice.calculation";
import {
  computeCreditNoteCapacityForFinal,
  computeOverpaymentCapacity,
} from "@/modules/invoices/invoice.service";
import {
  computeOrderSettlementSummary,
  deriveLockedFinancialSidebarSummary,
  deriveSettlementPaidAmount,
} from "@/modules/orders/order-settlement";
import {
  getLinkedFinancialDocumentsForOrder,
  getPOSWorkspace,
} from "@/modules/orders/order.service";
import type { LinkedFinancialDocument } from "@/modules/orders/order.types";
import { compareSummaryWithLegacy } from "./discrepancy-logger";
import {
  toFinancialTabBlock,
  toOrderHeaderFinancial,
  toOrdersTableRow,
  toSalesSidebarLocked,
} from "./projections";
import type {
  FinancialCaseInvoiceSummary,
  FinancialCasePaymentStatus,
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
    paymentStatusEnum: derivePaymentStatusEnum({
      settlementSummary,
      effectivePaid: effectivePaid.toNumber(),
      customerTotal: lockedSummary.customerTotal,
      refunds: refunds.length,
    }),
  };
}

export async function checkFinancialCaseSummaryProjectorParity(
  client: DbClient = db
): Promise<
  Array<{
    financialCaseId: string;
    orderId: string | null;
    projector:
      | "toFinancialTabBlock"
      | "toSalesSidebarLocked"
      | "toOrderHeaderFinancial"
      | "toOrdersTableRow";
    field: string;
    actual: string;
  }>
> {
  const activeCases = await client.invoice.findMany({
    where: { invoiceType: InvoiceType.FINAL },
    select: { financialCaseId: true },
    distinct: ["financialCaseId"],
  });
  const violations: Array<{
    financialCaseId: string;
    orderId: string | null;
    projector:
      | "toFinancialTabBlock"
      | "toSalesSidebarLocked"
      | "toOrderHeaderFinancial"
      | "toOrdersTableRow";
    field: string;
    actual: string;
  }> = [];

  for (const activeCase of activeCases) {
    const summary = await getFinancialCaseSummary(
      { financialCaseId: activeCase.financialCaseId },
      client
    );
    if (!summary || summary.stage !== "active") continue;
    if (!summary.orderId) continue;

    const legacyDerivation = await deriveLegacyLockedSummary(
      summary.orderId,
      client
    );
    if (!legacyDerivation) continue;
    for (const projector of [
      ["toFinancialTabBlock", toFinancialTabBlock(summary)],
      ["toSalesSidebarLocked", toSalesSidebarLocked(summary)],
    ] as const) {
      const discrepancies = compareSummaryWithLegacy(
        legacyDerivation,
        projector[1],
        {
          context: {
            financialCaseId: summary.financialCaseId,
            orderId: summary.orderId,
            projector: projector[0],
          },
        }
      );

      violations.push(
        ...discrepancies.map((discrepancy) => ({
          financialCaseId: summary.financialCaseId,
          orderId: summary.orderId,
          projector: projector[0],
          field: discrepancy.field,
          actual:
            discrepancy.delta === undefined
              ? `legacy=${String(discrepancy.legacyValue)}, projector=${String(
                  discrepancy.projectorValue
                )}`
              : `legacy=${String(discrepancy.legacyValue)}, projector=${String(
                  discrepancy.projectorValue
                )}, delta=${discrepancy.delta.toFixed(6)}`,
        }))
      );
    }

    const settlementSummary = await deriveLegacySettlementSummary(
      summary.financialCaseId,
      client
    );
    if (!settlementSummary) continue;
    const headerProjection = toOrderHeaderFinancial(summary);
    const tableProjection = toOrdersTableRow(summary);

    for (const projector of [
      [
        "toOrderHeaderFinancial",
        {
          totalOrderValue: headerProjection?.totalOrderValue,
          outstandingAmount: headerProjection?.outstandingAmount,
        },
      ],
      [
        "toOrdersTableRow",
        {
          totalAmount: tableProjection?.totalAmount,
          remainingAmount: tableProjection?.remainingAmount,
        },
      ],
    ] as const) {
      const legacyComparable =
        projector[0] === "toOrderHeaderFinancial"
          ? {
              totalOrderValue: settlementSummary.totalOrderValue,
              outstandingAmount: settlementSummary.outstandingAmount,
            }
          : {
              totalAmount: settlementSummary.totalOrderValue,
              remainingAmount: settlementSummary.outstandingAmount,
            };
      const discrepancies = compareSummaryWithLegacy(
        legacyComparable,
        projector[1],
        {
          context: {
            financialCaseId: summary.financialCaseId,
            orderId: summary.orderId,
            projector: projector[0],
          },
        }
      );

      violations.push(
        ...discrepancies.map((discrepancy) => ({
          financialCaseId: summary.financialCaseId,
          orderId: summary.orderId,
          projector: projector[0],
          field: discrepancy.field,
          actual:
            discrepancy.delta === undefined
              ? `legacy=${String(discrepancy.legacyValue)}, projector=${String(
                  discrepancy.projectorValue
                )}`
              : `legacy=${String(discrepancy.legacyValue)}, projector=${String(
                  discrepancy.projectorValue
                )}, delta=${discrepancy.delta.toFixed(6)}`,
        }))
      );
    }
  }

  return violations;
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

async function deriveLegacyLockedSummary(orderId: string, client: DbClient) {
  const [workspace, linkedDocuments] = await Promise.all([
    getPOSWorkspace(orderId, client),
    getLinkedFinancialDocumentsForOrder(orderId, client),
  ]);
  if (!workspace?.invoice) return null;

  return deriveLockedFinancialSidebarSummary({
    finalInvoice: {
      totalAmount: workspace.invoice.invoiceTotal,
      remainingAmount: workspace.invoice.remainingAmount,
      depositPaidAmount: workspace.invoice.depositPaidAmount,
    },
    finalizedAdjustments: linkedDocuments
      .filter(
        (document) =>
          document.invoiceType === "ADJUSTMENT" &&
          document.invoiceStatus !== "DRAFT"
      )
      .map((document) => ({
        totalAmount: document.invoiceTotal,
        remainingAmount: document.remainingAmount,
      })),
    orderId,
  });
}

async function deriveLegacySettlementSummary(
  financialCaseId: string,
  client: DbClient
) {
  const invoices = await client.invoice.findMany({
    where: { financialCaseId },
    select: {
      invoiceType: true,
      totalAmount: true,
      remainingAmount: true,
    },
  });
  if (invoices.length === 0) return null;

  return computeOrderSettlementSummary({ invoices });
}

function derivePaymentStatusEnum(input: {
  settlementSummary: ReturnType<typeof computeOrderSettlementSummary>;
  effectivePaid: number;
  customerTotal: number;
  refunds: number;
}): FinancialCasePaymentStatus {
  if (input.refunds > 0) return "REFUNDED";
  if (
    input.settlementSummary.hasOverpayment ||
    input.effectivePaid - input.customerTotal > 0.0005
  ) {
    return "OVERPAID";
  }
  if (input.customerTotal > 0 && input.settlementSummary.outstandingAmount <= 0.0005) {
    return "PAID";
  }
  if (input.effectivePaid <= 0.0005) return "UNPAID";
  return "PARTIAL";
}
