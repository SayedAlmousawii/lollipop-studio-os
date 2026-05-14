import { Prisma, type PrismaClient } from "@prisma/client";

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

    return payments
      .filter((payment) => {
        const allocationTotal = payment.allocations.reduce(
          (sum, allocation) => sum.plus(allocation.amount),
          new Prisma.Decimal(0)
        );

        return !allocationTotal.equals(payment.amount);
      })
      .map((payment) => {
        const allocationTotal = payment.allocations.reduce(
          (sum, allocation) => sum.plus(allocation.amount),
          new Prisma.Decimal(0)
        );

        return {
          invariant: "allocation-sum-equals-payment-amount",
          entityType: "Payment",
          entityId: payment.id,
          expected: payment.amount.toFixed(3),
          actual: allocationTotal.toFixed(3),
        };
      });
  },
});
