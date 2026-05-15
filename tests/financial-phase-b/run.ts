import { db } from "@/lib/db";
import { runPhaseBWorkflowIntegrationMatrix } from "./workflow-integration";

export async function runPhaseBFinancialWorkflowIntegration(): Promise<void> {
  await runPhaseBWorkflowIntegrationMatrix(db);
}
