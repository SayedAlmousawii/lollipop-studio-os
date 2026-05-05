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
            <TableHead className="text-text-secondary">Package</TableHead>
            <TableHead className="text-text-secondary">Order Status</TableHead>
            <TableHead className="text-text-secondary">Total</TableHead>
            <TableHead className="text-text-secondary">Paid</TableHead>
            <TableHead className="text-text-secondary">Remaining</TableHead>
            <TableHead className="text-text-secondary">Invoice Status</TableHead>
            <TableHead className="text-text-secondary">Method</TableHead>
            <TableHead className="text-text-secondary">Created</TableHead>
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
                {order.packageName}
              </TableCell>
              <TableCell>
                <OrderStatusBadge status={order.orderStatus} />
              </TableCell>
              <TableCell className="text-sm text-text-primary">
                {order.invoiceTotal}
              </TableCell>
              <TableCell className="text-sm text-success">
                {order.paidAmount}
              </TableCell>
              <TableCell
                className={`text-sm ${
                  order.remainingAmount !== "0.000 KD"
                    ? "text-danger"
                    : "text-text-secondary"
                }`}
              >
                {order.remainingAmount}
              </TableCell>
              <TableCell>
                <InvoiceStatusBadge status={order.invoiceStatus} />
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {order.paymentMethod}
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
                    <DropdownMenuItem>View</DropdownMenuItem>
                    <DropdownMenuItem>Edit</DropdownMenuItem>
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
