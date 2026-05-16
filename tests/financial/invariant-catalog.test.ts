import "dotenv/config";

import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { withIsolatedBackendInvariantSchema } from "../backend-invariants/harness";

test("financial invariant catalog entries are unique and runnable", async () => {
  const { INVARIANT_CATALOG } = await import(
    "../../src/modules/financial/invariant-catalog"
  );

  assert.ok(INVARIANT_CATALOG.length > 0, "catalog should not be empty");
  assert.equal(
    new Set(INVARIANT_CATALOG.map((invariant) => invariant.id)).size,
    INVARIANT_CATALOG.length,
    "catalog ids should be unique"
  );

  for (const invariant of INVARIANT_CATALOG) {
    assert.equal(
      typeof invariant.run,
      "function",
      `${invariant.id} should expose a run function`
    );
  }
});

test("financial invariant catalog reports zero violations on a clean database", async () => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const [
        { db },
        { INVARIANT_CATALOG },
        { runInReadOnlyReconciliationTransaction },
      ] = await Promise.all([
        import("../../src/lib/db"),
        import("../../src/modules/financial/invariant-catalog"),
        import("../../src/modules/financial/reconciliation.service"),
      ]);

      const runtimeViolations: unknown[] = [];
      for (const invariant of INVARIANT_CATALOG) {
        if (invariant.kind !== "runtime") {
          continue;
        }

        runtimeViolations.push(...(await invariant.run({ tx: db })));
      }
      assert.deepEqual(runtimeViolations, []);

      await runInReadOnlyReconciliationTransaction(db, async (tx) => {
        const runAt = new Date("2026-05-16T00:00:00.000Z");
        const context = {
          runAt,
          businessDateStart: new Date("2026-05-15T00:00:00.000Z"),
          businessDateEnd: new Date("2026-05-16T00:00:00.000Z"),
        };
        const reconciliationViolations: unknown[] = [];

        for (const invariant of INVARIANT_CATALOG) {
          if (invariant.kind !== "reconciliation") {
            continue;
          }

          reconciliationViolations.push(...(await invariant.run(tx, context)));
        }

        assert.deepEqual(reconciliationViolations, []);
      });
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });
});
