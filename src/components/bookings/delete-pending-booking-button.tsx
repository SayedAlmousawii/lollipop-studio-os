"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  deletePendingBookingAction,
  type DeletePendingBookingActionState,
} from "@/app/bookings/actions";
import { Button } from "@/components/ui/button";

interface DeletePendingBookingButtonProps {
  bookingId: string;
}

export function DeletePendingBookingButton({
  bookingId,
}: DeletePendingBookingButtonProps) {
  const [state, formAction] = useActionState<
    DeletePendingBookingActionState,
    FormData
  >(deletePendingBookingAction, {});

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="bookingId" value={bookingId} />
      <DeleteButton />
      {state.errors?._global ? (
        <p className="text-sm text-danger" role="alert" aria-live="assertive">
          {state.errors._global[0]}
        </p>
      ) : null}
    </form>
  );
}

function DeleteButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant="destructive"
      disabled={pending}
      onClick={(event) => {
        if (
          !window.confirm(
            "Delete this pending booking? This removes the calendar hold permanently."
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      {pending ? "Deleting..." : "Delete Pending Booking"}
    </Button>
  );
}
