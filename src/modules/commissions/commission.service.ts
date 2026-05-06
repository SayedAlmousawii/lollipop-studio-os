import { Prisma } from "@prisma/client";

type DbClient = Prisma.TransactionClient;

export interface SyncUpgradeCommissionInput {
  orderId: string;
  upgradeAmount: Prisma.Decimal;
}

export async function syncUpgradeCommissionForOrder(
  _client: DbClient,
  input: SyncUpgradeCommissionInput
): Promise<void> {
  if (input.upgradeAmount.lessThanOrEqualTo(0)) return;

  // Commission persistence lands in the commission unit; this hook keeps
  // upgrade finalization wired through the service layer instead of the UI.
}
