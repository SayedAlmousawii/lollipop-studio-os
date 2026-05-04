import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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

export interface Booking {
  id: string;
  customerName: string;
  sessionDate: string;
  package: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  assignedStaff: string;
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
            <TableHead className="text-text-secondary">Package</TableHead>
            <TableHead className="text-text-secondary">Status</TableHead>
            <TableHead className="text-text-secondary">Payment</TableHead>
            <TableHead className="text-text-secondary">Assigned Staff</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bookings.map((booking) => (
            <TableRow
              key={booking.id}
              className="border-border hover:bg-surface-soft"
            >
              <TableCell className="font-medium text-text-primary">
                {booking.customerName}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {booking.sessionDate}
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
                {booking.assignedStaff}
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
                    <DropdownMenuItem>View Details</DropdownMenuItem>
                    <DropdownMenuItem>Edit Booking</DropdownMenuItem>
                    <DropdownMenuItem>Cancel Booking</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
