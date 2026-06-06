import { db } from "@/lib/db";
import { backfillOrderCommitsForFinanciallyCommittedOrders } from "@/modules/order-commits";

async function main() {
  const result = await backfillOrderCommitsForFinanciallyCommittedOrders();

  console.log(JSON.stringify(result, null, 2));

  if (result.failed.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("OrderCommit backfill failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
