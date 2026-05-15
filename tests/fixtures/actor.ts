import { UserRole } from "@prisma/client";
import type { ActorContext } from "@/lib/auth";

type ActorBuilderInput = {
  actorUserId?: string;
};

function makeActor(actorRole: UserRole, input: ActorBuilderInput = {}): ActorContext {
  return {
    actorUserId: input.actorUserId ?? `${actorRole.toLowerCase()}-actor`,
    actorRole,
  };
}

export function makeManagerActor(input?: ActorBuilderInput): ActorContext {
  return makeActor(UserRole.MANAGER, input);
}

export function makeStaffActor(input?: ActorBuilderInput): ActorContext {
  return makeActor(UserRole.RECEPTIONIST, input);
}

export function makePhotographerActor(input?: ActorBuilderInput): ActorContext {
  return makeActor(UserRole.PHOTOGRAPHER, input);
}

export function makeEditorActor(input?: ActorBuilderInput): ActorContext {
  return makeActor(UserRole.EDITOR, input);
}
