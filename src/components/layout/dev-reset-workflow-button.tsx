"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { RotateCcw } from "lucide-react";
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
      {state.error || state.message ? (
        <span className="absolute right-0 top-10 z-10 w-max max-w-64 rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-secondary shadow-md">
          {state.error ?? state.message}
        </span>
      ) : null}
    </form>
  );
}
