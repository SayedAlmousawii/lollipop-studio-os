"use client";

import { useActionState, useRef } from "react";
import { useFormStatus } from "react-dom";
import {
  checkInBookingAction,
  type CheckInBookingActionState,
} from "@/app/bookings/[bookingId]/actions";
import { cn } from "@/lib/utils";

interface CheckInDropdownItemProps {
  bookingId: string;
}

export function CheckInDropdownItem({
  bookingId,
}: CheckInDropdownItemProps) {
  const [state, formAction] = useActionState<
    CheckInBookingActionState,
    FormData
  >(checkInBookingAction, {});
  const allowSubmitRef = useRef(false);

  return (
    <form
      action={formAction}
      className="space-y-1"
      onSubmit={(event) => {
        if (allowSubmitRef.current) {
          allowSubmitRef.current = false;
          return;
        }

        event.preventDefault();

        if (
          !window.confirm(
            "Check in this booking? This creates the JOB reference and order and cannot be undone."
          )
        ) {
          return;
        }

        allowSubmitRef.current = true;
        event.currentTarget.requestSubmit();
      }}
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <DropdownSubmitButton>Check In</DropdownSubmitButton>
      {state.errors?._global ? (
        <p className="max-w-64 px-2 py-1 text-xs leading-5 text-danger">
          {state.errors._global[0]}
        </p>
      ) : null}
    </form>
  );
}

function DropdownSubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "flex w-full select-none items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent focus:bg-accent disabled:pointer-events-none disabled:opacity-50",
        "text-text-primary"
      )}
    >
      {pending ? "Checking in..." : children}
    </button>
  );
}
