"use client";

import { useActionState, useRef } from "react";
import { useFormStatus } from "react-dom";
import {
  checkInBookingAction,
  type CheckInBookingActionState,
} from "@/app/bookings/[bookingId]/actions";
import { Button } from "@/components/ui/button";

interface CheckInButtonProps {
  bookingId: string;
}

export function CheckInButton({ bookingId }: CheckInButtonProps) {
  const [state, formAction] = useActionState<
    CheckInBookingActionState,
    FormData
  >(checkInBookingAction, {});
  const allowSubmitRef = useRef(false);

  return (
    <form
      action={formAction}
      className="space-y-2"
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
      <SubmitButton />
      {state.errors?._global ? (
        <p className="text-sm text-danger" role="alert" aria-live="assertive">
          {state.errors._global[0]}
        </p>
      ) : null}
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Checking in..." : "Check In"}
    </Button>
  );
}
