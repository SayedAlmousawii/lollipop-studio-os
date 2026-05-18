"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { RotateCcw, X } from "lucide-react";
import {
  resetSessionConfigurationsAction,
  type ResetSessionConfigurationsActionState,
} from "@/app/session-configurations/actions";
import { Button } from "@/components/ui/button";

export function DevResetSessionConfigurationsButton() {
  const [state, formAction] = useActionState<
    ResetSessionConfigurationsActionState,
    FormData
  >(resetSessionConfigurationsAction, {});
  const [dismissedToken, setDismissedToken] = useState<number | null>(null);
  const messageText = state.error ?? state.message;
  const messageToken = state.token ?? null;
  const showMessage = Boolean(
    messageText && messageToken !== null && messageToken !== dismissedToken
  );

  useEffect(() => {
    if (!messageText || messageToken === null) return;

    const timeout = window.setTimeout(() => setDismissedToken(messageToken), 4000);
    return () => window.clearTimeout(timeout);
  }, [messageText, messageToken]);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          "Reset session configurations, options, and saved order-package selections?"
        );
        if (!confirmed) event.preventDefault();
      }}
      className="relative"
    >
      <SubmitButton />
      {showMessage ? (
        <span
          className="absolute right-0 top-11 z-10 flex w-max max-w-72 items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-secondary shadow-md"
          role={state.error ? "alert" : "status"}
        >
          <span>{messageText}</span>
          <button
            type="button"
            onClick={() => setDismissedToken(messageToken)}
            className="rounded-sm p-0.5 text-text-muted transition-colors hover:bg-surface-soft hover:text-text-primary"
            aria-label="Dismiss reset message"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ) : null}
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant="outline"
      disabled={pending}
      className="border-warning-soft text-warning hover:bg-warning-soft hover:text-warning"
      title="Reset session configuration test data"
    >
      <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
      {pending ? "Resetting..." : "Reset Configs"}
    </Button>
  );
}
