import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { CalendarBooking } from "./calendar-mock-data";

type CalendarEventPopoverProps = {
  booking: CalendarBooking | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CalendarEventPopover({
  booking,
  open,
  onOpenChange,
}: CalendarEventPopoverProps) {
  if (!booking) return null;

  const details = booking.extendedProps;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-[var(--color-border)] bg-[var(--color-surface)]">
        <DialogHeader>
          <DialogTitle>{details.customerName}</DialogTitle>
          <DialogDescription>
            Booking details for the selected studio session.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="text-[var(--color-text-secondary)]">
            {details.sessionType} Session
          </p>

          <div className="flex justify-between">
            <span className="text-[var(--color-text-muted)]">Status</span>
            <Badge>{details.status}</Badge>
          </div>

          <div className="flex justify-between">
            <span className="text-[var(--color-text-muted)]">Package</span>
            <span>{details.packageName}</span>
          </div>

          <div className="flex justify-between">
            <span className="text-[var(--color-text-muted)]">
              Photographer
            </span>
            <span>{details.photographerName}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}