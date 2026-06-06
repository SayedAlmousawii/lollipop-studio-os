import type { Prisma } from "@prisma/client";
import { orderCommitDocumentRoleSchema } from "./order-commit.schema";
import type { OrderCommitDocumentRole } from "./order-commit.types";

export type CreateOrderCommitDocumentLinksInput = {
  orderCommitId: string;
  emissions: Array<{
    invoice: { id: string };
    role: OrderCommitDocumentRole;
  }>;
  client: Prisma.TransactionClient;
};

export async function createOrderCommitDocumentLinks(
  input: CreateOrderCommitDocumentLinksInput
): Promise<{ created: number }> {
  if (input.emissions.length === 0) {
    return { created: 0 };
  }

  const result = await input.client.orderCommitDocument.createMany({
    data: input.emissions.map((emission) => ({
      orderCommitId: input.orderCommitId,
      invoiceId: emission.invoice.id,
      role: orderCommitDocumentRoleSchema.parse(emission.role),
    })),
  });

  return { created: result.count };
}
