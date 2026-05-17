"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  archiveSessionTypeAction,
  unarchiveSessionTypeAction,
  type SessionTypeArchiveActionState,
} from "@/app/session-types/actions";
import { Button } from "@/components/ui/button";

export function SessionTypeArchiveButton({
  sessionTypeId,
  isActive,
}: {
  sessionTypeId: string;
  isActive: boolean;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const action = isActive ? archiveSessionTypeAction : unarchiveSessionTypeAction;
  const [state, formAction] = useActionState<
    SessionTypeArchiveActionState,
    FormData
  >(action.bind(null, sessionTypeId), {});

  return (
    <form action={formAction} className="space-y-2">
      {state.errors?._global ? (
        <p className="max-w-64 text-xs text-danger">{state.errors._global[0]}</p>
      ) : null}
      <ArchiveSubmitButton
        confirmed={confirmed}
        isActive={isActive}
        onPrime={() => setConfirmed(true)}
      />
    </form>
  );
}

function ArchiveSubmitButton({
  confirmed,
  isActive,
  onPrime,
}: {
  confirmed: boolean;
  isActive: boolean;
  onPrime: () => void;
}) {
  const { pending } = useFormStatus();
  const label = isActive ? "Archive" : "Unarchive";

  if (!confirmed) {
    return (
      <Button
        type="button"
        variant="ghost"
        className="h-auto w-full justify-start px-2 py-1.5 text-sm text-danger hover:text-danger"
        onClick={onPrime}
      >
        {label}
      </Button>
    );
  }

  return (
    <Button
      type="submit"
      variant="ghost"
      className="h-auto w-full justify-start px-2 py-1.5 text-sm text-danger hover:text-danger"
      disabled={pending}
    >
      {pending ? "Working..." : `Confirm ${label}`}
    </Button>
  );
}
