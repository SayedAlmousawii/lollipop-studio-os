import type { InvoiceStatusLabel } from "@/modules/invoices/invoice.types";

const styles: Record<InvoiceStatusLabel, string> = {
  Draft: "bg-muted text-text-secondary",
  Issued: "bg-info-soft text-info",
  Partial: "bg-warning-soft text-warning",
  Paid: "bg-success-soft text-success",
  Closed: "bg-text-primary text-white",
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
