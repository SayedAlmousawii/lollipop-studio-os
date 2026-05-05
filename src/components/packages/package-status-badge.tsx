export type PackageStatus = "Active" | "Inactive";

const styles: Record<PackageStatus, string> = {
  Active:   "bg-success-soft text-success",
  Inactive: "bg-danger-soft text-danger",
};

interface PackageStatusBadgeProps {
  status: PackageStatus;
}

export function PackageStatusBadge({ status }: PackageStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}
