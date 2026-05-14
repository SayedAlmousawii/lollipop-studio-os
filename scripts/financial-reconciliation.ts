import "dotenv/config";

import process from "node:process";
import { db } from "@/lib/db";
import { runAllInvariants } from "@/modules/financial/invariants";

const SLACK_WEBHOOK_ATTEMPTS = 3;
const SLACK_WEBHOOK_TIMEOUT_MS = 10_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function postToSlackIfConfigured(message: string): Promise<void> {
  const webhook = process.env.FINANCIAL_RECON_SLACK_WEBHOOK;
  if (!webhook) {
    return;
  }

  const channel = process.env.FINANCIAL_RECON_SLACK_CHANNEL;
  for (let attempt = 1; attempt <= SLACK_WEBHOOK_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(webhook, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          text: message,
          ...(channel ? { channel } : {}),
        }),
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
  try {
    const violations = await runAllInvariants(db);

    if (violations.length > 0) {
      const message = `Financial invariant violations detected (${violations.length})`;
      await postToSlackIfConfigured(message);
      console.error("Financial invariant violations:", violations);
      process.exitCode = 1;
      return;
    }

    console.log("Financial invariants: OK");
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
