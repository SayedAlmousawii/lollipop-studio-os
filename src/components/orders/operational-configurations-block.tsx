export type OperationalConfigurationsPackageLine = {
  packageName: string;
  sessionTypeName: string;
  operationalSelections: {
    configName: string;
    valueDisplay: string;
  }[];
};

export function OperationalConfigurationsBlock({
  packageLines,
}: {
  packageLines: OperationalConfigurationsPackageLine[];
}) {
  const visibleLines = packageLines.filter(
    (line) => line.operationalSelections.length > 0
  );
  if (visibleLines.length === 0) return null;

  return (
    <div className="space-y-3">
      {visibleLines.map((line, index) => (
        <div
          key={`${line.sessionTypeName}-${line.packageName}-${index}`}
          className="rounded-md border border-border bg-surface-soft p-3"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-text-primary">
                Operational configurations
              </p>
              <p className="text-xs text-text-secondary">
                {line.packageName} · {line.sessionTypeName}
              </p>
            </div>
          </div>
          <dl className="mt-3 space-y-2">
            {line.operationalSelections.map((selection) => (
              <div
                key={selection.configName}
                className="flex flex-wrap items-start justify-between gap-3"
              >
                <dt className="text-sm text-text-secondary">
                  {selection.configName}
                </dt>
                <dd className="text-sm font-medium text-text-primary">
                  {selection.valueDisplay}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
