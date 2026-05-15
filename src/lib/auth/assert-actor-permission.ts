import type { ActorContext } from "./actor-context";
import { hasPermission, type Permission } from "@/lib/permissions";

export class ForbiddenError extends Error {
  permission: Permission;

  constructor(permission: Permission) {
    super(`Permission denied: ${permission}`);
    this.name = "ForbiddenError";
    this.permission = permission;
  }
}

export class MissingActorRoleError extends Error {
  constructor() {
    super("actorRole is required for permission checks");
    this.name = "MissingActorRoleError";
  }
}

export function assertActorPermission(
  actorContext: ActorContext,
  permission: Permission
): void {
  if (!actorContext.actorRole) {
    throw new MissingActorRoleError();
  }

  if (!hasPermission({ role: actorContext.actorRole }, permission)) {
    throw new ForbiddenError(permission);
  }
}
