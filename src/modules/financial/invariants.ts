import {
  InvoiceStatus,
  InvoiceType,
  PaymentDirection,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

export type InvariantContext = {
  tx: PrismaClient | Prisma.TransactionClient;
};

export type InvariantViolation = {
  invariant: string;
  entityType: string;
  entityId: string;
  expected: string;
  actual: string;
};

export type InvariantCheck = {
  name: string;
  scope: "financial-case" | "global";
  run: (
    ctx: InvariantContext,
    scopeArgs?: { financialCaseId?: string }
  ) => Promise<InvariantViolation[]>;
};

const invariantRegistry: InvariantCheck[] = [];

export function registerInvariant(check: InvariantCheck): void {
  if (invariantRegistry.some((entry) => entry.name === check.name)) {
    throw new Error(`Financial invariant "${check.name}" is already registered`);
  }

  invariantRegistry.push(check);
}

export async function assertFinancialCaseInvariants(
  financialCaseId: string,
  tx: PrismaClient | Prisma.TransactionClient
): Promise<void> {
  const violations: InvariantViolation[] = [];

  for (const check of invariantRegistry) {
    if (check.scope !== "financial-case") {
      continue;
    }

    violations.push(...(await check.run({ tx }, { financialCaseId })));
  }

  if (violations.length > 0) {
    throw new Error(
      `Financial invariant violations for case ${financialCaseId}: ${JSON.stringify(violations)}`
    );
  }
}

export async function runAllInvariants(tx: PrismaClient): Promise<InvariantViolation[]> {
  const violations: InvariantViolation[] = [];

  for (const check of invariantRegistry) {
    violations.push(...(await check.run({ tx })));
  }

  return violations;
}

registerInvariant({
  name: "payment-has-exactly-one-allocation",
  scope: "financial-case",
  run: async ({ tx }, { financialCaseId } = {}) => {
    const payments = await tx.payment.findMany({
      where: financialCaseId ? { financialCaseId } : undefined,
      select: {
        id: true,
        _count: { select: { allocations: true } },
      },
    });

    return payments
      .filter((payment) => payment._count.allocations !== 1)
      .map((payment) => ({
        invariant: "payment-has-exactly-one-allocation",
        entityType: "Payment",
        entityId: payment.id,
        expected: "1 allocation",
        actual: `${payment._count.allocations} allocations`,
      }));
  },
});

registerInvariant({
  name: "allocation-sum-equals-payment-amount",
  scope: "financial-case",
  run: async ({ tx }, { financialCaseId } = {}) => {
    const payments = await tx.payment.findMany({
      where: financialCaseId ? { financialCaseId } : undefined,
      select: {
        id: true,
        amount: true,
        allocations: { select: { amount: true } },
      },
    });

    const violations: InvariantViolation[] = [];
    for (const payment of payments) {
      const allocationTotal = payment.allocations.reduce(
        (sum, allocation) => sum.plus(allocation.amount),
        new Prisma.Decimal(0)
      );

      if (!allocationTotal.equals(payment.amount)) {
        violations.push({
          invariant: "allocation-sum-equals-payment-amount",
          entityType: "Payment",
          entityId: payment.id,
          expected: payment.amount.toFixed(3),
          actual: allocationTotal.toFixed(3),
        });
      }
    }

    return violations;
  },
});

registerInvariant({
  name: "financial-case-net-balance-non-negative",
  scope: "financial-case",
  run: async ({ tx }, { financialCaseId } = {}) => {
    const financialCases = await tx.financialCase.findMany({
      where: financialCaseId ? { id: financialCaseId } : undefined,
      select: {
        id: true,
        invoices: {
          select: {
            paymentAllocations: {
              select: {
                amount: true,
                payment: { select: { direction: true } },
              },
            },
            documentApplicationsAsTarget: {
              select: { amountApplied: true },
            },
          },
        },
      },
    });

    return financialCases.flatMap((financialCase) => {
      const netBalance = financialCase.invoices.reduce((caseSum, invoice) => {
        const paymentTotal = invoice.paymentAllocations.reduce(
          (invoiceSum, allocation) =>
            allocation.payment.direction === PaymentDirection.OUT
              ? invoiceSum.minus(allocation.amount)
              : invoiceSum.plus(allocation.amount),
          new Prisma.Decimal(0)
        );
        const documentTotal = invoice.documentApplicationsAsTarget.reduce(
          (invoiceSum, application) => invoiceSum.plus(application.amountApplied),
          new Prisma.Decimal(0)
        );

        return caseSum.plus(paymentTotal).plus(documentTotal);
      }, new Prisma.Decimal(0));

      if (netBalance.greaterThanOrEqualTo(0)) {
        return [];
      }

      return [
        {
          invariant: "financial-case-net-balance-non-negative",
          entityType: "FinancialCase",
          entityId: financialCase.id,
          expected: ">= 0.000",
          actual: netBalance.toFixed(3),
        },
      ];
    });
  },
});

registerInvariant({
  name: "document-application-not-over-source",
  scope: "global",
  run: async ({ tx }) => {
    const applications = await tx.documentApplication.findMany({
      select: {
        id: true,
        amountApplied: true,
        sourceInvoice: { select: { paidAmount: true } },
      },
    });

    return applications
      .filter((application) =>
        application.amountApplied.greaterThan(application.sourceInvoice.paidAmount)
      )
      .map((application) => ({
        invariant: "document-application-not-over-source",
        entityType: "DocumentApplication",
        entityId: application.id,
        expected: `<= ${application.sourceInvoice.paidAmount.toFixed(3)}`,
        actual: application.amountApplied.toFixed(3),
      }));
  },
});

registerInvariant({
  name: "deposit-final-pair-has-document-application",
  scope: "global",
  run: async ({ tx }) => {
    const financialCases = await tx.financialCase.findMany({
      where: {
        invoices: {
          some: {
            invoiceType: InvoiceType.DEPOSIT,
            parentInvoiceId: null,
            status: InvoiceStatus.CLOSED,
            paidAmount: { gt: new Prisma.Decimal(0) },
          },
        },
      },
      select: {
        id: true,
        invoices: {
          where: {
            parentInvoiceId: null,
            invoiceType: { in: [InvoiceType.DEPOSIT, InvoiceType.FINAL] },
          },
          select: {
            id: true,
            invoiceType: true,
            status: true,
            paidAmount: true,
            documentApplicationsAsSource: {
              select: {
                id: true,
                targetInvoiceId: true,
              },
            },
          },
        },
      },
    });

    return financialCases.flatMap((financialCase) => {
      const closedPaidDeposits = financialCase.invoices.filter(
        (invoice) =>
          invoice.invoiceType === InvoiceType.DEPOSIT &&
          invoice.status === InvoiceStatus.CLOSED &&
          invoice.paidAmount.greaterThan(0)
      );
      const finalInvoices = financialCase.invoices.filter(
        (invoice) => invoice.invoiceType === InvoiceType.FINAL
      );

      return closedPaidDeposits.flatMap((depositInvoice) =>
        finalInvoices.flatMap((finalInvoice) => {
          const applicationCount =
            depositInvoice.documentApplicationsAsSource.filter(
              (application) => application.targetInvoiceId === finalInvoice.id
            ).length;

          if (applicationCount === 1) {
            return [];
          }

          return [
            {
              invariant: "deposit-final-pair-has-document-application",
              entityType: "FinancialCase",
              entityId: financialCase.id,
              expected: `1 DocumentApplication from ${depositInvoice.id} to ${finalInvoice.id}`,
              actual: `${applicationCount} DocumentApplications`,
            },
          ];
        })
      );
    });
  },
});

registerInvariant({
  name: "no-payment-without-allocation",
  scope: "global",
  run: async ({ tx }) => {
    const payments = await tx.payment.findMany({
      where: { allocations: { none: {} } },
      select: { id: true },
    });

    return payments.map((payment) => ({
      invariant: "no-payment-without-allocation",
      entityType: "Payment",
      entityId: payment.id,
      expected: "at least 1 allocation",
      actual: "0 allocations",
    }));
  },
});

registerInvariant({
  name: "adjustment-parent-is-final",
  scope: "global",
  run: async ({ tx }) => {
    const adjustmentInvoices = await tx.invoice.findMany({
      where: { invoiceType: InvoiceType.ADJUSTMENT },
      select: {
        id: true,
        parentInvoice: { select: { id: true, invoiceType: true } },
      },
    });

    return adjustmentInvoices
      .filter(
        (invoice) => invoice.parentInvoice?.invoiceType !== InvoiceType.FINAL
      )
      .map((invoice) => ({
        invariant: "adjustment-parent-is-final",
        entityType: "Invoice",
        entityId: invoice.id,
        expected: "parentInvoiceId set to a FINAL invoice",
        actual: invoice.parentInvoice
          ? `parent ${invoice.parentInvoice.id} is ${invoice.parentInvoice.invoiceType}`
          : "no parent invoice",
      }));
  },
});

registerInvariant({
  name: "adjustment-same-financial-case-as-parent",
  scope: "global",
  run: async ({ tx }) => {
    const adjustmentInvoices = await tx.invoice.findMany({
      where: { invoiceType: InvoiceType.ADJUSTMENT },
      select: {
        id: true,
        financialCaseId: true,
        parentInvoice: { select: { id: true, financialCaseId: true } },
      },
    });

    return adjustmentInvoices
      .filter(
        (invoice) =>
          invoice.parentInvoice !== null &&
          invoice.financialCaseId !== invoice.parentInvoice.financialCaseId
      )
      .map((invoice) => ({
        invariant: "adjustment-same-financial-case-as-parent",
        entityType: "Invoice",
        entityId: invoice.id,
        expected: invoice.parentInvoice?.financialCaseId ?? "parent financial case",
        actual: invoice.financialCaseId,
      }));
  },
});

registerInvariant({
  name: "adjustment-never-chains",
  scope: "global",
  run: async ({ tx }) => {
    const chainedAdjustments = await tx.invoice.findMany({
      where: {
        invoiceType: InvoiceType.ADJUSTMENT,
        parentInvoice: { invoiceType: InvoiceType.ADJUSTMENT },
      },
      select: { id: true, parentInvoiceId: true },
    });

    return chainedAdjustments.map((invoice) => ({
      invariant: "adjustment-never-chains",
      entityType: "Invoice",
      entityId: invoice.id,
      expected: "parent is FINAL, never ADJUSTMENT",
      actual: `parent ${invoice.parentInvoiceId ?? "unknown"} is ADJUSTMENT`,
    }));
  },
});

registerInvariant({
  name: "adjustment-has-no-document-application",
  scope: "global",
  run: async ({ tx }) => {
    const applications = await tx.documentApplication.findMany({
      where: {
        OR: [
          { sourceInvoice: { invoiceType: InvoiceType.ADJUSTMENT } },
          { targetInvoice: { invoiceType: InvoiceType.ADJUSTMENT } },
        ],
      },
      select: {
        id: true,
        sourceInvoice: { select: { invoiceType: true } },
        targetInvoice: { select: { invoiceType: true } },
      },
    });

    return applications.map((application) => ({
      invariant: "adjustment-has-no-document-application",
      entityType: "DocumentApplication",
      entityId: application.id,
      expected: "neither source nor target invoice is ADJUSTMENT",
      actual: `source ${application.sourceInvoice.invoiceType}, target ${application.targetInvoice.invoiceType}`,
    }));
  },
});

registerInvariant({
  name: "no-adjustment-without-classifier-source",
  scope: "global",
  run: async ({ tx }) => {
    const autoAdjustments = await tx.invoice.findMany({
      where: {
        invoiceType: InvoiceType.ADJUSTMENT,
        notes: { startsWith: "Auto-ADJUSTMENT from order edit" },
      },
      select: {
        id: true,
        orderId: true,
        invoiceNumber: true,
      },
    });

    const violations: InvariantViolation[] = [];
    for (const invoice of autoAdjustments) {
      if (!invoice.orderId) {
        violations.push({
          invariant: "no-adjustment-without-classifier-source",
          entityType: "Invoice",
          entityId: invoice.id,
          expected: "auto adjustment has an order activity classifier source",
          actual: "no orderId",
        });
        continue;
      }

      const sourceActivity = await tx.orderActivity.findFirst({
        where: {
          orderId: invoice.orderId,
          title: "Auto-adjustment issued",
          metadata: {
            path: ["adjustmentInvoiceId"],
            equals: invoice.id,
          },
        },
        select: { id: true },
      });

      if (!sourceActivity) {
        violations.push({
          invariant: "no-adjustment-without-classifier-source",
          entityType: "Invoice",
          entityId: invoice.id,
          expected: "classifier activity log referencing this ADJUSTMENT",
          actual: `no activity source for ${invoice.invoiceNumber}`,
        });
      }
    }

    return violations;
  },
});

registerInvariant({
  name: "out-payment-targets-refund-invoice",
  scope: "global",
  run: async ({ tx }) => {
    const payments = await tx.payment.findMany({
      where: { direction: PaymentDirection.OUT },
      select: {
        id: true,
        invoice: { select: { id: true, invoiceType: true } },
      },
    });

    return payments
      .filter((payment) => payment.invoice.invoiceType !== InvoiceType.REFUND)
      .map((payment) => ({
        invariant: "out-payment-targets-refund-invoice",
        entityType: "Payment",
        entityId: payment.id,
        expected: "target invoice type REFUND",
        actual: `target invoice ${payment.invoice.id} is ${payment.invoice.invoiceType}`,
      }));
  },
});

registerInvariant({
  name: "refund-amount-not-over-source",
  scope: "global",
  run: async ({ tx }) => {
    const sourceInvoices = await tx.invoice.findMany({
      where: { adjustments: { some: { invoiceType: InvoiceType.REFUND } } },
      select: {
        id: true,
        paymentAllocations: {
          where: { payment: { direction: PaymentDirection.IN } },
          select: { amount: true },
        },
        adjustments: {
          where: { invoiceType: InvoiceType.REFUND },
          select: { id: true, totalAmount: true },
        },
      },
    });

    const violations: InvariantViolation[] = [];
    for (const sourceInvoice of sourceInvoices) {
      const inboundTotal = sourceInvoice.paymentAllocations.reduce(
        (sum, allocation) => sum.plus(allocation.amount),
        new Prisma.Decimal(0)
      );
      const refundTotal = sourceInvoice.adjustments.reduce(
        (sum, refundInvoice) => sum.plus(refundInvoice.totalAmount),
        new Prisma.Decimal(0)
      );

      if (refundTotal.lessThanOrEqualTo(inboundTotal)) {
        continue;
      }

      for (const refundInvoice of sourceInvoice.adjustments) {
        violations.push({
          invariant: "refund-amount-not-over-source",
          entityType: "Invoice",
          entityId: refundInvoice.id,
          expected: `source refund total <= ${inboundTotal.toFixed(3)}`,
          actual: refundTotal.toFixed(3),
        });
      }
    }

    return violations;
  },
});

registerInvariant({
  name: "refund-trace-points-to-inbound-payment",
  scope: "global",
  run: async ({ tx }) => {
    const payments = await tx.payment.findMany({
      where: { refundOfPaymentId: { not: null } },
      select: {
        id: true,
        refundOfPayment: { select: { id: true, direction: true } },
      },
    });

    return payments
      .filter(
        (payment) =>
          payment.refundOfPayment?.direction !== PaymentDirection.IN
      )
      .map((payment) => ({
        invariant: "refund-trace-points-to-inbound-payment",
        entityType: "Payment",
        entityId: payment.id,
        expected: "refundOfPaymentId references an IN payment",
        actual: payment.refundOfPayment
          ? `references ${payment.refundOfPayment.direction} payment ${payment.refundOfPayment.id}`
          : "no referenced payment",
      }));
  },
});

registerInvariant({
  name: "refund-source-is-final-or-adjustment",
  scope: "global",
  run: async ({ tx }) => {
    const refundInvoices = await tx.invoice.findMany({
      where: { invoiceType: InvoiceType.REFUND },
      select: {
        id: true,
        parentInvoice: { select: { id: true, invoiceType: true } },
      },
    });

    return refundInvoices
      .filter(
        (invoice) =>
          invoice.parentInvoice?.invoiceType !== InvoiceType.FINAL &&
          invoice.parentInvoice?.invoiceType !== InvoiceType.ADJUSTMENT
      )
      .map((invoice) => ({
        invariant: "refund-source-is-final-or-adjustment",
        entityType: "Invoice",
        entityId: invoice.id,
        expected: "parentInvoiceId set to FINAL or ADJUSTMENT invoice",
        actual: invoice.parentInvoice
          ? `parent ${invoice.parentInvoice.id} is ${invoice.parentInvoice.invoiceType}`
          : "no parent invoice",
      }));
  },
});
