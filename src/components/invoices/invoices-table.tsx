import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { closeInvoiceAction } from "@/app/invoices/actions";
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
import type { InvoiceListItem } from "@/modules/invoices/invoice.types";
import { InvoiceStatusBadge } from "./invoice-status-badge";

interface InvoicesTableProps {
  invoices: InvoiceListItem[];
}

export function InvoicesTable({ invoices }: InvoicesTableProps) {
  return (
    <div className="overflow-x-auto rounded-[14px] border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="border-border bg-surface-soft">
            <TableHead className="text-text-secondary">Invoice Number</TableHead>
            <TableHead className="text-text-secondary">Customer Phone</TableHead>
            <TableHead className="text-text-secondary">Job Number</TableHead>
            <TableHead className="text-text-secondary">Booking Ref</TableHead>
            <TableHead className="text-text-secondary">Total</TableHead>
            <TableHead className="text-text-secondary">Settled</TableHead>
            <TableHead className="text-text-secondary">Remaining</TableHead>
            <TableHead className="text-text-secondary">Status</TableHead>
            <TableHead className="text-text-secondary">Locked</TableHead>
            <TableHead className="text-text-secondary">Created Date</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((invoice) => {
            const close = closeInvoiceAction.bind(null, invoice.id);
            return (
              <TableRow
                key={invoice.id}
                className="border-border hover:bg-surface-soft"
              >
                <TableCell className="font-medium text-text-primary">
                  {invoice.invoiceNumber}
                </TableCell>
                <TableCell className="text-sm tabular-nums text-text-primary">
                  {invoice.customerPhone}
                </TableCell>
                <TableCell className="text-sm font-medium text-text-primary">
                  {invoice.jobNumber}
                </TableCell>
                <TableCell className="text-sm text-text-secondary">
                  {invoice.referenceLabel}
                </TableCell>
                <TableCell className="text-sm text-text-primary">
                  {invoice.totalAmount}
                </TableCell>
                <TableCell className="text-sm text-success">
                  {invoice.settledAmount}
                </TableCell>
                <TableCell className="text-sm text-danger">
                  {invoice.remainingAmount}
                </TableCell>
                <TableCell>
                  <InvoiceStatusBadge status={invoice.status} />
                </TableCell>
                <TableCell className="text-sm text-text-secondary">
                  {invoice.isLocked ? "Yes" : "No"}
                </TableCell>
                <TableCell className="text-sm text-text-secondary">
                  {invoice.createdAt}
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
                        <Link href={`/invoices/${invoice.id}`}>View</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild disabled={invoice.isLocked}>
                        <Link href={`/invoices/${invoice.id}`}>Record Payment</Link>
                      </DropdownMenuItem>
                      {!invoice.isLocked ? (
                        <DropdownMenuItem asChild>
                          <form action={close}>
                            <button type="submit" className="w-full text-left">
                              Close Invoice
                            </button>
                          </form>
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem asChild>
                          <Link href={`/invoices/${invoice.id}`}>Create Adjustment</Link>
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
          {invoices.length === 0 ? (
            <TableRow>
              <TableCell colSpan={11} className="h-24 text-center text-sm text-text-secondary">
                No invoices yet.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}
