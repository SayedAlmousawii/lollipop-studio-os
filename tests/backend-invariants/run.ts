import "dotenv/config";

import Module from "node:module";
import process from "node:process";
import { withIsolatedBackendInvariantSchema } from "./harness";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };
const originalModuleLoad = moduleWithLoader._load;
moduleWithLoader._load = function loadWithServerOnlyShim(
  request,
  parent,
  isMain
) {
  if (request === "server-only") return {};
  return originalModuleLoad.call(this, request, parent, isMain);
};

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
    const { runCalendarSessionTypeDisplayInvariantTest } = await import(
      "./calendar-session-type-display.invariant"
    );
    const { runScopedAddOnDeleteInvariantTest } = await import(
      "./scoped-add-on-delete.invariant"
    );
    const { runDuplicateBookingPackageInvariantTest } = await import(
      "./duplicate-booking-package.invariant"
    );
    const { runPhaseAFinancialArchitectureVerification } = await import(
      "../financial-phase-a/run"
    );
    const { runPhaseBFinancialWorkflowIntegration } = await import(
      "../financial-phase-b/run"
    );
    const { runPhaseCFinancialEdgeCases } = await import(
      "../financial-phase-c/run"
    );

    await runPhaseAFinancialArchitectureVerification(databaseUrl);
    await runPhaseBFinancialWorkflowIntegration();
    await runPhaseCFinancialEdgeCases();
    await runPackageOptionsSmokeTest();
    await runInvoiceMathInvariantTest();
    await runSelectedPhotoAggregateInvariantTest();
    await runPOSPricingDisplayInvariantTest();
    await runCalendarSessionTypeDisplayInvariantTest();
    await runScopedAddOnDeleteInvariantTest();
    await runDuplicateBookingPackageInvariantTest();
  });

  process.stdout.write("backend invariant tests passed\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
