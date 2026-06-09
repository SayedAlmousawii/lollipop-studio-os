import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { closeInvoiceAction } from "@/app/invoices/actions";
import { Badge } from "@/components/ui/badge";
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
import type {
  FinancialDocumentMoneyTone,
  InvoiceRegisterView,
} from "@/modules/invoices/invoice.types";
import { InvoiceStatusBadge } from "./invoice-status-badge";

interface InvoicesTableProps {
  register: InvoiceRegisterView;
}

export function InvoicesTable({ register }: InvoicesTableProps) {
  const { rows: invoices, subtotals } = register;

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-[14px] border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow className="border-border bg-surface-soft">
              <TableHead className="text-text-secondary">Document No.</TableHead>
              <TableHead className="text-text-secondary">Type</TableHead>
              <TableHead className="text-text-secondary">Customer Phone</TableHead>
              <TableHead className="text-text-secondary">Job Number</TableHead>
              <TableHead className="text-text-secondary">Booking Ref</TableHead>
              <TableHead className="text-right text-text-secondary">Amount</TableHead>
              <TableHead className="text-right text-text-secondary">Paid (cash)</TableHead>
              <TableHead className="text-right text-text-secondary">Credit applied</TableHead>
              <TableHead className="text-right text-text-secondary">Outstanding</TableHead>
              <TableHead className="text-text-secondary">Applications</TableHead>
              <TableHead className="text-text-secondary">Status</TableHead>
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
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="border-border bg-surface-soft text-text-secondary"
                    >
                      {invoice.documentTypeLabel}
                    </Badge>
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
                  <TableCell
                    className={cn(
                      "text-right text-sm tabular-nums",
                      moneyToneClass(invoice.signedAmountTone)
                    )}
                  >
                    {invoice.signedAmount}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-success">
                    {invoice.paidCash}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-text-primary">
                    {invoice.creditApplied}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right text-sm tabular-nums",
                      moneyToneClass(invoice.outstandingTone)
                    )}
                    title={invoice.outstandingLabel}
                  >
                    {invoice.outstanding}
                  </TableCell>
                  <TableCell className="max-w-[180px] text-xs text-text-secondary">
                    {invoice.applicationLinks.length > 0
                      ? invoice.applicationLinks.join(" ")
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <InvoiceStatusBadge status={invoice.accountantStatus} />
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
                <TableCell colSpan={13} className="h-24 text-center text-sm text-text-secondary">
                  No financial documents yet.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-3 rounded-[14px] border border-border bg-surface-soft p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Subtotal label="Invoiced (gross)" value={subtotals.invoicedGross} />
        <Subtotal label="Credits issued" value={subtotals.creditsIssued} tone="danger" />
        <Subtotal label="Invoiced (net)" value={subtotals.invoicedNet} />
        <Subtotal label="Deposits (prepaid)" value={subtotals.depositsPrepaid} />
        <Subtotal label="Cash received" value={subtotals.cashReceived} tone="success" />
        <Subtotal label="Receivable" value={subtotals.receivable} />
      </div>
    </div>
  );
}

function Subtotal({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: FinancialDocumentMoneyTone;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[10px] border border-border bg-surface px-3 py-2">
      <span className="text-text-secondary">{label}</span>
      <span className={cn("font-medium tabular-nums", moneyToneClass(tone))}>
        {value}
      </span>
    </div>
  );
}

function moneyToneClass(tone: FinancialDocumentMoneyTone): string {
  switch (tone) {
    case "success":
      return "text-success";
    case "danger":
      return "text-danger";
    case "muted":
      return "text-text-muted";
    case "neutral":
      return "text-text-primary";
  }
}
