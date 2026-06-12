"use client";

import { CheckCircle2, CreditCard, ReceiptText } from "lucide-react";
import { POSRecordPaymentDialog } from "@/components/orders/pos-record-payment-dialog";
import { SalesStagedCommitControls } from "@/components/orders/sales-staged-commit-controls";
import { MoneyRow, formatEnumLabel } from "@/components/financial";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/formatting/money";
import { cn } from "@/lib/utils";
import type { POSInvoiceSummary, POSWorkspace } from "@/modules/orders/order.types";
import {
  toSalesRightColumnReceipt,
  type SalesReceiptLine,
} from "@/modules/order-commits/projections/to-sales-right-column-receipt";
import type {
  SalesPageComposition,
  SalesPageDraftOwnership,
  SalesPageDraftState,
  SalesPageFinancialPreview,
  SalesPagePreviewState,
  SalesPageStagedChangesRow,
} from "@/modules/order-commits/projections/sales-page-view.types";
import styles from "./sales-page.module.css";

type SalesRightColumnProps = {
  workspace: POSWorkspace;
  composition: SalesPageComposition;
  financialPreview: SalesPageFinancialPreview;
  draft: SalesPageDraftState | null;
  preview: SalesPagePreviewState | null;
  stagedChanges: SalesPageStagedChangesRow[];
  ownership: SalesPageDraftOwnership;
  className?: string;
};

export function SalesRightColumn({
  workspace,
  composition,
  financialPreview,
  draft,
  preview,
  stagedChanges,
  ownership,
  className,
}: SalesRightColumnProps) {
  const receipt = toSalesRightColumnReceipt(composition);

  return (
    <aside className={cn(styles.rightColumn, className)}>
      <ReceiptCard receipt={receipt} />
      <FinancialSummaryCard financialPreview={financialPreview} />
      <CommitArea
        workspace={workspace}
        financialPreview={financialPreview}
        draft={draft}
        preview={preview}
        stagedChanges={stagedChanges}
        ownership={ownership}
      />
    </aside>
  );
}

