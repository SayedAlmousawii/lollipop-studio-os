import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import process from "node:process";
import {
  executeFinancialReconciliation,
  postReconciliationAlerts,
  type ReconciliationAlertPayload,
} from "@/modules/financial/reconciliation.service";

const SLACK_WEBHOOK_ATTEMPTS = 3;
const SLACK_WEBHOOK_TIMEOUT_MS = 10_000;

function createReconciliationClient(databaseUrl: string): PrismaClient {
  const schema = new URL(databaseUrl).searchParams.get("schema") ?? undefined;
  return new PrismaClient({
    adapter: new PrismaPg(databaseUrl, { schema }),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function resolveDatabaseUrl(): string {
  const reconciliationUrl = process.env.FINANCIAL_RECON_DATABASE_URL;
  if (reconciliationUrl) {
    return reconciliationUrl;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "FINANCIAL_RECON_DATABASE_URL is required for production reconciliation"
    );
  }

  const developmentUrl = process.env.DATABASE_URL;
  if (!developmentUrl) {
    throw new Error(
      "FINANCIAL_RECON_DATABASE_URL or DATABASE_URL is required for reconciliation"
    );
  }

  console.warn(
    "FINANCIAL_RECON_DATABASE_URL is not set; using DATABASE_URL for local reconciliation only"
  );
  return developmentUrl;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function postSlackAlert(payload: ReconciliationAlertPayload): Promise<void> {
  const webhook = process.env.FINANCIAL_RECON_SLACK_WEBHOOK;
  if (!webhook) {
    console.warn("FINANCIAL_RECON_SLACK_WEBHOOK is not set; alert written to logs only");
    console.warn(payload.text);
    return;
  }

  for (let attempt = 1; attempt <= SLACK_WEBHOOK_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(webhook, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(SLACK_WEBHOOK_TIMEOUT_MS),
      });

      if (response.ok) {
        return;
      }

      const body = await response.text();
      const retryable = response.status >= 500 && response.status < 600;
      console.error(
        `Slack webhook failed: status=${response.status} attempt=${attempt}/${SLACK_WEBHOOK_ATTEMPTS} body=${body}`
      );

      if (!retryable || attempt === SLACK_WEBHOOK_ATTEMPTS) {
        return;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(
        `Slack webhook failed: status=network-error attempt=${attempt}/${SLACK_WEBHOOK_ATTEMPTS} error=${detail}`
      );

      if (attempt === SLACK_WEBHOOK_ATTEMPTS) {
        return;
      }
    }

    await wait(100 * 2 ** (attempt - 1));
  }
}

async function main() {
  const databaseUrl = resolveDatabaseUrl();
  const db = createReconciliationClient(databaseUrl);

  try {
    const report = await executeFinancialReconciliation(db);
    await postReconciliationAlerts(
      report,
      postSlackAlert,
      process.env.FINANCIAL_RECON_SLACK_CHANNEL
    );

    console.log(
      JSON.stringify(
        {
          ...report,
          runAt: report.runAt.toISOString(),
          businessDateStart: report.businessDateStart.toISOString(),
          businessDateEnd: report.businessDateEnd.toISOString(),
          violations: report.violations.map((violation) => ({
            ...violation,
            detectedAt: violation.detectedAt.toISOString(),
          })),
        },
        null,
        2
      )
    );

    if (report.violations.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
});
