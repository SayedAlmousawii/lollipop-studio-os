import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/formatting/money";
import type { SessionConfigurationSummaryEntry } from "@/modules/orders/order.types";

export function ConfigurationSummaryChip({
  summary,
  subtotal,
}: {
  summary: SessionConfigurationSummaryEntry[];
  subtotal: number;
}) {
  if (summary.length === 0) return null;

  return (
    <div className="space-y-1 rounded-md border border-border bg-surface-soft px-3 py-2 text-xs">
      <p className="text-text-secondary">
        <span className="font-medium text-text-primary">Config:</span>{" "}
        {summary.map((entry) => entry.label).join(", ") || "No configurations"}
      </p>
      {subtotal !== 0 ? (
        <div>
          <Badge variant="outline" className="rounded-md border-accent/30 text-accent">
            Added Fees: {formatMoney(subtotal)}
          </Badge>
        </div>
      ) : null}
    </div>
  );
}
