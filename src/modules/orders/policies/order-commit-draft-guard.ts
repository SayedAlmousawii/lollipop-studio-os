import type { Prisma } from "@prisma/client";
import type { ActorContext } from "@/lib/auth/actor-context";
import { OrderCommitDraftActiveError } from "@/modules/orders/order.errors";

type OrderCommitDraftGuardClient = Pick<
  Prisma.TransactionClient,
  "orderCommitDraft"
>;

export async function assertNoActiveOrderCommitDraft(input: {
  orderId: string;
  actorContext: ActorContext;
  tx: OrderCommitDraftGuardClient;
}): Promise<void> {
  const draft = await input.tx.orderCommitDraft.findUnique({
    where: { orderId: input.orderId },
    select: { id: true },
  });
  if (draft) {
    throw new OrderCommitDraftActiveError();
  }
}
