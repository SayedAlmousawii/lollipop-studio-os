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
import {
  FinancialLinkedDocuments,
  FinancialPaymentSummary,
  FinancialTotalSource,
  type LockedFinancialSidebarSummary,
} from "@/components/financial";
import type {
  LinkedFinancialDocument,
  POSInvoiceSummary,
  POSWorkspace,
} from "@/modules/orders/order.types";

type OpenWorkspace = {
  id: string;
  openedAt: Date;
  currentOwnerUserId: string | null;
  currentOwnerUser: { name: string } | null;
  openedByUser: { name: string };
} | null;

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
          <FinancialPaymentSummary summary={financialSummary} />
          <FinancialTotalSource summary={financialSummary} />
          <FinancialLinkedDocuments
            documents={linkedDocuments}
            renderRowExtras={(document) => {
              const paymentInvoice = paymentInvoices.find(
                (candidate) => candidate.invoiceId === document.invoiceId
              );
              return (
                <RecordPaymentRowAction
                  paymentInvoice={paymentInvoice}
                  workspace={workspace}
                />
              );
            }}
          />

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

function RecordPaymentRowAction({
  paymentInvoice,
  workspace,
}: {
  paymentInvoice: POSInvoiceSummary | undefined;
  workspace: POSWorkspace;
}) {
  if (!paymentInvoice || paymentInvoice.remainingAmount <= 0) return null;

  return (
    <POSRecordPaymentDialog
      orderId={workspace.orderId}
      invoice={paymentInvoice}
      orderStatus={workspace.orderStatusRaw}
      customerName={workspace.customerName}
      jobNumber={workspace.jobNumber}
      trigger={<Button size="sm">Record Payment</Button>}
    />
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
