"use client";

import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
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

export interface Booking {
  id: string;
  customerName: string;
  sessionDate: string;
  department: string;
  package: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  assignedPhotographerName: string;
}

interface BookingsTableProps {
  bookings: Booking[];
}

export function BookingsTable({ bookings }: BookingsTableProps) {
  return (
    <div className="overflow-x-auto rounded-[14px] border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="border-border bg-surface-soft">
            <TableHead className="text-text-secondary">Customer</TableHead>
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
            <TableRowWithActions key={booking.id} booking={booking} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function TableRowWithActions({ booking }: { booking: Booking }) {
  const canRecordDeposit =
    booking.status === "Pending" && booking.paymentStatus !== "Paid";

  return (
    <TableRow className="border-border hover:bg-surface-soft">
      <TableCell className="font-medium text-text-primary">
        {booking.customerName}
      </TableCell>
      <TableCell className="text-sm text-text-secondary">
        {booking.sessionDate}
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Open actions</span>
            </Button>
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
            {booking.status === "Pending" || booking.status === "Confirmed" ? (
              <>
                <DropdownMenuSeparator />
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
