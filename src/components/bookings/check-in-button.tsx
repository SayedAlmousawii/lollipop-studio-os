"use client";

import { Button } from "@/components/ui/button";
import type {
  BookingPhotographerOption,
  RecommendedPhotographer,
} from "@/modules/bookings/booking.service";
import { CheckInDialog } from "./check-in-dialog";

interface CheckInButtonProps {
  bookingId: string;
  assignedPhotographerId: string;
  photographers: BookingPhotographerOption[];
  recommendedPhotographer: RecommendedPhotographer;
}

export function CheckInButton({
  bookingId,
  assignedPhotographerId,
  photographers,
  recommendedPhotographer,
}: CheckInButtonProps) {
  return (
    <CheckInDialog
      bookingId={bookingId}
      assignedPhotographerId={assignedPhotographerId}
      photographers={photographers}
      recommendedPhotographer={recommendedPhotographer}
      trigger={<Button>Check In</Button>}
    />
  );
}
