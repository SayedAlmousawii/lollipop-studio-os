import { MoneyRow } from "@/components/orders/financial-sidebar-primitives";
import { formatMoney, formatSignedMoney } from "@/lib/formatting/money";
import type { LockedFinancialSidebarSummary } from "./financial-types";

export function FinancialTotalSource({
  summary,
}: {
  summary: LockedFinancialSidebarSummary;
}) {
  return (
    <section className="space-y-2 border-t border-border pt-4">
      <p className="text-xs uppercase tracking-[0.18em] text-text-muted">
        Total Source
      </p>
      <MoneyRow
        label="Final Invoice Total"
        value={formatMoney(summary.finalInvoiceTotal)}
      />
      {summary.totalAdjustments !== 0 ? (
        <MoneyRow
          label="Total Adjustments"
          value={formatSignedMoney(summary.totalAdjustments)}
        />
      ) : null}
      <MoneyRow
        label="Final Total / Customer Total"
        value={formatMoney(summary.finalTotal)}
        strong
      />
    </section>
  );
}
