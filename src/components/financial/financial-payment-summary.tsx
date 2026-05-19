import { Badge } from "@/components/ui/badge";
import { MoneyRow } from "@/components/orders/financial-sidebar-primitives";
import { formatMoney } from "@/lib/formatting/money";
import type { LockedFinancialSidebarSummary } from "./financial-types";

export function FinancialPaymentSummary({
  summary,
}: {
  summary: LockedFinancialSidebarSummary;
}) {
  return (
    <section className="space-y-3 rounded-md border border-border bg-surface-soft p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.18em] text-text-muted">
          Payment Summary
        </p>
        <Badge
          variant={summary.remaining <= 0 ? "secondary" : "outline"}
          className="rounded-md"
        >
          {summary.remaining <= 0 ? "Fully Paid" : "Outstanding"}
        </Badge>
      </div>
      <div className="space-y-2">
        <MoneyRow
          label="Customer Total"
          value={formatMoney(summary.customerTotal)}
          strong
        />
        <MoneyRow label="Paid So Far" value={formatMoney(summary.paidSoFar)} />
        {summary.includesDeposit > 0 ? (
          <div className="flex items-center justify-between gap-3 pl-4 text-xs text-text-muted">
            <span>Includes Deposit</span>
            <span className="tabular-nums">
              {formatMoney(summary.includesDeposit)}
            </span>
          </div>
        ) : null}
        <MoneyRow label="Remaining" value={formatMoney(summary.remaining)} strong />
      </div>
    </section>
  );
}
