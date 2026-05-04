export type ScheduleStatus = "Confirmed" | "Pending" | "Cancelled" | "No-show";

const statusStyles: Record<ScheduleStatus, string> = {
  Confirmed: "bg-success-soft text-success",
  Pending: "bg-warning-soft text-warning",
  Cancelled: "bg-danger-soft text-danger",
  "No-show": "bg-danger-soft text-danger",
};

interface ScheduleItemProps {
  time: string;
  customerName: string;
  status: ScheduleStatus;
}

export function ScheduleItem({ time, customerName, status }: ScheduleItemProps) {
  return (
    <div className="flex items-center gap-4 border-b border-border py-3 last:border-0">
      <span className="w-16 shrink-0 text-sm text-text-muted">{time}</span>
      <span className="flex-1 text-sm font-medium text-text-primary">{customerName}</span>
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyles[status]}`}>
        {status}
      </span>
    </div>
  );
}
