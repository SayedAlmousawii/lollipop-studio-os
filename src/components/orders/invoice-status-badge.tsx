import type { InvoiceStatus } from "@/modules/orders/order.types";

const styles: Record<InvoiceStatus, string> = {
  Unpaid:   "bg-danger-soft text-danger",
  Partial:  "bg-warning-soft text-warning",
  Paid:     "bg-success-soft text-success",
  Refunded: "bg-info-soft text-info",
};

interface InvoiceStatusBadgeProps {
  status: InvoiceStatus;
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
