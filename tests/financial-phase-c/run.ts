import { db } from "@/lib/db";
import { runPhaseCEdgeCaseExpansion } from "./edge-cases";

export async function runPhaseCFinancialEdgeCases(): Promise<void> {
  await runPhaseCEdgeCaseExpansion(db);
}
