export type BookingStatus =
  | "Pending"
  | "Confirmed"
  | "Completed"
  | "Cancelled"
  | "No-Show";

const styles: Record<BookingStatus, string> = {
  Pending:   "bg-warning-soft text-warning",
  Confirmed: "bg-success-soft text-success",
  Completed: "bg-success-soft text-success",
  Cancelled: "bg-danger-soft text-danger",
  "No-Show": "bg-info-soft text-info",
};

interface BookingStatusBadgeProps {
  status: BookingStatus;
}

export function BookingStatusBadge({ status }: BookingStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}
