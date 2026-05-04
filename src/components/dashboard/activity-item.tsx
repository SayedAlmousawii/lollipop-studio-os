interface ActivityItemProps {
  timestamp: string;
  description: string;
}

export function ActivityItem({ timestamp, description }: ActivityItemProps) {
  return (
    <div className="flex items-start gap-4 border-b border-border py-3 last:border-0">
      <span className="w-20 shrink-0 text-xs text-text-muted">{timestamp}</span>
      <span className="flex-1 text-sm text-text-secondary">{description}</span>
    </div>
  );
}
