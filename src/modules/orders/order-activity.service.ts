import { OrderActivityType, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import type { OrderActivityTimelineItem } from "./order-activity.types";

type DbClient = typeof db | Prisma.TransactionClient;

export interface RecordOrderActivityInput {
  orderId: string;
  userId?: string | null;
  type: OrderActivityType;
  title: string;
  description?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export async function recordOrderActivity(
  client: DbClient,
  input: RecordOrderActivityInput
): Promise<void> {
  await client.orderActivity.create({
    data: {
      orderId: input.orderId,
      userId: input.userId ?? null,
      type: input.type,
      title: input.title,
      description: input.description ?? null,
      metadata: input.metadata ?? {},
    },
  });
}

export interface RecordGuardBlockedInput {
  orderId: string;
  userId?: string | null;
  attemptedAction: string;
  reason: string;
  metadata?: Prisma.InputJsonValue;
}

export async function recordGuardBlockedActivity(
  input: RecordGuardBlockedInput
): Promise<void> {
  await db.orderActivity.create({
    data: {
      orderId: input.orderId,
      userId: input.userId ?? null,
      type: OrderActivityType.GUARD_BLOCKED,
      title: "Action blocked by workflow guard",
      description: input.reason,
      metadata: {
        attemptedAction: input.attemptedAction,
        reason: input.reason,
        ...(input.metadata as object | undefined),
      },
    },
  });
}

export async function getOrderActivityTimeline(
  orderId: string
): Promise<OrderActivityTimelineItem[]> {
  const rows = await withRetry(
    () =>
      db.orderActivity.findMany({
        where: { orderId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    "Failed to fetch order activity"
  );

  return rows.map((row) => ({
    id: row.id,
    orderId: row.orderId,
    userId: row.userId,
    type: row.type,
    title: row.title,
    description: row.description,
    metadata: row.metadata,
    createdAt: formatDateTime(row.createdAt),
  }));
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}
