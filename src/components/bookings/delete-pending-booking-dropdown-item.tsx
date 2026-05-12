"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  deletePendingBookingAction,
  type DeletePendingBookingActionState,
} from "@/app/bookings/actions";
import { cn } from "@/lib/utils";

interface DeletePendingBookingDropdownItemProps {
  bookingId: string;
}

export function DeletePendingBookingDropdownItem({
  bookingId,
}: DeletePendingBookingDropdownItemProps) {
  const [state, formAction] = useActionState<
    DeletePendingBookingActionState,
    FormData
  >(deletePendingBookingAction, {});

  return (
    <form action={formAction} className="space-y-1">
      <input type="hidden" name="bookingId" value={bookingId} />
      <DropdownSubmitButton />
      {state.errors?._global ? (
        <p className="max-w-64 px-2 py-1 text-xs leading-5 text-danger">
          {state.errors._global[0]}
        </p>
      ) : null}
    </form>
  );
}

function DropdownSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
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
      className={cn(
        "flex w-full select-none items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent focus:bg-accent disabled:pointer-events-none disabled:opacity-50",
        "text-danger"
      )}
    >
      {pending ? "Deleting..." : "Delete Pending Booking"}
    </button>
  );
}
