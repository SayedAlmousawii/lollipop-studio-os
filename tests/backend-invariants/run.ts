import "dotenv/config";

import process from "node:process";
import { withIsolatedBackendInvariantSchema } from "./harness";

async function main() {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    process.env.DATABASE_URL = databaseUrl;

    const { runPackageOptionsSmokeTest } = await import("./package-options.smoke");

    await runPackageOptionsSmokeTest();
  });

  process.stdout.write("backend invariant smoke test passed\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
