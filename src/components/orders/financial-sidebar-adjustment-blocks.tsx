import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { POSRecordPaymentDialog } from "@/components/orders/pos-record-payment-dialog";
import type { POSWorkspace } from "@/modules/orders/order.types";
import {
  InvoiceLineRow,
  MoneyRow,
  formatKD,
} from "./financial-sidebar-primitives";

export function AdjustmentInvoiceBlock({
  invoice,
  workspace,
}: {
  invoice: POSWorkspace["adjustmentInvoices"][number];
  workspace: POSWorkspace;
}) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-surface-soft p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">
            Adjustment #{invoice.invoiceNumber}
          </p>
          <Badge variant="secondary" className="mt-1 w-fit rounded-md">
            {invoice.invoiceStatus}
          </Badge>
        </div>
        <POSRecordPaymentDialog
          orderId={workspace.orderId}
          invoice={invoice}
          orderStatus={workspace.orderStatusRaw}
          customerName={workspace.customerName}
          jobNumber={workspace.jobNumber}
          trigger={<Button size="sm">Record Payment</Button>}
        />
      </div>
      <div className="space-y-2">
        {invoice.lineItems.map((item) => (
          <InvoiceLineRow
            key={item.id}
            label={item.description}
            meta={`${item.quantity} × ${item.unitPriceLabel}`}
            value={item.lineTotalLabel}
          />
        ))}
      </div>
      <div className="space-y-1 border-t border-border pt-3">
        <MoneyRow label="Total" value={formatKD(invoice.invoiceTotal)} />
        <MoneyRow label="Paid" value={formatKD(invoice.paidAmount)} />
        <MoneyRow
          label="Remaining"
          value={formatKD(invoice.remainingAmount)}
          strong
        />
      </div>
    </div>
  );
}
