import type { UserRole } from "@prisma/client";

export interface ActorContext {
  actorUserId: string;
  actorRole: UserRole;
}
