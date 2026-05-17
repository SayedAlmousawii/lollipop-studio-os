import Link from "next/link";
import { Lock, ReceiptText, RotateCcw } from "lucide-react";
import {
  openAdjustmentWorkspaceAction,
  takeOverAdjustmentWorkspaceAction,
} from "@/app/orders/[orderId]/adjustment-workspace/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { POSRecordPaymentDialog } from "@/components/orders/pos-record-payment-dialog";
import type {
  LinkedFinancialDocument,
  POSInvoiceSummary,
  POSWorkspace,
} from "@/modules/orders/order.types";
import type { deriveLockedFinancialSidebarSummary } from "@/modules/orders/order-settlement";
import {
  MoneyRow,
  formatKD,
} from "./financial-sidebar-primitives";

type OpenWorkspace = {
  id: string;
  openedAt: Date;
  currentOwnerUserId: string | null;
  currentOwnerUser: { name: string } | null;
  openedByUser: { name: string };
} | null;

type LockedFinancialSidebarSummary = ReturnType<
  typeof deriveLockedFinancialSidebarSummary
>;

export function FinancialSidebarLocked({
  workspace,
  linkedDocuments,
  financialSummary,
  openWorkspace,
  currentUserId,
  isManager,
  className,
}: {
  workspace: POSWorkspace;
  linkedDocuments: LinkedFinancialDocument[];
  financialSummary: LockedFinancialSidebarSummary;
  openWorkspace: OpenWorkspace;
  currentUserId: string;
  isManager: boolean;
  className?: string;
}) {
  const invoice = workspace.invoice;
  if (!invoice) return null;

  const paymentInvoices = [
    invoice,
    ...workspace.adjustmentInvoices,
    ...workspace.paidAdjustmentInvoices,
  ];

  return (
    <aside className={className}>
      <Card className="border-text-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3 text-base">
            <span className="inline-flex items-center gap-2">
              <ReceiptText className="h-4 w-4 text-accent" />
              Financial Summary
            </span>
            <Badge variant="outline" className="rounded-md">
              Locked
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <section className="space-y-3 rounded-md border border-border bg-surface-soft p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.18em] text-text-muted">
                Payment Summary
              </p>
              <Badge
                variant={financialSummary.remaining <= 0 ? "secondary" : "outline"}
                className="rounded-md"
              >
                {financialSummary.remaining <= 0 ? "Fully Paid" : "Outstanding"}
              </Badge>
            </div>
            <div className="space-y-2">
              <MoneyRow
                label="Customer Total"
                value={formatKD(financialSummary.customerTotal)}
                strong
              />
              <MoneyRow
                label="Paid So Far"
                value={formatKD(financialSummary.paidSoFar)}
              />
              {financialSummary.includesDeposit > 0 ? (
                <div className="flex items-center justify-between gap-3 pl-4 text-xs text-text-muted">
                  <span>Includes Deposit</span>
                  <span className="tabular-nums">
                    {formatKD(financialSummary.includesDeposit)}
                  </span>
                </div>
              ) : null}
              <MoneyRow
                label="Remaining"
                value={formatKD(financialSummary.remaining)}
                strong
              />
            </div>
          </section>

          <section className="space-y-2 border-t border-border pt-4">
            <p className="text-xs uppercase tracking-[0.18em] text-text-muted">
              Total Source
            </p>
            <MoneyRow
              label="Final Invoice Total"
              value={formatKD(financialSummary.finalInvoiceTotal)}
            />
            {financialSummary.totalAdjustments !== 0 ? (
              <MoneyRow
                label="Total Adjustments"
                value={formatSignedKD(financialSummary.totalAdjustments)}
              />
            ) : null}
            <MoneyRow
              label="Final Total / Customer Total"
              value={formatKD(financialSummary.finalTotal)}
              strong
            />
          </section>

          <section className="space-y-3 border-t border-border pt-4">
            <p className="text-xs uppercase tracking-[0.18em] text-text-muted">
              Linked Financial Documents
            </p>
            {linkedDocuments.length > 0 ? (
              <div className="space-y-2">
                {linkedDocuments.map((document) => (
                  <LinkedFinancialDocumentRow
                    key={document.invoiceId}
                    document={document}
                    paymentInvoice={paymentInvoices.find(
                      (candidate) => candidate.invoiceId === document.invoiceId
                    )}
                    workspace={workspace}
                  />
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-border bg-surface-soft p-3 text-sm text-text-secondary">
                No linked financial documents found.
              </p>
            )}
          </section>

          <AdjustmentWorkspaceAction
            workspace={workspace}
            openWorkspace={openWorkspace}
            currentUserId={currentUserId}
            isManager={isManager}
          />
        </CardContent>
      </Card>
    </aside>
  );
}

function LinkedFinancialDocumentRow({
  document,
  paymentInvoice,
  workspace,
}: {
  document: LinkedFinancialDocument;
  paymentInvoice: POSInvoiceSummary | undefined;
  workspace: POSWorkspace;
}) {
  const canRecordPayment =
    paymentInvoice !== undefined && paymentInvoice.remainingAmount > 0;

  return (
    <div className="rounded-md border border-border bg-surface-soft p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/invoices/${document.invoiceId}`}
          className="min-w-0 text-sm font-medium text-text-primary hover:text-accent-dark"
        >
          {document.invoiceNumber}
        </Link>
        <span className="text-sm font-semibold tabular-nums text-text-primary">
          {formatSignedDocumentAmount(document)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="rounded-md">
            {formatEnumLabel(document.invoiceType)}
          </Badge>
          <Badge variant="secondary" className="rounded-md">
            {formatEnumLabel(document.invoiceStatus)}
          </Badge>
        </div>
        {canRecordPayment ? (
          <POSRecordPaymentDialog
            orderId={workspace.orderId}
            invoice={paymentInvoice}
            orderStatus={workspace.orderStatusRaw}
            customerName={workspace.customerName}
            jobNumber={workspace.jobNumber}
            trigger={<Button size="sm">Record Payment</Button>}
          />
        ) : null}
      </div>
    </div>
  );
}

function AdjustmentWorkspaceAction({
  workspace,
  openWorkspace,
  currentUserId,
  isManager,
}: {
  workspace: POSWorkspace;
  openWorkspace: OpenWorkspace;
  currentUserId: string;
  isManager: boolean;
}) {
  const isOwner = openWorkspace?.currentOwnerUserId === currentUserId;

  return (
    <section className="space-y-3 border-t border-border pt-4">
      <p className="text-xs uppercase tracking-[0.18em] text-text-muted">
        Adjustment Workspace
      </p>
      {openWorkspace ? (
        <div className="space-y-3 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
          <div className="flex items-start gap-2">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Workspace open by {openWorkspace.currentOwnerUser?.name ?? openWorkspace.openedByUser.name} since{" "}
              {openWorkspace.openedAt.toLocaleString()}.
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {isOwner ? (
              <Button asChild>
                <Link href={`/orders/${workspace.orderId}/adjustment-workspace`}>
                  Resume Workspace
                </Link>
              </Button>
            ) : null}
            {!isOwner && isManager ? (
              <form
                action={takeOverAdjustmentWorkspaceAction.bind(
                  null,
                  workspace.orderId,
                  openWorkspace.id
                )}
              >
                <Button type="submit" variant="outline">
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Take Over
                </Button>
              </form>
            ) : null}
          </div>
        </div>
      ) : (
        <form
          action={openAdjustmentWorkspaceAction.bind(
            null,
            workspace.orderId,
            workspace.invoice!.invoiceId
          )}
          className="space-y-2 rounded-md border border-border bg-surface-soft p-3"
        >
          <Button type="submit" className="w-full">
            Open Adjustment Workspace
          </Button>
          <p className="text-center text-xs text-text-muted">
            This sale is finalized. New changes will be staged as adjustments.
          </p>
        </form>
      )}
    </section>
  );
}

function formatSignedDocumentAmount(document: LinkedFinancialDocument): string {
  const amount =
    document.invoiceType === "REFUND" || document.invoiceType === "CREDIT_NOTE"
      ? -document.invoiceTotal
      : document.invoiceTotal;
  return formatSignedKD(amount);
}

function formatSignedKD(value: number): string {
  if (value > 0) return `+${formatKD(value)}`;
  if (value < 0) return `-${formatKD(Math.abs(value))}`;
  return formatKD(value);
}

function formatEnumLabel(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
