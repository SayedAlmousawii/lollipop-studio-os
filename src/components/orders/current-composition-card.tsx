import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  CompositionView,
  CompositionViewRow,
} from "@/modules/composition-view/composition-view.model";
import { cn } from "@/lib/utils";

export function CurrentCompositionCard({
  view,
  className,
  rowActions,
}: {
  view: CompositionView;
  className?: string;
  rowActions?: Record<string, ReactNode>;
}) {
  const copy = view.mode === "locked"
    ? { title: "Current Composition", badge: "Read only" }
    : { title: "Preview Composition", badge: "Preview" };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <span className="inline-flex items-center gap-2">
            <Lock className="h-4 w-4 text-accent" />
            {copy.title}
          </span>
          <Badge variant="outline" className="rounded-md">
            {copy.badge}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {view.rows.map((row) => (
            <CompositionRow key={row.id} row={row} action={rowActions?.[row.id]} />
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border pt-4 text-sm font-semibold text-text-primary">
          <span>Composition Total</span>
          <span className="tabular-nums">{formatKD(view.total)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function CompositionRow({
  row,
  action,
}: {
  row: CompositionViewRow;
  action?: ReactNode;
}) {
  const isDeltaRow = row.kind === "swap" || row.kind === "upgrade";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-soft p-3 text-sm">
      <div className="min-w-0">
        <p className="font-medium text-text-primary">
          {isDeltaRow && row.delta
            ? `${row.label}: ${row.delta.from} → ${row.delta.to} (${formatSignedKD(row.delta.amount)})`
            : row.label}
        </p>
        {!isDeltaRow ? (
          <p className="mt-1 text-text-secondary">
            {formatQuantity(row)} × {formatKD(row.unitPrice ?? 0)}
          </p>
        ) : null}
        {row.sublabel ? (
          <p className="mt-1 text-text-secondary">{row.sublabel}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {action}
        <p
          className={cn(
            "font-medium tabular-nums text-text-primary",
            row.lineTotal < 0 ? "text-danger" : null
          )}
        >
          {formatKD(row.lineTotal)}
        </p>
      </div>
    </div>
  );
}

function formatQuantity(row: CompositionViewRow): string {
  if (row.quantity === undefined) return "0";
  return Number.isInteger(row.quantity) ? `${row.quantity}` : `${row.quantity}`;
}

function formatKD(value: number): string {
  return `${value.toFixed(3)} KD`;
}

function formatSignedKD(value: number): string {
  const formatted = `${Math.abs(value).toFixed(3)} KD`;
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}
