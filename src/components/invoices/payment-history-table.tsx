import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { InvoiceDetail } from "@/modules/invoices/invoice.types";

interface PaymentHistoryTableProps {
  payments: InvoiceDetail["payments"];
}

export function PaymentHistoryTable({ payments }: PaymentHistoryTableProps) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow className="border-border bg-surface-soft">
            <TableHead>Paid At</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Method</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Reference</TableHead>
            <TableHead>Notes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((payment) => (
            <TableRow key={payment.id} className="border-border">
              <TableCell className="text-sm text-text-secondary">
                {payment.paidAt}
              </TableCell>
              <TableCell className="text-sm font-medium text-success">
                {payment.amount}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {payment.method}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {payment.paymentType}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {payment.reference}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {payment.notes}
              </TableCell>
            </TableRow>
          ))}
          {payments.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="h-20 text-center text-sm text-text-secondary">
                No payments recorded.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}
