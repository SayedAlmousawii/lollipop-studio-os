import "dotenv/config";

import process from "node:process";
import { withIsolatedBackendInvariantSchema } from "./harness";

async function main() {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    process.env.DATABASE_URL = databaseUrl;

    const { runPackageOptionsSmokeTest } = await import("./package-options.smoke");
    const { runInvoiceMathInvariantTest } = await import("./invoice-math.invariant");
    const { runSelectedPhotoAggregateInvariantTest } = await import(
      "./selected-photo-aggregate.invariant"
    );
    const { runPOSPricingDisplayInvariantTest } = await import(
      "./pos-pricing-display.invariant"
    );

    await runPackageOptionsSmokeTest();
    await runInvoiceMathInvariantTest();
    await runSelectedPhotoAggregateInvariantTest();
    await runPOSPricingDisplayInvariantTest();
  });

  process.stdout.write("backend invariant tests passed\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
