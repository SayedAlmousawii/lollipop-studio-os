interface SectionHeaderProps {
  title: string;
  description?: string;
}

export function SectionHeader({ title, description }: SectionHeaderProps) {
  return (
    <div>
      <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      {description && (
        <p className="mt-0.5 text-sm text-text-muted">{description}</p>
      )}
    </div>
  );
}
