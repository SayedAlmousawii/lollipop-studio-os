"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { RotateCcw, X } from "lucide-react";
import {
  resetWorkflowAction,
  type ResetWorkflowActionState,
} from "@/app/dev/actions";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="flex h-9 w-9 items-center justify-center rounded-md text-warning transition-colors hover:bg-warning-soft hover:text-warning disabled:cursor-not-allowed disabled:opacity-50"
      aria-label="Reset workflow test data"
      title="Reset workflow test data"
    >
      <RotateCcw className="h-4 w-4" />
    </button>
  );
}

export function DevResetWorkflowButton() {
  const [state, formAction] = useActionState<
    ResetWorkflowActionState,
    FormData
  >(resetWorkflowAction, {});
  const [dismissedToken, setDismissedToken] = useState<number | null>(null);
  const messageText = state.error ?? state.message;
  const messageTone = state.error ? "error" : "success";
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
          "Reset bookings, orders, invoices, payments, and workflow sequences?"
        );
        if (!confirmed) event.preventDefault();
      }}
      className="relative"
    >
      <SubmitButton />
      {showMessage ? (
        <span
          className="absolute right-0 top-10 z-10 flex w-max max-w-64 items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-secondary shadow-md"
          role={messageTone === "error" ? "alert" : "status"}
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
