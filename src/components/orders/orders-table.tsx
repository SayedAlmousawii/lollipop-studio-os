import Link from "next/link";
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
import { OrderStatusBadge } from "./order-status-badge";
import { InvoiceStatusBadge } from "./invoice-status-badge";
import type { Order } from "@/modules/orders/order.types";

interface OrdersTableProps {
  orders: Order[];
}

export function OrdersTable({ orders }: OrdersTableProps) {
  return (
    <div className="overflow-x-auto rounded-[14px] border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="border-border bg-surface-soft">
            <TableHead className="text-text-secondary">Customer</TableHead>
            <TableHead className="text-text-secondary">Booking Date</TableHead>
            <TableHead className="text-text-secondary">Original Package</TableHead>
            <TableHead className="text-text-secondary">Final Package</TableHead>
            <TableHead className="text-text-secondary">Order Status</TableHead>
            <TableHead className="text-text-secondary">Invoice Status</TableHead>
            <TableHead className="text-text-secondary">Total</TableHead>
            <TableHead className="text-text-secondary">Paid</TableHead>
            <TableHead className="text-text-secondary">Remaining</TableHead>
            <TableHead className="text-text-secondary">Created Date</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <TableRow
              key={order.id}
              className="border-border hover:bg-surface-soft"
            >
              <TableCell className="font-medium text-text-primary">
                {order.customerName}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {order.bookingDate}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {order.originalPackageName}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {order.finalPackageName}
              </TableCell>
              <TableCell>
                <OrderStatusBadge status={order.orderStatus} />
              </TableCell>
              <TableCell>
                <InvoiceStatusBadge status={order.invoiceStatus} />
              </TableCell>
              <TableCell className="text-sm text-text-primary">
                {order.totalAmount}
              </TableCell>
              <TableCell className="text-sm text-success">
                {order.paidAmount}
              </TableCell>
              <TableCell
                className={`text-sm ${
                  parseFloat(order.remainingAmount.replace(/[^\d.-]/g, "")) > 0
                    ? "text-danger"
                    : "text-text-secondary"
                }`}
              >
                {order.remainingAmount}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {order.createdAt}
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
                      <Link href={`/orders/${order.id}`}>View Details</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href={`/orders/${order.id}/edit`}>Edit Order</Link>
                    </DropdownMenuItem>
                    {order.primaryInvoiceId ? (
                      <DropdownMenuItem asChild>
                        <Link href={`/invoices/${order.primaryInvoiceId}`}>
                          View Invoice
                        </Link>
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem disabled>Create Invoice</DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
          {orders.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={11}
                className="h-24 text-center text-sm text-text-secondary"
              >
                No orders match these filters.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}
