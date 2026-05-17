import {
  MoneyRow,
  formatKD,
} from "@/components/orders/financial-sidebar-primitives";
import { formatSignedKD } from "./financial-format";
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
        value={formatKD(summary.finalInvoiceTotal)}
      />
      {summary.totalAdjustments !== 0 ? (
        <MoneyRow
          label="Total Adjustments"
          value={formatSignedKD(summary.totalAdjustments)}
        />
      ) : null}
      <MoneyRow
        label="Final Total / Customer Total"
        value={formatKD(summary.finalTotal)}
        strong
      />
    </section>
  );
}
