import "dotenv/config";

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const DEFAULT_PRISMA_COMMAND_TIMEOUT_MS = 300_000;

function getBaseDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  return databaseUrl;
}

function buildSchemaDatabaseUrl(baseDatabaseUrl: string, schemaName: string): string {
  const url = new URL(baseDatabaseUrl);
  url.searchParams.set("schema", schemaName);
  return url.toString();
}

function runPrismaCommand(args: string[], databaseUrl: string) {
  execFileSync("npx", ["prisma", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
    stdio: "inherit",
    timeout: Number(process.env.PRISMA_CMD_TIMEOUT ?? DEFAULT_PRISMA_COMMAND_TIMEOUT_MS),
    killSignal: "SIGTERM",
  });
}

export async function withIsolatedBackendInvariantSchema<T>(
  run: (databaseUrl: string) => Promise<T>
): Promise<T> {
  const baseDatabaseUrl = getBaseDatabaseUrl();
  const schemaName = `backend_invariants_${randomUUID().replace(/-/g, "")}`;
  const isolatedDatabaseUrl = buildSchemaDatabaseUrl(baseDatabaseUrl, schemaName);
  const adminDb = new Client({ connectionString: baseDatabaseUrl });

  try {
    await adminDb.connect();
    // Safe because schemaName is generated internally from randomUUID.
    await adminDb.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);

    runPrismaCommand(["migrate", "deploy"], isolatedDatabaseUrl);

    return await run(isolatedDatabaseUrl);
  } finally {
    await adminDb.end();

    const cleanupDb = new Client({ connectionString: baseDatabaseUrl });
    try {
      await cleanupDb.connect();
      // Safe because schemaName is generated internally from randomUUID.
      await cleanupDb.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    } finally {
      await cleanupDb.end();
    }
  }
}
