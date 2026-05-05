import type { InvoiceStatusLabel } from "@/modules/orders/order.types";

const styles: Record<InvoiceStatusLabel, string> = {
  Draft:    "bg-text-muted/10 text-text-secondary",
  Issued:   "bg-info-soft text-info",
  Partial:  "bg-warning-soft text-warning",
  Paid:     "bg-success-soft text-success",
  Closed:   "bg-success-soft text-success",
  "No Invoice": "bg-danger-soft text-danger",
};

interface InvoiceStatusBadgeProps {
  status: InvoiceStatusLabel;
}

export function InvoiceStatusBadge({ status }: InvoiceStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}
