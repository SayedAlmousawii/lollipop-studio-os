"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  updateBookingStatusAction,
  type UpdateBookingStatusActionState,
} from "@/app/(app)/bookings/actions";
import { cn } from "@/lib/utils";
import type {
  BookingWorkflowAction,
  BookingWorkflowPolicy,
  WorkflowActionIntent,
} from "@/modules/bookings/booking-workflow-policy";

interface BookingStatusActionsProps {
  bookingId: string;
  policy: BookingWorkflowPolicy;
  presentation?: "dropdown" | "inline";
  showEmptyState?: boolean;
}

export function BookingStatusActions({
  bookingId,
  policy,
  presentation = "dropdown",
  showEmptyState = false,
}: BookingStatusActionsProps) {
  const [state, formAction] = useActionState<
    UpdateBookingStatusActionState,
    FormData
  >(updateBookingStatusAction, {});
  const actions = policy.actions.filter((action) => action.available);

  if (actions.length === 0) {
    if (!showEmptyState || !policy.emptyStateMessage) return null;

    return (
      <p className="max-w-64 px-2 py-1 text-xs leading-5 text-text-secondary">
        {policy.emptyStateMessage}
      </p>
    );
  }

  return (
    <div
      className={cn(
        presentation === "inline" ? "flex flex-wrap gap-2" : "space-y-1"
      )}
    >
      {actions.map((action) => {
        return (
          <form action={formAction} key={action.key}>
            <input type="hidden" name="bookingId" value={bookingId} />
            <input type="hidden" name="nextStatus" value={action.nextStatus} />
            <StatusSubmitButton
              action={action}
              presentation={presentation}
              disabled={action.disabled}
              confirmationMessage={action.confirmationMessage}
            />
          </form>
        );
      })}
      {state.errors?._global ? (
        <p className="max-w-64 px-2 py-1 text-xs leading-5 text-danger">
          {state.errors._global[0]}
        </p>
      ) : null}
    </div>
  );
}

function StatusSubmitButton({
  action,
  presentation,
  disabled,
  confirmationMessage,
}: {
  action: BookingWorkflowAction;
  presentation: "dropdown" | "inline";
  disabled: boolean;
  confirmationMessage: string | null;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      title={action.blockedReason ?? undefined}
      onClick={(event) => {
        if (confirmationMessage && !window.confirm(confirmationMessage)) {
          event.preventDefault();
        }
      }}
      className={cn(
        presentation === "inline"
          ? "inline-flex h-10 items-center justify-center rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50"
          : "flex w-full select-none items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent focus:bg-accent disabled:pointer-events-none disabled:opacity-50",
        intentClass(action.intent, presentation)
      )}
    >
      {pending ? "Saving..." : action.label}
    </button>
  );
}

function intentClass(
  intent: WorkflowActionIntent,
  presentation: "dropdown" | "inline"
): string {
  if (presentation === "inline") {
    if (intent === "destructive") {
      return "border-danger bg-surface text-danger hover:bg-danger-soft";
    }
    if (intent === "warning") {
      return "border-warning bg-surface text-warning hover:bg-warning-soft";
    }
    return "border-border bg-surface text-text-primary hover:bg-surface-soft";
  }

  if (intent === "destructive") return "text-danger";
  if (intent === "warning") return "text-warning";
  return "text-text-primary";
}
