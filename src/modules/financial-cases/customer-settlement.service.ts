import { Prisma, type PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import {
  deriveCustomerSettlementFromFinancialCaseSummary,
  type CustomerSettlementSummary,
} from "./customer-settlement.calculation";
import { getFinancialCaseSummary } from "./financial-case-summary.service";
import type { FinancialCaseSummaryInput } from "./financial-case-summary.types";

export {
  deriveCustomerSettlementFromActiveSummary,
  deriveCustomerSettlementFromFinancialCaseSummary,
  getNetCustomerTotal,
  type CustomerSettlementSummary,
} from "./customer-settlement.calculation";

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function computeCustomerSettlement(
  input: FinancialCaseSummaryInput,
  client: DbClient = db
): Promise<CustomerSettlementSummary | null> {
  const summary = await getFinancialCaseSummary(input, client);
  if (!summary) return null;
  return deriveCustomerSettlementFromFinancialCaseSummary(summary);
}
