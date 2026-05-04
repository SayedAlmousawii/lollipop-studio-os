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
  CustomerStatusBadge,
} from "./customer-status-badge";
import type { Customer } from "@/modules/customers/customer.types";

export type { Customer };

interface CustomersTableProps {
  customers: Customer[];
}

export function CustomersTable({ customers }: CustomersTableProps) {
  return (
    <div className="overflow-x-auto rounded-[14px] border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="border-border bg-surface-soft">
            <TableHead className="text-text-secondary">Full Name</TableHead>
            <TableHead className="text-text-secondary">Phone</TableHead>
            <TableHead className="text-text-secondary">Children</TableHead>
            <TableHead className="text-text-secondary">Total Bookings</TableHead>
            <TableHead className="text-text-secondary">Last Session</TableHead>
            <TableHead className="text-text-secondary">Status</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {customers.map((customer) => (
            <TableRow
              key={customer.id}
              className="border-border hover:bg-surface-soft"
            >
              <TableCell className="font-medium text-text-primary">
                {customer.fullName}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {customer.phone}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {customer.childrenCount}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {customer.totalBookings}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {customer.lastSessionDate}
              </TableCell>
              <TableCell>
                <CustomerStatusBadge status={customer.status} />
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
                    <DropdownMenuItem>View Profile</DropdownMenuItem>
                    <DropdownMenuItem>New Booking</DropdownMenuItem>
                    <DropdownMenuItem>Edit Customer</DropdownMenuItem>
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
