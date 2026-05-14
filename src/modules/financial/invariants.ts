import type { Prisma, PrismaClient } from "@prisma/client";

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
  tx: Prisma.TransactionClient
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
