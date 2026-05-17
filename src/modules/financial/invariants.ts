import {
  InvoiceStatus,
  InvoiceType,
  OrderEntityKind,
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
  scope: "financial-case" | "global" | "order";
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
        sourceInvoice: { select: { invoiceType: true, paidAmount: true, totalAmount: true } },
      },
    });

    return applications
      .filter((application) => {
        const sourceCap =
          application.sourceInvoice.invoiceType === InvoiceType.CREDIT_NOTE
            ? application.sourceInvoice.totalAmount
            : application.sourceInvoice.paidAmount;

        return application.amountApplied.greaterThan(sourceCap);
      })
      .map((application) => ({
        invariant: "document-application-not-over-source",
        entityType: "DocumentApplication",
        entityId: application.id,
        expected: `<= ${
          application.sourceInvoice.invoiceType === InvoiceType.CREDIT_NOTE
            ? application.sourceInvoice.totalAmount.toFixed(3)
            : application.sourceInvoice.paidAmount.toFixed(3)
        }`,
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
  name: "locked-invoice-frozen-fields-match-snapshot",
  scope: "global",
  run: async ({ tx }) => {
    const lockedInvoices = await tx.invoice.findMany({
      where: { isLocked: true },
      select: {
        id: true,
        publicId: true,
        totalAmount: true,
        invoiceType: true,
        parentInvoiceId: true,
        financialCaseId: true,
        jobId: true,
        orderId: true,
        invoiceNumber: true,
        lockSnapshots: {
          orderBy: [{ lockedAt: "desc" }, { id: "desc" }],
          take: 1,
          select: {
            id: true,
            publicId: true,
            totalAmount: true,
            invoiceType: true,
            parentInvoiceId: true,
            financialCaseId: true,
            jobId: true,
            orderId: true,
            invoiceNumber: true,
          },
        },
      },
    });

    const violations: InvariantViolation[] = [];
    for (const invoice of lockedInvoices) {
      const snapshot = invoice.lockSnapshots[0];
      if (!snapshot) {
        violations.push({
          invariant: "locked-invoice-frozen-fields-match-snapshot",
          entityType: "Invoice",
          entityId: invoice.id,
          expected: "latest InvoiceLockSnapshot exists",
          actual: "no snapshot",
        });
        continue;
      }

      const mismatches: string[] = [];
      if (!invoice.totalAmount.equals(snapshot.totalAmount)) {
        mismatches.push("totalAmount");
      }
      if (invoice.invoiceType !== snapshot.invoiceType) {
        mismatches.push("invoiceType");
      }
      if (invoice.parentInvoiceId !== snapshot.parentInvoiceId) {
        mismatches.push("parentInvoiceId");
      }
      if (invoice.financialCaseId !== snapshot.financialCaseId) {
        mismatches.push("financialCaseId");
      }
      if (invoice.jobId !== snapshot.jobId) {
        mismatches.push("jobId");
      }
      if (invoice.orderId !== snapshot.orderId) {
        mismatches.push("orderId");
      }
      if (invoice.invoiceNumber !== snapshot.invoiceNumber) {
        mismatches.push("invoiceNumber");
      }
      if (invoice.publicId !== snapshot.publicId) {
        mismatches.push("publicId");
      }

      if (mismatches.length > 0) {
        violations.push({
          invariant: "locked-invoice-frozen-fields-match-snapshot",
          entityType: "Invoice",
          entityId: invoice.id,
          expected: `frozen fields match snapshot ${snapshot.id}`,
          actual: `mismatched: ${mismatches.join(", ")}`,
        });
      }
    }

    return violations;
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
        targetInvoiceLineId: true,
        sourceInvoice: { select: { invoiceType: true } },
        targetInvoice: { select: { invoiceType: true } },
      },
    });

    return applications
      .filter(
        (application) =>
          !(
            application.sourceInvoice.invoiceType === InvoiceType.CREDIT_NOTE &&
            application.targetInvoice.invoiceType === InvoiceType.ADJUSTMENT &&
            application.targetInvoiceLineId
          )
      )
      .map((application) => ({
        invariant: "adjustment-has-no-document-application",
        entityType: "DocumentApplication",
        entityId: application.id,
        expected:
          "neither source nor target invoice is ADJUSTMENT except line-targeted CREDIT_NOTE reversals",
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

registerInvariant({
  name: "credit-note-targets-final",
  scope: "global",
  run: async ({ tx }) => {
    const creditNotes = await tx.invoice.findMany({
      where: { invoiceType: InvoiceType.CREDIT_NOTE },
      select: {
        id: true,
        parentInvoice: { select: { id: true, invoiceType: true } },
        documentApplicationsAsSource: {
          select: { targetInvoiceLineId: true },
        },
      },
    });

    return creditNotes
      .filter((invoice) => {
        if (invoice.parentInvoice?.invoiceType === InvoiceType.FINAL) return false;
        const targetsAdjustmentLine =
          invoice.parentInvoice?.invoiceType === InvoiceType.ADJUSTMENT &&
          invoice.documentApplicationsAsSource.some(
            (application) => application.targetInvoiceLineId
          );
        return !targetsAdjustmentLine;
      })
      .map((invoice) => ({
        invariant: "credit-note-targets-final",
        entityType: "Invoice",
        entityId: invoice.id,
        expected:
          "parentInvoiceId set to FINAL invoice or line-targeted ADJUSTMENT reversal",
        actual: invoice.parentInvoice
          ? `parent ${invoice.parentInvoice.id} is ${invoice.parentInvoice.invoiceType}`
          : "no parent invoice",
      }));
  },
});

registerInvariant({
  name: "credit-note-has-document-application",
  scope: "global",
  run: async ({ tx }) => {
    const creditNotes = await tx.invoice.findMany({
      where: { invoiceType: InvoiceType.CREDIT_NOTE },
      select: {
        id: true,
        parentInvoiceId: true,
        documentApplicationsAsSource: {
          select: { id: true, targetInvoiceId: true, targetInvoiceLineId: true },
        },
      },
    });

    return creditNotes.flatMap((invoice) => {
      const matchingApplications = invoice.documentApplicationsAsSource.filter(
        (application) => application.targetInvoiceId === invoice.parentInvoiceId
      );
      const lineTargetedApplications = invoice.documentApplicationsAsSource.filter(
        (application) => application.targetInvoiceLineId
      );
      if (
        (invoice.documentApplicationsAsSource.length === 1 &&
          matchingApplications.length === 1) ||
        (lineTargetedApplications.length > 0 &&
          lineTargetedApplications.length === invoice.documentApplicationsAsSource.length)
      ) {
        return [];
      }

      return [
        {
          invariant: "credit-note-has-document-application",
          entityType: "Invoice",
          entityId: invoice.id,
          expected:
            "exactly 1 DocumentApplication to parent invoice or line-targeted applications only",
          actual: `${invoice.documentApplicationsAsSource.length} source applications, ${matchingApplications.length} to parent, ${lineTargetedApplications.length} line-targeted`,
        },
      ];
    });
  },
});

registerInvariant({
  name: "paid-adjustment-line-removal-must-have-reversal",
  scope: "order",
  run: async ({ tx }) => {
    const adjustmentLines = await tx.invoiceLineItem.findMany({
      where: {
        causeOrderEntityKind: { not: null },
        causeOrderEntityId: { not: null },
        invoice: {
          invoiceType: InvoiceType.ADJUSTMENT,
          paymentAllocations: {
            some: { payment: { direction: PaymentDirection.IN } },
          },
        },
      },
      select: {
        id: true,
        invoiceId: true,
        lineTotal: true,
        causeOrderEntityKind: true,
        causeOrderEntityId: true,
        documentApplications: {
          where: { sourceInvoice: { invoiceType: InvoiceType.CREDIT_NOTE } },
          select: { amountApplied: true },
        },
        invoice: {
          select: {
            orderId: true,
            finalizedAdjustmentWorkspaces: { select: { id: true }, take: 1 },
          },
        },
      },
    });

    const violations: InvariantViolation[] = [];
    for (const line of adjustmentLines) {
      if (line.invoice.finalizedAdjustmentWorkspaces.length > 0) {
        continue;
      }
      if (
        !line.invoice.orderId ||
        !line.causeOrderEntityKind ||
        !line.causeOrderEntityId
      ) {
        continue;
      }

      const causeStillExists = await adjustmentCauseStillExists({
        tx,
        orderId: line.invoice.orderId,
        kind: line.causeOrderEntityKind,
        id: line.causeOrderEntityId,
      });
      if (causeStillExists) continue;

      const reversedAmount = line.documentApplications.reduce(
        (sum, application) => sum.plus(application.amountApplied),
        new Prisma.Decimal(0)
      );
      if (reversedAmount.greaterThanOrEqualTo(line.lineTotal)) continue;

      violations.push({
        invariant: "paid-adjustment-line-removal-must-have-reversal",
        entityType: "InvoiceLineItem",
        entityId: line.id,
        expected: `CREDIT_NOTE DocumentApplication targeting line for ${line.lineTotal.toFixed(3)}`,
        actual: `${reversedAmount.toFixed(3)} reversed for adjustment ${line.invoiceId}`,
      });
    }

    return violations;
  },
});

async function adjustmentCauseStillExists({
  tx,
  orderId,
  kind,
  id,
}: {
  tx: PrismaClient | Prisma.TransactionClient;
  orderId: string;
  kind: OrderEntityKind;
  id: string;
}): Promise<boolean> {
  if (kind === OrderEntityKind.ADDON) {
    const addOn = await tx.orderAddOn.findFirst({
      where: { id, orderId },
      select: { id: true },
    });
    return Boolean(addOn);
  }

  if (kind === OrderEntityKind.UPGRADE) {
    const upgrade = await tx.orderPackageItemUpgrade.findFirst({
      where: { id, orderId },
      select: { id: true },
    });
    return Boolean(upgrade);
  }

  return true;
}

registerInvariant({
  name: "credit-note-amount-not-over-final",
  scope: "global",
  run: async ({ tx }) => {
    const finalInvoices = await tx.invoice.findMany({
      where: {
        documentApplicationsAsTarget: {
          some: { sourceInvoice: { invoiceType: InvoiceType.CREDIT_NOTE } },
        },
      },
      select: {
        id: true,
        totalAmount: true,
        documentApplicationsAsTarget: {
          where: { sourceInvoice: { invoiceType: InvoiceType.CREDIT_NOTE } },
          select: { amountApplied: true },
        },
      },
    });

    return finalInvoices.flatMap((invoice) => {
      const creditTotal = invoice.documentApplicationsAsTarget.reduce(
        (sum, application) => sum.plus(application.amountApplied),
        new Prisma.Decimal(0)
      );
      if (creditTotal.lessThanOrEqualTo(invoice.totalAmount)) {
        return [];
      }

      return [
        {
          invariant: "credit-note-amount-not-over-final",
          entityType: "Invoice",
          entityId: invoice.id,
          expected: `credit total <= ${invoice.totalAmount.toFixed(3)}`,
          actual: creditTotal.toFixed(3),
        },
      ];
    });
  },
});

registerInvariant({
  name: "credit-note-is-locked-on-issuance",
  scope: "global",
  run: async ({ tx }) => {
    const creditNotes = await tx.invoice.findMany({
      where: { invoiceType: InvoiceType.CREDIT_NOTE },
      select: { id: true, isLocked: true, status: true },
    });

    return creditNotes
      .filter(
        (invoice) =>
          !invoice.isLocked || invoice.status !== InvoiceStatus.CLOSED
      )
      .map((invoice) => ({
        invariant: "credit-note-is-locked-on-issuance",
        entityType: "Invoice",
        entityId: invoice.id,
        expected: "isLocked=true and status=CLOSED",
        actual: `isLocked=${invoice.isLocked}, status=${invoice.status}`,
      }));
  },
});

registerInvariant({
  name: "final-invoice-fully-paid-must-be-locked",
  scope: "global",
  run: async ({ tx }) => {
    const finalInvoices = await tx.invoice.findMany({
      where: {
        invoiceType: InvoiceType.FINAL,
        remainingAmount: new Prisma.Decimal(0),
      },
      select: { id: true, isLocked: true, status: true },
    });

    return finalInvoices
      .filter(
        (invoice) =>
          !invoice.isLocked || invoice.status !== InvoiceStatus.CLOSED
      )
      .map((invoice) => ({
        invariant: "final-invoice-fully-paid-must-be-locked",
        entityType: "Invoice",
        entityId: invoice.id,
        expected: "remainingAmount=0 with isLocked=true and status=CLOSED",
        actual: `isLocked=${invoice.isLocked}, status=${invoice.status}`,
      }));
  },
});

registerInvariant({
  name: "classifier-reductions-have-matching-credit-note",
  scope: "global",
  run: async ({ tx }) => {
    const classifierCreditNotes = await tx.invoice.findMany({
      where: {
        invoiceType: InvoiceType.CREDIT_NOTE,
        notes: { startsWith: "Auto-CREDIT_NOTE from order edit" },
      },
      select: {
        id: true,
        invoiceNumber: true,
        orderId: true,
        parentInvoiceId: true,
        documentApplicationsAsSource: {
          select: { targetInvoiceId: true },
        },
      },
    });

    const violations: InvariantViolation[] = [];
    for (const invoice of classifierCreditNotes) {
      const hasFinalApplication = invoice.documentApplicationsAsSource.some(
        (application) => application.targetInvoiceId === invoice.parentInvoiceId
      );
      const sourceActivity = invoice.orderId
        ? await tx.orderActivity.findFirst({
            where: {
              orderId: invoice.orderId,
              title: "Classifier reduction credit note issued",
              metadata: {
                path: ["creditNoteInvoiceId"],
                equals: invoice.id,
              },
            },
            select: { id: true },
          })
        : null;

      if (hasFinalApplication && sourceActivity) {
        continue;
      }

      violations.push({
        invariant: "classifier-reductions-have-matching-credit-note",
        entityType: "Invoice",
        entityId: invoice.id,
        expected:
          "classifier CREDIT_NOTE has DocumentApplication to FINAL and source activity",
        actual: `application=${hasFinalApplication}, activity=${Boolean(
          sourceActivity
        )}, invoice=${invoice.invoiceNumber}`,
      });
    }

    return violations;
  },
});

export const FINANCIAL_RUNTIME_INVARIANTS: readonly InvariantCheck[] =
  Object.freeze([...invariantRegistry]);
