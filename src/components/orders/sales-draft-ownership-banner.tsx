import { Info, ShieldCheck, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SalesPageDraftOwnership } from "@/modules/order-commits/projections";

export function SalesDraftOwnershipBanner({
  orderId,
  ownership,
}: {
  orderId: string;
  ownership: SalesPageDraftOwnership;
}) {
  if (!ownership.banner) return null;

  const Icon =
    ownership.banner.tone === "warning"
      ? TriangleAlert
      : ownership.banner.tone === "info"
        ? ShieldCheck
        : Info;
  const toneClass =
    ownership.banner.tone === "warning"
      ? "border-warning/30 bg-warning-soft text-warning"
      : ownership.banner.tone === "info"
        ? "border-info/30 bg-info-soft text-info"
        : "border-border bg-surface text-text-primary";

  return (
    <section className={`rounded-lg border px-4 py-3 ${toneClass}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Icon className="h-4 w-4 shrink-0" />
            <span>{ownership.banner.title}</span>
            <Badge variant="outline">{ownershipModeLabel(ownership.mode)}</Badge>
          </div>
          <p className="mt-1 text-sm">{ownership.banner.description}</p>
          {ownership.updatedAt ? (
            <p className="mt-1 text-xs">
              Last touched {ownership.updatedAt.toLocaleString()}
            </p>
          ) : null}
        </div>
        {ownership.mode === "blocked_non_owner" ? (
          <Button type="button" variant="outline" size="sm" asChild>
            <a href={`/orders/${orderId}/sales`}>Refresh</a>
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function ownershipModeLabel(mode: SalesPageDraftOwnership["mode"]): string {
  if (mode === "owner") return "Your draft";
  if (mode === "blocked_non_owner") return "Co-editor draft";
  if (mode === "manager_override") return "Manager override";
  return "No draft";
}
