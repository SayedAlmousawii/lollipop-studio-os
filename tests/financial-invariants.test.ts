import "dotenv/config";

import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { withIsolatedBackendInvariantSchema } from "./backend-invariants/harness";

test("financial invariants all pass against seeded fixtures", async () => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    process.env.DATABASE_URL = databaseUrl;

    const [{ db }, { seedAllSharedFixtures }, { runAllInvariants }] = await Promise.all([
      import("../src/lib/db"),
      import("./fixtures/financial"),
      import("../src/modules/financial/invariants"),
    ]);

    try {
      await seedAllSharedFixtures(db);
      const violations = await runAllInvariants(db);
      assert.deepEqual(violations, []);
    } finally {
      await db.$disconnect();
    }
  });
});
