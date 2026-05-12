"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { CheckInDialog } from "@/components/bookings/check-in-dialog";
import { DeletePendingBookingDropdownItem } from "@/components/bookings/delete-pending-booking-dropdown-item";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BookingStatusBadge,
  type BookingStatus,
} from "./booking-status-badge";
import {
  PaymentStatusBadge,
  type PaymentStatus,
} from "./payment-status-badge";
import { BookingStatusActions } from "./booking-status-actions";
import { RecordDepositDialog } from "./record-deposit-dialog";
import type {
  BookingPhotographerOption,
  RecommendedPhotographer,
} from "@/modules/bookings/booking.service";

export interface Booking {
  id: string;
  customerId: string;
  jobNumber: string;
  customerPhone: string;
  sessionDate: string;
  sessionTime: string;
  department: string;
  package: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  assignedPhotographerId: string;
  assignedPhotographerName: string;
  recommendedPhotographer: RecommendedPhotographer;
  canDeletePending: boolean;
  canCheckIn: boolean;
}

interface BookingsTableProps {
  bookings: Booking[];
  photographers: BookingPhotographerOption[];
}

export function BookingsTable({ bookings, photographers }: BookingsTableProps) {
  return (
    <div className="overflow-x-auto rounded-[14px] border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="border-border bg-surface-soft">
            <TableHead className="text-text-secondary">Job Number</TableHead>
            <TableHead className="text-text-secondary">Customer Phone</TableHead>
            <TableHead className="text-text-secondary">Session Date</TableHead>
            <TableHead className="text-text-secondary">Department</TableHead>
            <TableHead className="text-text-secondary">Package</TableHead>
            <TableHead className="text-text-secondary">Status</TableHead>
            <TableHead className="text-text-secondary">Deposit</TableHead>
            <TableHead className="text-text-secondary">
              Assigned Photographer
            </TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bookings.map((booking) => (
            <TableRowWithActions
              key={booking.id}
              booking={booking}
              photographers={photographers}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function TableRowWithActions({
  booking,
  photographers,
}: {
  booking: Booking;
  photographers: BookingPhotographerOption[];
}) {
  const [checkInDialogOpen, setCheckInDialogOpen] = useState(false);
  const canRecordDeposit =
    booking.status === "Pending" && booking.paymentStatus !== "Paid";
  const showStatusActions =
    booking.canDeletePending || booking.canCheckIn || booking.status === "Confirmed";

  return (
    <TableRow className="border-border hover:bg-surface-soft">
      <TableCell className="text-sm font-medium text-text-primary">
        {booking.jobNumber}
      </TableCell>
      <TableCell className="font-medium tabular-nums text-text-primary">
        {booking.customerPhone}
      </TableCell>
      <TableCell className="text-sm text-text-secondary">
        {booking.sessionDate} · {booking.sessionTime}
      </TableCell>
      <TableCell className="text-sm text-text-secondary">
        {booking.department}
      </TableCell>
      <TableCell className="text-sm text-text-secondary">
        {booking.package}
      </TableCell>
      <TableCell>
        <BookingStatusBadge status={booking.status} />
      </TableCell>
      <TableCell>
        <PaymentStatusBadge status={booking.paymentStatus} />
      </TableCell>
      <TableCell className="text-sm text-text-secondary">
        {booking.assignedPhotographerName}
      </TableCell>
      <TableCell>
        {booking.canCheckIn ? (
          <CheckInDialog
            bookingId={booking.id}
            assignedPhotographerId={booking.assignedPhotographerId}
            photographers={photographers}
            recommendedPhotographer={booking.recommendedPhotographer}
            open={checkInDialogOpen}
            onOpenChange={setCheckInDialogOpen}
            errorClassName="text-xs leading-5 text-danger"
          />
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "h-8 w-8"
            )}
          >
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">Open actions</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/bookings/${booking.id}`}>View Details</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/bookings/${booking.id}/edit`}>Edit Booking</Link>
            </DropdownMenuItem>
            {canRecordDeposit ? (
              <RecordDepositDialog
                bookingId={booking.id}
                trigger={
                  <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
                    Record Deposit
                  </DropdownMenuItem>
                }
              />
            ) : null}
            {showStatusActions ? (
              <>
                <DropdownMenuSeparator />
                {booking.canCheckIn ? (
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      setCheckInDialogOpen(true);
                    }}
                  >
                    Check In
                  </DropdownMenuItem>
                ) : null}
                {booking.canDeletePending ? (
                  <DeletePendingBookingDropdownItem bookingId={booking.id} />
                ) : null}
                <BookingStatusActions
                  bookingId={booking.id}
                  status={booking.status}
                  depositStatus={booking.paymentStatus}
                />
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
