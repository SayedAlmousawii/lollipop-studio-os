"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { BookingStatus as PrismaBookingStatus } from "@prisma/client";
import {
  updateBookingStatusAction,
  type UpdateBookingStatusActionState,
} from "@/app/bookings/actions";
import { cn } from "@/lib/utils";
import type { BookingStatus } from "./booking-status-badge";
import type { PaymentStatus } from "./payment-status-badge";

interface BookingStatusActionsProps {
  bookingId: string;
  status: BookingStatus;
  depositStatus: PaymentStatus;
}

const STATUS_ACTIONS: Partial<
  Record<
    BookingStatus,
    {
      label: string;
      nextStatus: PrismaBookingStatus;
      confirmationMessage?: string;
      isDestructive?: boolean;
    }[]
  >
> = {
  Pending: [
    { label: "Confirm Booking", nextStatus: "CONFIRMED" },
    {
      label: "Cancel Booking",
      nextStatus: "CANCELLED",
      confirmationMessage: "Cancel this booking?",
      isDestructive: true,
    },
  ],
  Confirmed: [
    {
      label: "Record No-Show",
      nextStatus: "NO_SHOW",
      confirmationMessage: "Mark this booking as a no-show?",
      isDestructive: true,
    },
    {
      label: "Cancel Booking",
      nextStatus: "CANCELLED",
      confirmationMessage: "Cancel this booking?",
      isDestructive: true,
    },
  ],
};

export function BookingStatusActions({
  bookingId,
  status,
  depositStatus,
}: BookingStatusActionsProps) {
  const [state, formAction] = useActionState<
    UpdateBookingStatusActionState,
    FormData
  >(updateBookingStatusAction, {});
  const actions = STATUS_ACTIONS[status] ?? [];

  if (actions.length === 0) return null;

  return (
    <div className="space-y-1">
      {actions.map((action) => {
        const depositRequired =
          action.nextStatus === "CONFIRMED" && depositStatus !== "Paid";

        return (
          <form action={formAction} key={action.nextStatus}>
            <input type="hidden" name="bookingId" value={bookingId} />
            <input type="hidden" name="nextStatus" value={action.nextStatus} />
            <StatusSubmitButton
              disabled={depositRequired}
              isDestructive={action.isDestructive ?? false}
              confirmationMessage={action.confirmationMessage}
            >
              {action.label}
            </StatusSubmitButton>
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
  children,
  disabled,
  isDestructive,
  confirmationMessage,
}: {
  children: ReactNode;
  disabled: boolean;
  isDestructive: boolean;
  confirmationMessage?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      onClick={(event) => {
        if (
          isDestructive &&
          confirmationMessage &&
          !window.confirm(confirmationMessage)
        ) {
          event.preventDefault();
        }
      }}
      className={cn(
        "flex w-full select-none items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent focus:bg-accent disabled:pointer-events-none disabled:opacity-50",
        isDestructive ? "text-danger" : "text-text-primary"
      )}
    >
      {pending ? "Saving..." : children}
    </button>
  );
}
