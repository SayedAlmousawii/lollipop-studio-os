import "dotenv/config";

import process from "node:process";
import { db } from "@/lib/db";
import { runAllInvariants } from "@/modules/financial/invariants";

async function postToSlackIfConfigured(message: string): Promise<void> {
  const webhook = process.env.FINANCIAL_RECON_SLACK_WEBHOOK;
  if (!webhook) {
    return;
  }

  const channel = process.env.FINANCIAL_RECON_SLACK_CHANNEL;
  const response = await fetch(webhook, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      text: message,
      ...(channel ? { channel } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook failed with status ${response.status}`);
  }
}

async function main() {
  try {
    const violations = await runAllInvariants(db);

    if (violations.length > 0) {
      const message = `Financial invariant violations detected (${violations.length})`;
      await postToSlackIfConfigured(message);
      console.error("Financial invariant violations:", violations);
      process.exit(1);
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
