import { Lock, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateOrderInvoiceForm } from "@/components/orders/create-order-invoice-form";
import { POSRecordPaymentDialog } from "@/components/orders/pos-record-payment-dialog";
import { MoneyRow, formatEnumLabel } from "@/components/financial";
import { formatMoney } from "@/lib/formatting/money";
import type { FinancialCaseSummary } from "@/modules/financial-cases/financial-case-summary.types";
import type { CustomerSettlementSummaryProjection } from "@/modules/financial-cases/projections";
import type { POSInvoiceSummary, POSWorkspace } from "@/modules/orders/order.types";
import type { POSFinancialSidebarEditPolicies } from "@/modules/orders/policies/edit-mode-policy";
import type {
  SalesPageFinancialPreview,
  SalesPagePreviewState,
} from "@/modules/order-commits/projections/sales-page-view.types";

export function OrderCommitFinancialSidebar({
  workspace,
  financialPreview,
  financialCase,
  editPolicies,
  className,
}: {
  workspace: POSWorkspace;
  financialPreview: SalesPageFinancialPreview;
  financialCase: FinancialCaseSummary;
  preview: SalesPagePreviewState | null;
  editPolicies: POSFinancialSidebarEditPolicies;
  className?: string;
}) {
  const invoice = workspace.invoice;
  const paymentTargets = getOpenChargeTargets(workspace);
  const defaultTargetInvoiceId =
    paymentTargets.find(
      (target) =>
        target.invoiceId ===
        financialPreview.collectPaymentTargetInvoiceId
    )?.invoiceId ?? paymentTargets[0]?.invoiceId;
  const paymentDialogInvoice = paymentTargets[0] ?? invoice;

  return (
    <aside className={className}>
      <Card className="border-text-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3 text-base">
            <span className="inline-flex items-center gap-2">
              <ReceiptText className="h-4 w-4 text-accent" />
              Financial Preview
            </span>
            <Badge variant="outline" className="rounded-md">
              {financialPreview.stage === "active"
                ? formatEnumLabel(financialPreview.paymentStatusEnum ?? "UNPAID")
                : "Booking"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {invoice ? (
            <section className="space-y-2">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.18em] text-text-muted">
                  Final invoice
                </p>
                <p className="text-sm text-text-secondary">
                  Reference #{invoice.invoiceNumber}
                </p>
              </div>
              {editPolicies.invoiceLocked.blockedReason ? (
                <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                  {editPolicies.invoiceLocked.userFacingMessage}
                </div>
              ) : null}
            </section>
          ) : (
            <p className="rounded-md border border-border bg-surface-soft p-3 text-sm text-text-secondary">
              No invoice exists yet. Financial preview is using the current order
              case baseline.
            </p>
          )}

          <SettlementReceipt settlement={financialPreview.settlement} />

          <section className="space-y-2 border-t border-border pt-4">
            <p className="text-xs uppercase tracking-[0.18em] text-text-muted">
              Financial Case
            </p>
            <p className="text-sm text-text-secondary">
              {financialCase.financialCaseId}
            </p>
          </section>

          <section className="border-t border-border pt-4">
            {paymentDialogInvoice ? (
              financialPreview.isFullySettled ? (
                <div className="space-y-2">
                  <Button className="w-full" disabled>
                    Fully Paid
                  </Button>
                  <p className="text-center text-xs text-text-muted">
                    No outstanding balance remains.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <POSRecordPaymentDialog
                    orderId={workspace.orderId}
                    invoice={paymentDialogInvoice}
                    targets={paymentTargets}
                    defaultTargetInvoiceId={defaultTargetInvoiceId}
                    orderStatus={workspace.orderStatusRaw}
                    customerName={workspace.customerName}
                    jobNumber={workspace.jobNumber}
                  />
                  <p className="text-center text-xs text-text-muted">
                    Opens without leaving the sales workspace.
                  </p>
                </div>
              )
            ) : (
              <CreateOrderInvoiceForm orderId={workspace.orderId} returnToSales />
            )}
          </section>
        </CardContent>
      </Card>
    </aside>
  );
}

function SettlementReceipt({
  settlement,
}: {
  settlement: CustomerSettlementSummaryProjection | null;
}) {
  if (!settlement) {
    return (
      <section className="space-y-3 rounded-md border border-border bg-surface-soft p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-text-muted">
          Receipt
        </p>
        <p className="text-sm text-text-secondary">
          No active settlement summary exists yet.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-md border border-border bg-surface-soft p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.18em] text-text-muted">
          Receipt
        </p>
        <Badge variant="outline" className="rounded-md">
          {formatEnumLabel(settlement.mode)}
        </Badge>
      </div>
      <div className="space-y-2">
        <MoneyRow
          label="Order total (net)"
          value={formatMoney(settlement.netCustomerTotal)}
          strong
        />
        <MoneyRow label="Cash paid" value={formatMoney(settlement.cashPaid)} />
        <MoneyRow
          label="Remaining due"
          value={formatMoney(settlement.remainingDue)}
          strong
        />
        {settlement.availableCredit !== undefined ? (
          <MoneyRow
            label="Available credit / refundable"
            value={formatMoney(settlement.availableCredit)}
          />
        ) : null}
        {settlement.mode === "draft" ? (
          <div className="space-y-2 border-t border-border/70 pt-2">
            <MoneyRow
              label="Previous total"
              value={formatMoney(settlement.previousTotal)}
            />
            <MoneyRow
              label="Pending delta"
              value={formatMoney(settlement.pendingDelta)}
            />
            <MoneyRow
              label="After commit"
              value={formatMoney(settlement.afterCommitTotal)}
            />
            <MoneyRow
              label="Amount due after commit"
              value={formatMoney(settlement.amountDueAfterCommit)}
              strong
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function getOpenChargeTargets(workspace: POSWorkspace): POSInvoiceSummary[] {
  const targets: POSInvoiceSummary[] = [];
  if (workspace.invoice && workspace.invoice.remainingAmount > 0) {
    targets.push(workspace.invoice);
  }
  targets.push(...workspace.adjustmentInvoices);
  return targets;
}
