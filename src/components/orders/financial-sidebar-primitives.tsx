import type { POSWorkspace } from "@/modules/orders/order.types";
import { formatMoney } from "@/lib/formatting/money";

export function AdjustmentInvoiceSummary({
  invoice,
}: {
  invoice: POSWorkspace["paidAdjustmentInvoices"][number];
}) {
  return (
    <div className="rounded-md border border-border bg-surface-soft px-3 py-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-text-primary">{invoice.invoiceNumber}</span>
        <span className="tabular-nums text-text-secondary">
          {formatMoney(invoice.invoiceTotal)}
        </span>
      </div>
    </div>
  );
}

export function InvoiceLineRow({
  label,
  meta,
  value,
}: {
  label: string;
  meta: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-soft px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">{label}</p>
          <p className="text-xs text-text-secondary">{meta}</p>
        </div>
        <span className="text-sm font-medium tabular-nums text-text-primary">{value}</span>
      </div>
    </div>
  );
}

export function MoneyRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 text-sm ${strong ? "font-semibold text-text-primary" : "text-text-secondary"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
