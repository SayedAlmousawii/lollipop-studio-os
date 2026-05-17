import type { SessionConfigurationStatus } from "@/modules/session-configurations/session-configuration.types";

const styles: Record<SessionConfigurationStatus, string> = {
  Active: "bg-success-soft text-success",
  Archived: "bg-danger-soft text-danger",
};

export function SessionConfigurationStatusBadge({
  status,
}: {
  status: SessionConfigurationStatus;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}
