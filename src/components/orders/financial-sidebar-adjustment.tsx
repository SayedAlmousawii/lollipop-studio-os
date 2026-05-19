import Link from "next/link";
import { CheckCircle2, CircleAlert, FileText, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditNoteApprovalForm } from "@/components/orders/credit-note-approval-fields";
import type {
  AdjustmentWorkspaceView,
  PendingAdjustmentPreview,
} from "@/modules/adjustment-workspace/adjustment-workspace.types";
import {
  finalizeAdjustmentWorkspaceAction,
} from "@/app/orders/[orderId]/adjustment-workspace/actions";
import { formatMoney, formatSignedMoney } from "@/lib/formatting/money";
import { MoneyRow } from "./financial-sidebar-primitives";

export function FinancialSidebarAdjustment({
  orderId,
  workspace,
  preview,
  canEdit,
  className,
}: {
  orderId: string;
  workspace: AdjustmentWorkspaceView;
  preview: PendingAdjustmentPreview;
  canEdit: boolean;
  className?: string;
}) {
  const canFinalize =
    canEdit && workspace.proposal.hasEdits && Number(preview.pendingNet) !== 0;

  return (
    <aside className={className}>
      <Card className="border-info/30 bg-info-soft/30">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3 text-base">
            <span className="inline-flex items-center gap-2">
              <ReceiptText className="h-4 w-4 text-info" />
              Pending Adjustment Preview
            </span>
            <Badge variant="outline" className="rounded-md bg-surface">
              Not finalized
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <section className="space-y-3 rounded-md border border-border bg-surface p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-text-muted">
              Financial Preview
            </p>
            <div className="space-y-2">
              <MoneyRow
                label="Base Locked Total"
                value={formatMoney(preview.baseLockedTotal)}
              />
              <MoneyRow
                label="Pending Additions"
                value={formatSignedMoney(preview.pendingAdditions)}
              />
              <MoneyRow
                label="Pending Reductions"
                value={formatSignedMoney(preview.pendingReductions)}
              />
              <MoneyRow
                label="Pending Net Adjustment"
                value={formatSignedMoney(preview.pendingNet)}
                strong
              />
            </div>
          </section>

          <section className="space-y-3 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.18em] text-text-muted">
                Approval Status
              </p>
              {preview.approvalRequired ? (
                <Badge className="rounded-md border-warning/30 bg-warning-soft text-warning">
                  Required
                </Badge>
              ) : (
                <Badge className="rounded-md border-border bg-surface text-text-secondary">
                  Not required
                </Badge>
              )}
            </div>
          </section>

          <section className="space-y-3 border-t border-border pt-4">
            <p className="text-xs uppercase tracking-[0.18em] text-text-muted">
              Parent / Final Invoice Reference
            </p>
            <Link
              href={`/invoices/${preview.parentInvoice.id}`}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:border-accent/60"
            >
              <span className="inline-flex min-w-0 items-center gap-2 font-medium text-text-primary">
                <FileText className="h-4 w-4 shrink-0 text-accent" />
                <span className="truncate">{preview.parentInvoice.number}</span>
              </span>
              <Badge variant="secondary" className="rounded-md">
                {formatEnumLabel(preview.parentInvoice.status)}
              </Badge>
            </Link>
          </section>

          <FinalizeAdjustmentForm
            orderId={orderId}
            workspace={workspace}
            canFinalize={canFinalize}
          />
        </CardContent>
      </Card>
    </aside>
  );
}

function FinalizeAdjustmentForm({
  orderId,
  workspace,
  canFinalize,
}: {
  orderId: string;
  workspace: AdjustmentWorkspaceView;
  canFinalize: boolean;
}) {
  const approvalPayload = {
    reductions:
      workspace.proposal.requiresManagerApproval
        ? [
            {
              lineName: "Finalized workspace net decrease",
              amount: String(
                Math.abs(Number(workspace.proposal.netPayableDelta)).toFixed(3)
              ),
              reason: "WORKSPACE_NET_DECREASE",
            },
          ]
        : [],
    adjustmentLines: workspace.proposal.deltas.map((line) => ({
      description: line.label,
      quantity: Math.abs(line.quantity),
      unitPrice: line.unitPrice,
    })),
  };

  return (
    <form
      action={finalizeAdjustmentWorkspaceAction.bind(null, orderId, workspace.id)}
      className="space-y-3 border-t border-border pt-4"
    >
      <input type="hidden" name="version" value={workspace.version} />
      {workspace.proposal.requiresManagerApproval ? (
        <div className="rounded-md border border-warning/30 bg-warning-soft p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-warning">
            <CircleAlert className="h-4 w-4" />
            Approval required
          </div>
          <CreditNoteApprovalForm approval={approvalPayload} />
        </div>
      ) : null}
      <Button type="submit" disabled={!canFinalize} className="w-full">
        <CheckCircle2 className="mr-2 h-4 w-4" />
        Finalize / Issue Adjustment
      </Button>
      {!workspace.proposal.hasEdits ? (
        <p className="text-xs text-text-secondary">
          Stage at least one edit before issuing an adjustment.
        </p>
      ) : Number(workspace.proposal.netPayableDelta) === 0 ? (
        <p className="text-xs text-text-secondary">
          Net-zero staged changes are previewed here but cannot be issued from this sidebar.
        </p>
      ) : null}
    </form>
  );
}

function formatEnumLabel(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
