export type PaymentStatus = "Unpaid" | "Partial" | "Paid" | "Refunded";

const styles: Record<PaymentStatus, string> = {
  Unpaid:   "bg-danger-soft text-danger",
  Partial:  "bg-warning-soft text-warning",
  Paid:     "bg-success-soft text-success",
  Refunded: "bg-info-soft text-info",
};

interface PaymentStatusBadgeProps {
  status: PaymentStatus;
}

export function PaymentStatusBadge({ status }: PaymentStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}
