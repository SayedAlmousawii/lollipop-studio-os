import type {
  InvoiceAccountantStatusLabel,
  InvoiceStatusLabel,
} from "@/modules/invoices/invoice.types";

type InvoiceBadgeStatus = InvoiceStatusLabel | InvoiceAccountantStatusLabel;

const styles: Record<InvoiceBadgeStatus, string> = {
  Draft: "bg-muted text-text-secondary",
  Issued: "bg-info-soft text-info",
  Partial: "bg-warning-soft text-warning",
  Paid: "bg-success-soft text-success",
  Closed: "bg-text-primary text-white",
  Void: "bg-danger-soft text-danger",
  Available: "bg-info-soft text-info",
  "Partially used": "bg-warning-soft text-warning",
  "Fully used": "bg-muted text-text-secondary",
};

interface InvoiceStatusBadgeProps {
  status: InvoiceBadgeStatus;
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
