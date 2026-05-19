import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/formatting/money";
import { FINANCIAL_CASE_PAYMENT_STATUS_LABELS } from "@/modules/financial-cases/financial-case-summary.constants";
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
            <TableHead className="text-text-secondary">Customer Phone</TableHead>
            <TableHead className="text-text-secondary">Job Number</TableHead>
            <TableHead className="text-text-secondary">Booking Date</TableHead>
            <TableHead className="text-text-secondary">Original Package</TableHead>
            <TableHead className="text-text-secondary">Final Package</TableHead>
            <TableHead className="text-text-secondary">Order Status</TableHead>
            <TableHead className="text-text-secondary">Invoice Status</TableHead>
            <TableHead className="text-text-secondary">Total</TableHead>
            <TableHead className="text-text-secondary">Settled</TableHead>
            <TableHead className="text-text-secondary">Remaining</TableHead>
            <TableHead className="text-text-secondary">Created Date</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => {
            const financial = order.financial;
            return (
              <TableRow
                key={order.id}
                className="border-border hover:bg-surface-soft"
              >
              <TableCell className="font-medium tabular-nums text-text-primary">
                {order.customerPhone}
              </TableCell>
              <TableCell className="text-sm font-medium text-text-primary">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{order.jobNumber}</span>
                  {order.hasOpenAdjustmentWorkspace ? (
                    <Badge className="rounded-md border-info/30 bg-info-soft text-info">
                      Workspace
                    </Badge>
                  ) : null}
                </div>
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
              <TableCell
                className={cn(
                  "text-sm",
                  financial ? "text-text-primary" : "text-text-secondary"
                )}
              >
                {financial ? formatMoney(financial.totalAmount) : "—"}
              </TableCell>
              <TableCell
                className={cn(
                  "text-sm",
                  financial ? "text-success" : "text-text-secondary"
                )}
              >
                {financial ? formatMoney(financial.paidAmount) : "—"}
              </TableCell>
              <TableCell
                className={cn(
                  "text-sm",
                  financial && financial.remainingAmount > 0
                    ? "text-danger"
                    : "text-text-secondary"
                )}
              >
                {financial ? (
                  <div className="space-y-0.5">
                    <div>{formatMoney(financial.remainingAmount)}</div>
                    <div className="text-xs text-text-muted">
                      {
                        FINANCIAL_CASE_PAYMENT_STATUS_LABELS[
                          financial.paymentStatusEnum
                        ]
                      }
                    </div>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    <div>—</div>
                    <div className="text-xs text-text-muted">
                      No active financial case
                    </div>
                  </div>
                )}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {order.createdAt}
              </TableCell>
              <TableCell>
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
                      <Link href={`/orders/${order.id}`}>View Details</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href={`/orders/${order.id}/sales`}>Sales</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href={`/orders/${order.id}/edit`}>Edit Order</Link>
                    </DropdownMenuItem>
                    {order.primaryInvoiceId ? (
                      <DropdownMenuItem asChild>
                        <Link href={`/invoices/${order.primaryInvoiceId}`}>
                          View Invoice {order.primaryInvoiceNumber}
                        </Link>
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem disabled>Create Invoice</DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
              </TableRow>
            );
          })}
          {orders.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={12}
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
