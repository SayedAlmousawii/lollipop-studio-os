"use client";

import { cn } from "@/lib/utils";
import type {
  BookingPhotographerOption,
  RecommendedPhotographer,
} from "@/modules/bookings/booking.service";
import { CheckInDialog } from "./check-in-dialog";

interface CheckInDropdownItemProps {
  bookingId: string;
  assignedPhotographerId: string;
  photographers: BookingPhotographerOption[];
  recommendedPhotographer: RecommendedPhotographer;
}

export function CheckInDropdownItem({
  bookingId,
  assignedPhotographerId,
  photographers,
  recommendedPhotographer,
}: CheckInDropdownItemProps) {
  return (
    <CheckInDialog
      bookingId={bookingId}
      assignedPhotographerId={assignedPhotographerId}
      photographers={photographers}
      recommendedPhotographer={recommendedPhotographer}
      trigger={<DropdownTriggerButton>Check In</DropdownTriggerButton>}
      errorClassName="text-xs leading-5 text-danger"
    />
  );
}

function DropdownTriggerButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="button"
      onSelect={(event) => event.preventDefault()}
      className={cn(
        "flex w-full select-none items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent focus:bg-accent disabled:pointer-events-none disabled:opacity-50",
        "text-text-primary"
      )}
    >
      {children}
    </button>
  );
}
