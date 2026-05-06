import type { OrderActivityType, Prisma } from "@prisma/client";

export interface OrderActivityTimelineItem {
  id: string;
  orderId: string;
  userId: string | null;
  type: OrderActivityType;
  title: string;
  description: string | null;
  metadata: Prisma.JsonValue;
  createdAt: string;
}
