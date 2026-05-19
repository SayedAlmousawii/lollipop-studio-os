import { FINANCIAL_CASE_PAYMENT_STATUS_LABELS } from "@/modules/financial-cases/financial-case-summary.constants";
import type { OrderHeaderFinancialProjection } from "@/modules/financial-cases/projections/to-order-header-financial";
import { formatMoney } from "@/lib/formatting/money";

type OrderSettlementSummaryProps = {
  summary: OrderHeaderFinancialProjection | null;
};

export function OrderSettlementSummary({
  summary,
}: OrderSettlementSummaryProps) {
  if (!summary) {
    return (
      <div className="rounded-md border border-border bg-surface-soft p-3">
        <p className="text-xs font-medium uppercase text-text-muted">Financials</p>
        <p className="mt-1 text-sm font-medium text-text-primary">
          No active financial case
        </p>
        <div className="mt-2 grid gap-1 text-xs text-text-secondary sm:grid-cols-3">
          <span>Paid —</span>
          <span>Total —</span>
          <span>Refunded —</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-surface-soft p-3">
      <p className="text-xs font-medium uppercase text-text-muted">Financials</p>
      <p className="mt-1 text-sm font-medium text-text-primary">
        {formatMoney(summary.outstandingAmount)} outstanding
      </p>
      <div className="mt-2 grid gap-1 text-xs text-text-secondary sm:grid-cols-3">
        <span>Paid {formatMoney(summary.paidAmount)}</span>
        <span>Total {formatMoney(summary.totalOrderValue)}</span>
        <span>Refunded {formatMoney(summary.refundedAmount)}</span>
      </div>
      <p className="mt-2 text-xs text-text-muted">
        {FINANCIAL_CASE_PAYMENT_STATUS_LABELS[summary.paymentStatusEnum]}
        {summary.hasOverpayment ? " · Overpayment available" : ""}
      </p>
    </div>
  );
}