function ReceiptCard({
  receipt,
}: {
  receipt: ReturnType<typeof toSalesRightColumnReceipt>;
}) {
  const sourceCopy =
    receipt.source === "projected"
      ? { title: "Order summary", badge: "Preview" }
      : { title: "Order summary", badge: "Current" };

  return (
    <Card className={styles.receiptCard}>
      <CardHeader className="shrink-0">
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <span className="inline-flex items-center gap-2">
            <ReceiptText className="h-4 w-4 text-accent" />
            {sourceCopy.title}
          </span>
          <Badge variant="outline" className="rounded-md">
            {sourceCopy.badge}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
        <div className={styles.receiptList}>
          {receipt.groups.length > 0 ? (
            receipt.groups.map((group) => (
              <section key={group.id} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
                  {group.title}
                </h3>
                <div className="space-y-2">
                  {group.lines.map((line) => (
                    <ReceiptLineRow key={line.id} line={line} />
                  ))}
                </div>
              </section>
            ))
          ) : (
            <p className="rounded-md border border-border bg-surface-soft px-3 py-2 text-sm text-text-secondary">
              No receipt lines yet.
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border pt-4 text-sm font-semibold text-text-primary">
          <span>Total</span>
          <span className="tabular-nums">{formatMoney(receipt.totalAmount)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function ReceiptLineRow({ line }: { line: SalesReceiptLine }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-surface-soft px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="font-medium text-text-primary">{line.label}</p>
        <p className="mt-1 text-xs text-text-secondary">
          {line.meta ? `${line.meta} · ` : ""}
          {line.quantity !== null && line.unitPrice !== null
            ? `${formatQuantity(line.quantity)} x ${formatMoney(line.unitPrice)}`
            : "Priced line"}
        </p>
      </div>
      <span className="shrink-0 tabular-nums text-text-primary">
        {formatMoney(line.totalAmount)}
      </span>
    </div>
  );
}

function FinancialSummaryCard({
  financialPreview,
}: {
  financialPreview: SalesPageFinancialPreview;
}) {
  const settlement = financialPreview.settlement;

  return (
    <Card className="shrink-0">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <span>Financial summary</span>
          <Badge variant="outline" className="rounded-md">
            {financialPreview.stage === "active"
              ? formatEnumLabel(financialPreview.paymentStatusEnum ?? "UNPAID")
              : "Booking"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {settlement ? (
          <>
            {settlement.mode === "draft" ? (
              <div className="space-y-2 rounded-md border border-border bg-surface-soft p-3">
                <MoneyRow
                  label="Previous total"
                  value={formatMoney(settlement.previousTotal)}
                />
                <MoneyRow
                  label="After commit"
                  value={formatMoney(settlement.afterCommitTotal)}
                  strong
                />
                <MoneyRow
                  label="Pending diff"
                  value={formatMoney(settlement.pendingDelta)}
                />
                <MoneyRow
                  label="Due after commit"
                  value={formatMoney(settlement.amountDueAfterCommit)}
                  strong
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <MoneyRow
                label="Total"
                value={formatMoney(settlement.netCustomerTotal)}
                strong
              />
              <MoneyRow label="Paid" value={formatMoney(settlement.cashPaid)} />
              <MoneyRow
                label="Remaining"
                value={formatMoney(settlement.remainingDue)}
                strong
              />
              {settlement.availableCredit !== undefined ? (
                <MoneyRow
                  label="Available credit"
                  value={formatMoney(settlement.availableCredit)}
                />
              ) : null}
              {settlement.refundable !== undefined ? (
                <MoneyRow
                  label="Refundable"
                  value={formatMoney(settlement.refundable)}
                />
              ) : null}
            </div>
          </>
        ) : (
          <p className="rounded-md border border-border bg-surface-soft px-3 py-2 text-sm text-text-secondary">
            No active settlement summary exists yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function CommitArea({
  workspace,
  financialPreview,
  draft,
  preview,
  stagedChanges,
  ownership,
}: {
  workspace: POSWorkspace;
  financialPreview: SalesPageFinancialPreview;
  draft: SalesPageDraftState | null;
  preview: SalesPagePreviewState | null;
  stagedChanges: SalesPageStagedChangesRow[];
  ownership: SalesPageDraftOwnership;
}) {
  if (draft) {
    return (
      <section className="shrink-0 space-y-3">
        <div className="flex items-center justify-between gap-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
          <span className="font-medium">Draft</span>
          <Badge variant="outline" className="rounded-md border-warning/40">
            {stagedChanges.length} staged
          </Badge>
        </div>
        <SalesStagedCommitControls
          orderId={workspace.orderId}
          draft={draft}
          preview={preview}
          stagedChanges={stagedChanges}
          financialPreview={financialPreview}
          ownership={ownership}
          showStagedList={false}
        />
      </section>
    );
  }

  return (
    <Card className="shrink-0">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <span>No changes to commit</span>
        </div>
        <CleanPaymentAction workspace={workspace} financialPreview={financialPreview} />
      </CardContent>
    </Card>
  );
}

function CleanPaymentAction({
  workspace,
  financialPreview,
}: {
  workspace: POSWorkspace;
  financialPreview: SalesPageFinancialPreview;
}) {
  const paymentTargets = getOpenChargeTargets(workspace);
  const defaultTargetInvoiceId =
    paymentTargets.find(
      (target) => target.invoiceId === financialPreview.collectPaymentTargetInvoiceId
    )?.invoiceId ?? paymentTargets[0]?.invoiceId;
  const paymentDialogInvoice = paymentTargets[0];

  if (!paymentDialogInvoice || financialPreview.isFullySettled) {
    return (
      <p className="rounded-md border border-border bg-surface-soft px-3 py-2 text-sm text-text-secondary">
        No payment target is open.
      </p>
    );
  }

  return (
    <POSRecordPaymentDialog
      orderId={workspace.orderId}
      invoice={paymentDialogInvoice}
      targets={paymentTargets}
      defaultTargetInvoiceId={defaultTargetInvoiceId}
      orderStatus={workspace.orderStatusRaw}
      customerName={workspace.customerName}
      jobNumber={workspace.jobNumber}
      trigger={
        <Button className="w-full">
          <CreditCard className="h-4 w-4" />
          Record payment
        </Button>
      }
    />
  );
}

function getOpenChargeTargets(workspace: POSWorkspace): POSInvoiceSummary[] {
  const targets: POSInvoiceSummary[] = [];
  if (workspace.invoice && workspace.invoice.remainingAmount > 0) {
    targets.push(workspace.invoice);
  }
  for (const invoice of workspace.adjustmentInvoices) {
    if (invoice.remainingAmount > 0) targets.push(invoice);
  }
  return targets;
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? `${value}` : `${value}`;
}
