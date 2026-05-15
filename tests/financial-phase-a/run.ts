import { db } from "@/lib/db";
import { runPhaseAChecks } from "./assertions";
import { seedPhaseAFinancialFixtures } from "./fixtures";
import { buildFinancialInvariantChecks } from "./financial-invariants";
import { buildMigrationBackfillChecks } from "./migration-backfill";
import { buildSchemaIntegrityChecks } from "./schema-integrity";

export async function runPhaseAFinancialArchitectureVerification(
  databaseUrl: string
): Promise<void> {
  await seedPhaseAFinancialFixtures(db);

  await runPhaseAChecks([
    ...buildSchemaIntegrityChecks(db, databaseUrl),
    ...buildMigrationBackfillChecks(db),
    ...buildFinancialInvariantChecks(db),
  ]);
}
