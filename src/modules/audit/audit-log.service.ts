import { type AuditAction, type AuditEntityType, Prisma } from "@prisma/client";
import type { ActorContext } from "@/lib/auth/actor-context";
import { db } from "@/lib/db";

type DbClient = typeof db | Prisma.TransactionClient;
type AuditJsonValue =
  | string
  | number
  | boolean
  | null
  | AuditJsonValue[]
  | { [key: string]: AuditJsonValue };
type AuditJsonRecord = Record<string, AuditJsonValue>;

export async function recordAuditLog(
  client: DbClient,
  actorContext: ActorContext,
  input: {
    entityType: AuditEntityType;
    entityId: string;
    action: AuditAction;
    before?: AuditJsonRecord | null;
    after?: AuditJsonRecord | null;
    context?: AuditJsonRecord;
  }
): Promise<void> {
  if (!actorContext.actorUserId.trim()) {
    throw new Error("actorUserId is required to record an audit log");
  }

  await client.auditLog.create({
    data: {
      actorUserId: actorContext.actorUserId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      before: input.before
        ? (input.before as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      after: input.after
        ? (input.after as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      context: (input.context ?? {}) as Prisma.InputJsonValue,
    },
  });
}
