import type { OrderSettlementSummary as OrderSettlementSummaryData } from "@/modules/orders/order.types";

type OrderSettlementSummaryProps = {
  summary: OrderSettlementSummaryData;
};

export function OrderSettlementSummary({
  summary,
}: OrderSettlementSummaryProps) {
  return (
    <div className="rounded-md border border-border bg-surface-soft p-3">
      <p className="text-xs font-medium uppercase text-text-muted">Financials</p>
      <p className="mt-1 text-sm font-medium text-text-primary">
        {formatKD(summary.outstandingAmount)} outstanding
      </p>
      <div className="mt-2 grid gap-1 text-xs text-text-secondary sm:grid-cols-3">
        <span>Paid {formatKD(summary.paidAmount)}</span>
        <span>Total {formatKD(summary.totalOrderValue)}</span>
        <span>Refunded {formatKD(summary.refundedAmount)}</span>
      </div>
    </div>
  );
}

function formatKD(value: number): string {
  return `${value.toFixed(3)} KD`;
}
