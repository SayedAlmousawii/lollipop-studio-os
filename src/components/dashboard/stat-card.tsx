interface StatCardProps {
  title: string;
  value: string;
  subtext?: string;
  icon?: React.ReactNode;
}

export function StatCard({ title, value, subtext, icon }: StatCardProps) {
  return (
    <div className="rounded-[14px] border border-border bg-surface p-5">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-text-secondary">{title}</p>
        {icon && <span className="text-text-muted">{icon}</span>}
      </div>
      <p className="mt-2 text-2xl font-semibold text-text-primary">{value}</p>
      {subtext && (
        <p className="mt-1 text-xs text-text-muted">{subtext}</p>
      )}
    </div>
  );
}
