import type { SessionTypeStatus } from "@/modules/session-types/session-type.types";

const styles: Record<SessionTypeStatus, string> = {
  Active: "bg-success-soft text-success",
  Archived: "bg-danger-soft text-danger",
};

export function SessionTypeStatusBadge({
  status,
}: {
  status: SessionTypeStatus;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}
