import { db } from "@/lib/db";
import { runPhaseDRegressionSuite } from "./regression";

export async function runPhaseDFinancialRegressionSuite(): Promise<void> {
  await runPhaseDRegressionSuite(db);
}
