import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, CircleAlert, Minus, Plus, RotateCcw, X } from "lucide-react";
import { requireCurrentAppUser } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditNoteApprovalForm } from "@/components/orders/credit-note-approval-fields";
import {
  getAdjustmentWorkspaceCatalog,
  getAdjustmentWorkspaceView,
  getOpenWorkspaceForOrder,
} from "@/modules/adjustment-workspace/adjustment-workspace.service";
import type {
  AdjustmentCompositionLine,
  AdjustmentWorkspaceView,
} from "@/modules/adjustment-workspace/adjustment-workspace.types";
import {
  addWorkspaceLineAction,
  cancelAdjustmentWorkspaceAction,
  finalizeAdjustmentWorkspaceAction,
  modifyWorkspaceLineQuantityAction,
  removeWorkspaceEditAction,
  removeWorkspaceLineAction,
  swapWorkspacePackageAction,
  takeOverAdjustmentWorkspaceAction,
} from "./actions";

export default async function AdjustmentWorkspacePage(
  props: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await props.params;
  const [appUser, openWorkspace] = await Promise.all([
    requireCurrentAppUser(),
    getOpenWorkspaceForOrder(orderId),
  ]);
  if (!openWorkspace) redirect(`/orders/${orderId}/sales`);

  const [workspace, catalog] = await Promise.all([
    getAdjustmentWorkspaceView(openWorkspace.id),
    getAdjustmentWorkspaceCatalog(),
  ]);
  if (!workspace) notFound();

  const isManager = appUser.role === "ADMIN" || appUser.role === "MANAGER";
  const isOwner = workspace.currentOwnerUserId === appUser.id;
  const canEdit = isOwner || isManager;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl space-y-5 px-6 py-6">
        <Button variant="ghost" asChild className="px-0">
          <Link href={`/orders/${orderId}/sales`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to sales
          </Link>
        </Button>

        <header className="rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-text-muted">
                Job {workspace.jobNumber} · Invoice {workspace.invoiceNumber}
              </p>
              <h1 className="mt-2 text-[28px] font-semibold text-text-primary">
                Adjustment Workspace
              </h1>
              <p className="mt-1 text-sm text-text-secondary">
                Owner: {workspace.currentOwnerName ?? workspace.openedByName}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {workspace.proposal.requiresManagerApproval ? (
                <Badge className="rounded-md border-warning/30 bg-warning-soft text-warning">
                  Manager approval required on finalize
                </Badge>
              ) : (
                <Badge className="rounded-md border-border bg-surface-soft text-text-secondary">
                  No approval currently required
                </Badge>
              )}
              {!isOwner && isManager ? (
                <form
                  action={takeOverAdjustmentWorkspaceAction.bind(
                    null,
                    orderId,
                    workspace.id
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
        </header>

        {!canEdit ? (
          <div className="rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
            Workspace open by {workspace.currentOwnerName ?? workspace.openedByName}.
          </div>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <CompositionPanel
            title="Original Composition"
            lines={workspace.baseSnapshot.lines}
            subdued
          />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Working Composition</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <CompositionRows
                workspace={workspace}
                lines={workspace.proposal.proposed.lines}
                canEdit={canEdit}
              />
              <div className="border-t border-border pt-4">
                <AddLineForm
                  workspace={workspace}
                  products={catalog.products}
                  disabled={!canEdit}
                />
              </div>
              <div className="border-t border-border pt-4">
                <SwapPackageForm
                  workspace={workspace}
                  packages={catalog.packages}
                  disabled={!canEdit}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pending Diff</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {workspace.pendingChanges.edits.length > 0 ? (
              <div className="grid gap-2">
                {workspace.pendingChanges.edits.map((edit) => (
                  <div
                    key={edit.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-soft p-3 text-sm"
                  >
                    <span className="text-text-primary">{formatEdit(edit)}</span>
                    {canEdit ? (
                      <form
                        action={removeWorkspaceEditAction.bind(
                          null,
                          orderId,
                          workspace.id
                        )}
                      >
                        <input type="hidden" name="version" value={workspace.version} />
                        <input type="hidden" name="editId" value={edit.id} />
                        <Button type="submit" size="sm" variant="ghost">
                          <X className="h-4 w-4" />
                          <span className="sr-only">Remove edit</span>
                        </Button>
                      </form>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-border p-4 text-sm text-text-secondary">
                No staged edits yet.
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <div>
                <p className="text-sm text-text-secondary">Live net delta</p>
                <p
                  className={`text-xl font-semibold ${
                    Number(workspace.proposal.netPayableDelta) < 0
                      ? "text-danger"
                      : Number(workspace.proposal.netPayableDelta) > 0
                        ? "text-success"
                        : "text-text-primary"
                  }`}
                >
                  {formatSignedKD(workspace.proposal.netPayableDelta)}
                </p>
              </div>
              <FinalizeControls
                workspace={workspace}
                orderId={orderId}
                canEdit={canEdit}
              />
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function CompositionPanel({
  title,
  lines,
  subdued,
}: {
  title: string;
  lines: AdjustmentCompositionLine[];
  subdued?: boolean;
}) {
  return (
    <Card className={subdued ? "bg-surface-soft" : undefined}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {lines.map((line) => (
            <LineReadout key={line.lineId} line={line} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CompositionRows({
  workspace,
  lines,
  canEdit,
}: {
  workspace: AdjustmentWorkspaceView;
  lines: AdjustmentCompositionLine[];
  canEdit: boolean;
}) {
  return (
    <div className="space-y-2">
      {lines.map((line) => (
        <div
          key={line.lineId}
          className="grid gap-3 rounded-md border border-border bg-surface-soft p-3 md:grid-cols-[1fr_auto_auto]"
        >
          <LineReadout line={line} />
          {canEdit ? (
            <form
              action={modifyWorkspaceLineQuantityAction.bind(
                null,
                workspace.orderId,
                workspace.id
              )}
              className="flex items-center gap-2"
            >
              <input type="hidden" name="version" value={workspace.version} />
              <input type="hidden" name="targetLineId" value={line.lineId} />
              <label className="sr-only" htmlFor={`qty-${line.lineId}`}>
                Quantity
              </label>
              <input
                id={`qty-${line.lineId}`}
                name="newQuantity"
                type="number"
                min="0"
                defaultValue={line.quantity}
                className="h-9 w-20 rounded-md border border-border bg-surface px-3 text-sm"
              />
              <Button type="submit" size="sm" variant="outline">
                Update
              </Button>
            </form>
          ) : null}
          {canEdit ? (
            <form
              action={removeWorkspaceLineAction.bind(
                null,
                workspace.orderId,
                workspace.id
              )}
            >
              <input type="hidden" name="version" value={workspace.version} />
              <input type="hidden" name="targetLineId" value={line.lineId} />
              <Button type="submit" size="sm" variant="outline">
                <Minus className="h-4 w-4" />
                <span className="sr-only">Remove line</span>
              </Button>
            </form>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function LineReadout({ line }: { line: AdjustmentCompositionLine }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium text-text-primary">{line.label}</p>
        <Badge variant="outline" className="rounded-md capitalize">
          {line.kind}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-text-secondary">
        {line.quantity} × {line.unitPrice} KD · {line.lineTotalNet} KD
      </p>
    </div>
  );
}

function AddLineForm({
  workspace,
  products,
  disabled,
}: {
  workspace: AdjustmentWorkspaceView;
  products: Array<{
    id: string;
    name: string;
    priceLabel: string;
    isAddOn: boolean;
  }>;
  disabled: boolean;
}) {
  return (
    <form
      action={addWorkspaceLineAction.bind(null, workspace.orderId, workspace.id)}
      className="flex flex-wrap items-end gap-3"
    >
      <input type="hidden" name="version" value={workspace.version} />
      <div className="space-y-1">
        <label className="text-xs text-text-muted" htmlFor="workspace-line-kind">
          Type
        </label>
        <select
          id="workspace-line-kind"
          name="kind"
          className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
          disabled={disabled}
          defaultValue="addon"
        >
          <option value="addon">Add-on</option>
          <option value="item">Item</option>
        </select>
      </div>
      <div className="min-w-64 flex-1 space-y-1">
        <label className="text-xs text-text-muted" htmlFor="workspace-ref-id">
          Catalog item
        </label>
        <select
          id="workspace-ref-id"
          name="refId"
          className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
          disabled={disabled}
        >
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name} · {product.priceLabel}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-xs text-text-muted" htmlFor="workspace-quantity">
          Qty
        </label>
        <input
          id="workspace-quantity"
          name="quantity"
          type="number"
          min="1"
          defaultValue="1"
          className="h-10 w-20 rounded-md border border-border bg-surface px-3 text-sm"
          disabled={disabled}
        />
      </div>
      <Button type="submit" disabled={disabled || products.length === 0}>
        <Plus className="mr-2 h-4 w-4" />
        Add
      </Button>
    </form>
  );
}

function SwapPackageForm({
  workspace,
  packages,
  disabled,
}: {
  workspace: AdjustmentWorkspaceView;
  packages: Array<{ id: string; name: string; priceLabel: string }>;
  disabled: boolean;
}) {
  const packageLine = workspace.proposal.proposed.lines.find(
    (line) => line.kind === "package"
  );
  if (!packageLine) return null;

  return (
    <form
      action={swapWorkspacePackageAction.bind(null, workspace.orderId, workspace.id)}
      className="flex flex-wrap items-end gap-3"
    >
      <input type="hidden" name="version" value={workspace.version} />
      <input type="hidden" name="fromPackageRefId" value={packageLine.refId} />
      <div className="min-w-64 flex-1 space-y-1">
        <label className="text-xs text-text-muted" htmlFor="workspace-package-swap">
          Swap package
        </label>
        <select
          id="workspace-package-swap"
          name="toPackageRefId"
          className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
          disabled={disabled}
          defaultValue={packageLine.refId}
        >
          {packages.map((packageRow) => (
            <option key={packageRow.id} value={packageRow.id}>
              {packageRow.name} · {packageRow.priceLabel}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" variant="outline" disabled={disabled || packages.length === 0}>
        Swap
      </Button>
    </form>
  );
}

function FinalizeControls({
  workspace,
  orderId,
  canEdit,
}: {
  workspace: AdjustmentWorkspaceView;
  orderId: string;
  canEdit: boolean;
}) {
  const approvalPayload = {
    reductions:
      workspace.proposal.requiresManagerApproval
        ? [
            {
              lineName: "Finalized workspace net decrease",
              amount: String(Math.abs(Number(workspace.proposal.netPayableDelta)).toFixed(3)),
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
    <div className="flex flex-wrap items-start justify-end gap-3">
      <form
        action={cancelAdjustmentWorkspaceAction.bind(null, orderId, workspace.id)}
      >
        <input type="hidden" name="version" value={workspace.version} />
        <Button type="submit" variant="outline" disabled={!canEdit}>
          Cancel
        </Button>
      </form>
      <form
        action={finalizeAdjustmentWorkspaceAction.bind(null, orderId, workspace.id)}
        className="min-w-80 space-y-3"
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
        <Button
          type="submit"
          disabled={!canEdit || !workspace.proposal.hasEdits}
          className="w-full"
        >
          <CheckCircle2 className="mr-2 h-4 w-4" />
          Finalize
        </Button>
      </form>
    </div>
  );
}

function formatEdit(edit: AdjustmentWorkspaceView["pendingChanges"]["edits"][number]) {
  if (edit.op === "add_line") return `Add ${edit.quantity} ${edit.kind}`;
  if (edit.op === "remove_line") return `Remove line ${edit.targetLineId}`;
  if (edit.op === "modify_quantity") {
    return `Change ${edit.targetLineId} quantity to ${edit.newQuantity}`;
  }
  if (edit.op === "swap_package") {
    return `Swap package ${edit.fromPackageRefId} → ${edit.toPackageRefId}`;
  }
  return `Swap add-on ${edit.targetLineId}`;
}

function formatSignedKD(value: string) {
  const numeric = Number(value);
  if (numeric > 0) return `+${value} KD`;
  if (numeric < 0) return `${value} KD`;
  return "0.000 KD";
}
