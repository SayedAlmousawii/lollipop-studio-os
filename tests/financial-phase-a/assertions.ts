import assert from "node:assert/strict";
import { Client } from "pg";
import type { PrismaClient } from "@prisma/client";
import type { PhaseACheck, PhaseAViolation } from "./types";

export async function expectNoRows<T extends { id?: string }>(
  layer: PhaseAViolation["layer"],
  invariant: string,
  entityType: string,
  expected: string,
  actual: string,
  rows: T[]
): Promise<PhaseAViolation[]> {
  return rows.map((row, index) => ({
    layer,
    invariant,
    entityType,
    entityId: row.id ?? String(index + 1),
    expected,
    actual,
  }));
}

export async function runPhaseAChecks(checks: PhaseACheck[]): Promise<void> {
  const violations: PhaseAViolation[] = [];

  for (const check of checks) {
    const checkViolations = await check.run();
    violations.push(...checkViolations);
  }

  assert.deepEqual(violations, [], formatViolations(violations));
}

export function formatViolations(violations: PhaseAViolation[]): string {
  return violations
    .map(
      (item) =>
        `${item.layer} ${item.invariant} ${item.entityType}:${item.entityId} expected ${item.expected}; actual ${item.actual}`
    )
    .join("\n");
}

export async function expectStatementToFail(
  databaseUrl: string,
  statement: string,
  params: unknown[] = []
): Promise<boolean> {
  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SAVEPOINT phase_a_negative_check");

    try {
      await client.query(statement, params);
      await client.query("ROLLBACK TO SAVEPOINT phase_a_negative_check");
      return false;
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT phase_a_negative_check");
      return true;
    }
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The connection may already be closed or outside a transaction.
    }
    await client.end();
  }
}

export async function getCurrentSchema(db: PrismaClient): Promise<string> {
  const rows = await db.$queryRaw<{ current_schema: string }[]>`SELECT current_schema()`;
  const currentSchema = rows[0]?.current_schema;
  if (!currentSchema) {
    throw new Error("Unable to resolve current schema for Phase A checks");
  }
  return currentSchema;
}
