import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, CircleAlert, RotateCcw, X } from "lucide-react";
import { requireCurrentAppUser } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditNoteApprovalForm } from "@/components/orders/credit-note-approval-fields";
import { POSAddOnMarketplace } from "@/components/orders/pos-add-on-marketplace";
import {
  POSPackageComposition,
  POSPhotoCountCard,
} from "@/components/orders/pos-package-composition";
import {
  derivePOSWorkspaceFromAdjustmentWorkspace,
  getAdjustmentWorkspaceView,
  getOpenWorkspaceForOrder,
} from "@/modules/adjustment-workspace/adjustment-workspace.service";
import type {
  AdjustmentCompositionLine,
  AdjustmentWorkspaceView,
} from "@/modules/adjustment-workspace/adjustment-workspace.types";
import type {
  POSAddOnHandlers,
  POSCompositionHandlers,
} from "@/modules/orders/pos-handlers.types";
import {
  cancelAdjustmentWorkspaceAction,
  finalizeAdjustmentWorkspaceAction,
  removeWorkspaceEditAction,
  stageMarketplaceAddOnAction,
  stageMarketplaceAddOnQuantityAction,
  stageMarketplaceAddOnRemovalAction,
  stagePackageItemUpgradeAction,
  stagePackageTierChangeAction,
  stageSelectedPhotoCountChangeAction,
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

  const [workspace, derivedPOSWorkspace] = await Promise.all([
    getAdjustmentWorkspaceView(openWorkspace.id),
    derivePOSWorkspaceFromAdjustmentWorkspace(openWorkspace.id),
  ]);
  if (!workspace || !derivedPOSWorkspace) notFound();

  const isManager = appUser.role === "ADMIN" || appUser.role === "MANAGER";
  const isOwner = workspace.currentOwnerUserId === appUser.id;
  const canEdit = isOwner || isManager;
  const compositionHandlers = createWorkspaceCompositionHandlers(
    orderId,
    workspace.id,
    workspace.version
  );
  const addOnHandlers = createWorkspaceAddOnHandlers(
    orderId,
    workspace.id,
    workspace.version
  );

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
          <section className="space-y-5">
            <POSPackageComposition
              workspace={derivedPOSWorkspace}
              handlers={compositionHandlers}
            />
            <POSPhotoCountCard
              workspace={derivedPOSWorkspace}
              handlers={compositionHandlers}
            />
            <POSAddOnMarketplace
              workspace={derivedPOSWorkspace}
              handlers={addOnHandlers}
            />
          </section>
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

function createWorkspaceCompositionHandlers(
  orderId: string,
  workspaceId: string,
  version: number
): POSCompositionHandlers {
  async function changePackageTier(input: {
    orderPackageId: string;
    toPackageRefId: string;
  }) {
    "use server";

    return stagePackageTierChangeAction(orderId, workspaceId, {
      version,
      ...input,
    });
  }

  async function upgradePackageItem(input: {
    orderPackageId: string;
    packageItemId: string;
    toProductId: string;
    quantity: number;
  }) {
    "use server";

    return stagePackageItemUpgradeAction(orderId, workspaceId, {
      version,
      ...input,
    });
  }

  async function changeSelectedPhotoCount(input: {
    orderPackageId: string;
    selectedPhotoCount: number;
    extraDigitalCount: number;
    extraPrintCount: number;
  }) {
    "use server";

    return stageSelectedPhotoCountChangeAction(orderId, workspaceId, {
      version,
      ...input,
    });
  }

  return {
    changePackageTier,
    upgradePackageItem,
    changeSelectedPhotoCount,
    shouldPromptInlineApproval: false,
  };
}

function createWorkspaceAddOnHandlers(
  orderId: string,
  workspaceId: string,
  version: number
): POSAddOnHandlers {
  async function addAddOn(input: { productId: string; quantity: number }) {
    "use server";

    return stageMarketplaceAddOnAction(orderId, workspaceId, {
      version,
      ...input,
    });
  }

  async function removeAddOn(input: { addOnId: string }) {
    "use server";

    return stageMarketplaceAddOnRemovalAction(orderId, workspaceId, {
      version,
      ...input,
    });
  }

  async function changeAddOnQuantity(input: { addOnId: string; quantity: number }) {
    "use server";

    return stageMarketplaceAddOnQuantityAction(orderId, workspaceId, {
      version,
      ...input,
    });
  }

  return {
    addAddOn,
    removeAddOn,
    changeAddOnQuantity,
    shouldPromptInlineApproval: false,
  };
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
  if (edit.op === "upgrade_package_item") {
    return `Upgrade package item ${edit.packageItemId}`;
  }
  if (edit.op === "change_selected_photo_count") {
    return `Change selected photos to ${edit.selectedPhotoCount}`;
  }
  if (edit.op === "change_package_tier") {
    return `Change package tier to ${edit.toPackageRefId}`;
  }
  return `Swap add-on ${edit.targetLineId}`;
}

function formatSignedKD(value: string) {
  const numeric = Number(value);
  if (numeric > 0) return `+${value} KD`;
  if (numeric < 0) return `${value} KD`;
  return "0.000 KD";
}
