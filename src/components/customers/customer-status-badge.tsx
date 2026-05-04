export type CustomerStatus = "Active" | "Inactive";

const styles: Record<CustomerStatus, string> = {
  Active:   "bg-success-soft text-success",
  Inactive: "bg-danger-soft text-danger",
};

interface CustomerStatusBadgeProps {
  status: CustomerStatus;
}

export function CustomerStatusBadge({ status }: CustomerStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}
