import { db } from "@/lib/db";
import { runPhaseFTransactionConcurrencySuite } from "./transaction-concurrency";
import { runPhaseFSecurityPermissionSuite } from "./security-permissions";
import { runPhaseFFailureRecoverySuite } from "./failure-recovery";
import { seedPhaseFFixtures } from "./fixtures";

export async function runPhaseFFinancialConcurrencySecurityRecovery(): Promise<void> {
  const fixtures = await seedPhaseFFixtures(db);
  await runPhaseFTransactionConcurrencySuite(db, fixtures);
  await runPhaseFSecurityPermissionSuite(db, fixtures);
  await runPhaseFFailureRecoverySuite(db, fixtures);
}
