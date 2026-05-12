"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { FlaskConical, X } from "lucide-react";
import {
  createTestBookingAction,
  type CreateTestBookingActionState,
} from "@/app/dev/actions";
import { Button } from "@/components/ui/button";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant="outline"
      size="sm"
      disabled={pending}
      className="border-warning/30 bg-warning-soft text-warning hover:bg-warning-soft hover:text-warning"
    >
      <FlaskConical className="h-4 w-4" />
      {pending ? "Creating…" : "Create Test Booking"}
    </Button>
  );
}

export function DevCreateTestBookingButton() {
  const [state, formAction] = useActionState<
    CreateTestBookingActionState,
    FormData
  >(createTestBookingAction, {});
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
    <div className="space-y-2">
      <form action={formAction}>
        <SubmitButton />
      </form>

      {showMessage ? (
        <div
          className="flex max-w-md items-start gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-secondary shadow-sm"
          role={messageTone === "error" ? "alert" : "status"}
        >
          <span className="flex-1">{messageText}</span>
          <button
            type="button"
            onClick={() => setDismissedToken(messageToken)}
            className="rounded-sm p-0.5 text-text-muted transition-colors hover:bg-surface-soft hover:text-text-primary"
            aria-label="Dismiss test booking message"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
