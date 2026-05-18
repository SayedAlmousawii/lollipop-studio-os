import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";

export async function resetSessionConfigurationTestData(): Promise<void> {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Session configuration reset is only available in development.");
  }

  await withRetry(
    () =>
      db.$transaction(
        async (tx) => {
          await tx.orderPackageSessionConfigurationSelection.deleteMany({});
          await tx.sessionConfigurationOption.deleteMany({});
          await tx.sessionConfiguration.deleteMany({});
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      ),
    "Failed to reset session configuration test data"
  );
}
