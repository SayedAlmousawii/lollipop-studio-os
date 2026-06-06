import type { ReactNode } from "react";
import { AlertTriangle, FileText, Lock, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateOrderInvoiceForm } from "@/components/orders/create-order-invoice-form";
import { POSRecordPaymentDialog } from "@/components/orders/pos-record-payment-dialog";
import { MoneyRow, formatEnumLabel } from "@/components/financial";
import { formatMoney, formatSignedMoney } from "@/lib/formatting/money";
import type { FinancialCaseSummary } from "@/modules/financial-cases/financial-case-summary.types";
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
  preview,
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
        financialPreview.baseline.collectPaymentTargetInvoiceId
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
              {financialPreview.baseline.stage === "active"
                ? formatEnumLabel(
                    financialPreview.baseline.paymentStatusEnum ?? "UNPAID"
                  )
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

          <BaselineSummary financialPreview={financialPreview} />
          <PreviewTotals financialPreview={financialPreview} preview={preview} />
          <ImpactSummary financialPreview={financialPreview} preview={preview} />

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
              financialPreview.baseline.isFullySettled ? (
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

function BaselineSummary({
  financialPreview,
}: {
  financialPreview: SalesPageFinancialPreview;
}) {
  const baseline = financialPreview.baseline;

  return (
    <section className="space-y-3 rounded-md border border-border bg-surface-soft p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.18em] text-text-muted">
          Baseline
        </p>
        <Badge variant="outline" className="rounded-md">
          {formatEnumLabel(baseline.stage)}
        </Badge>
      </div>
      <div className="space-y-2">
        {baseline.depositInvoice ? (
          <DocumentMoneyRow
            label={`Deposit (${baseline.depositInvoice.invoiceNumber})`}
            amount={formatMoney(baseline.depositInvoice.total)}
            status={baseline.depositInvoice.status}
          />
        ) : null}
        {baseline.finalInvoice ? (
          <DocumentMoneyRow
            label={`Final invoice (${baseline.finalInvoice.invoiceNumber})`}
            amount={formatMoney(baseline.finalInvoice.total)}
            remaining={formatMoney(baseline.finalInvoice.remaining)}
            status={baseline.finalInvoice.status}
          />
        ) : null}
        <DocumentSection
          title="Adjustments"
          documents={baseline.finalizedAdjustments}
          signed
        />
        <DocumentSection title="Credit notes" documents={baseline.creditNotes} signed />
        <DocumentSection title="Refunds" documents={baseline.refunds} signed />
        <MoneyRow
          label="Customer total"
          value={formatOptionalMoney(baseline.customerTotal)}
          strong
        />
        <MoneyRow
          label="Deposit applied"
          value={formatOptionalMoney(baseline.depositApplied)}
        />
        <MoneyRow
          label="Paid so far"
          value={formatOptionalMoney(baseline.paidSoFar)}
        />
        <MoneyRow
          label="Effective paid"
          value={formatOptionalMoney(baseline.effectivePaid)}
        />
        <MoneyRow
          label="Total adjustments"
          value={formatOptionalSignedMoney(baseline.totalAdjustments)}
        />
        <MoneyRow
          label="Remaining"
          value={formatOptionalMoney(baseline.outstandingAmount)}
          strong
        />
      </div>
    </section>
  );
}

function DocumentSection({
  title,
  documents,
  signed,
}: {
  title: string;
  documents: SalesPageFinancialPreview["baseline"]["finalizedAdjustments"];
  signed?: boolean;
}) {
  if (documents.length === 0) return null;

  return (
    <div className="space-y-1 border-t border-border/70 pt-2">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-text-muted">
        {title}
      </p>
      {documents.map((document) => (
        <DocumentMoneyRow
          key={document.id}
          label={`${formatEnumLabel(document.invoiceType)} (${document.invoiceNumber})`}
          amount={
            signed
              ? formatSignedMoney(document.total)
              : formatMoney(document.total)
          }
          remaining={formatMoney(document.remaining)}
          status={document.status}
        />
      ))}
    </div>
  );
}

function DocumentMoneyRow({
  label,
  amount,
  remaining,
  status,
}: {
  label: string;
  amount: string;
  remaining?: string;
  status: string;
}) {
  return (
    <div className="space-y-1 rounded-md border border-border bg-surface px-3 py-2">
      <div className="flex items-start justify-between gap-3 text-sm">
        <span className="text-text-secondary">{label}</span>
        <span className="text-right font-medium tabular-nums text-text-primary">
          {amount}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-text-muted">
        <Badge variant="secondary" className="rounded-md">
          {formatEnumLabel(status)}
        </Badge>
        {remaining ? <span>Remaining {remaining}</span> : null}
      </div>
    </div>
  );
}

function PreviewTotals({
  financialPreview,
  preview,
}: {
  financialPreview: SalesPageFinancialPreview;
  preview: SalesPagePreviewState | null;
}) {
  const overlay = financialPreview.overlay;

  return (
    <section className="space-y-3 border-t border-border pt-4">
      <p className="text-xs uppercase tracking-[0.18em] text-text-muted">
        Commit Preview
      </p>
      {preview ? (
        <div className="space-y-2">
          <MoneyRow
            label="Previous total"
            value={formatOptionalMoney(overlay.previousTotal)}
          />
          <MoneyRow
            label="Pending delta"
            value={formatOptionalSignedMoney(overlay.pendingDelta)}
          />
          <MoneyRow
            label="After commit"
            value={formatOptionalMoney(overlay.pendingTotal)}
            strong
          />
        </div>
      ) : (
        <p className="rounded-md border border-border bg-surface-soft p-3 text-sm text-text-secondary">
          No staged preview yet.
        </p>
      )}
    </section>
  );
}

function ImpactSummary({
  financialPreview,
  preview,
}: {
  financialPreview: SalesPageFinancialPreview;
  preview: SalesPagePreviewState | null;
}) {
  const overlay = financialPreview.overlay;

  if (!preview) return null;

  return (
    <section className="space-y-3 border-t border-border pt-4">
      <p className="text-xs uppercase tracking-[0.18em] text-text-muted">
        Impact
      </p>
      {overlay.requiresApproval ? (
        <div className="space-y-2 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            <span>Approval required</span>
          </div>
          {overlay.approvalReasons?.map((reason) => (
            <p key={reason.code}>{reason.message}</p>
          ))}
        </div>
      ) : null}
      {overlay.documentPlan ? (
        <ImpactBlock
          title="Document plan"
          badge={formatEnumLabel(overlay.documentPlan.kind)}
          icon={<FileText className="h-4 w-4" />}
          lines={[
            ["Amount", formatMoney(overlay.documentPlan.amount)],
            [
              "Payment collection",
              overlay.documentPlan.requiresPaymentCollection ? "Required" : "None",
            ],
            [
              "Refund review",
              overlay.documentPlan.requiresRefundReview ? "Required" : "None",
            ],
            ["Reason", overlay.documentPlan.reason ?? "No additional reason"],
          ]}
        />
      ) : null}
      {overlay.paymentImpact ? (
        <ImpactBlock
          title="Payment impact"
          badge={formatEnumLabel(overlay.paymentImpact.kind)}
          icon={<AlertTriangle className="h-4 w-4" />}
          lines={[
            ["Amount due", formatMoney(overlay.paymentImpact.amountDue)],
            ["Credit", formatMoney(overlay.paymentImpact.creditAmount)],
            [
              "Already paid",
              formatMoney(overlay.paymentImpact.alreadyPaidAmount),
            ],
            [
              "Remaining",
              formatSignedMoney(overlay.paymentImpact.remainingAfterCommit),
            ],
          ]}
        />
      ) : null}
      {overlay.refundImpact ? (
        <ImpactBlock
          title="Refund impact"
          badge={overlay.refundImpact.refundRequired ? "Review needed" : "None"}
          icon={<AlertTriangle className="h-4 w-4" />}
          lines={[
            ["Refundable", formatMoney(overlay.refundImpact.refundableAmount)],
            ["Credit note", formatMoney(overlay.refundImpact.creditNoteAmount)],
            ["Reason", overlay.refundImpact.reason ?? "No refund review required"],
          ]}
        />
      ) : null}
    </section>
  );
}

function ImpactBlock({
  title,
  badge,
  icon,
  lines,
}: {
  title: string;
  badge: string;
  icon: ReactNode;
  lines: Array<[string, string]>;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-surface-soft p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium text-text-primary">
          {icon}
          <span>{title}</span>
        </div>
        <Badge variant="outline" className="rounded-md">
          {badge}
        </Badge>
      </div>
      <div className="space-y-1 text-xs text-text-secondary">
        {lines.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <span>{label}</span>
            <span className="text-right tabular-nums text-text-primary">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatOptionalMoney(value: number | null): string {
  if (value === null) return "Not available";
  return formatMoney(value);
}

function formatOptionalSignedMoney(value: number | null): string {
  if (value === null) return "Not available";
  return formatSignedMoney(value);
}

function getOpenChargeTargets(workspace: POSWorkspace): POSInvoiceSummary[] {
  const targets: POSInvoiceSummary[] = [];
  if (workspace.invoice && workspace.invoice.remainingAmount > 0) {
    targets.push(workspace.invoice);
  }
  targets.push(...workspace.adjustmentInvoices);
  return targets;
}
