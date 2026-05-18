import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, RotateCcw, X } from "lucide-react";
import { requireCurrentAppUser } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmSubmitButton } from "@/components/orders/confirm-submit-button";
import { CurrentCompositionCard } from "@/components/orders/current-composition-card";
import { FinancialSidebarAdjustment } from "@/components/orders/financial-sidebar-adjustment";
import { POSAddOnMarketplace } from "@/components/orders/pos-add-on-marketplace";
import {
  POSPackageComposition,
  POSPhotoCountCard,
} from "@/components/orders/pos-package-composition";
import type { PendingSessionConfigurationOverlay } from "@/components/session-configurations/configure-session-panel";
import { buildCompositionView } from "@/modules/composition-view/composition-view.model";
import {
  derivePendingAdjustmentPreview,
  derivePOSWorkspaceFromAdjustmentWorkspace,
  getAdjustmentWorkspaceView,
  getOpenWorkspaceForOrder,
} from "@/modules/adjustment-workspace/adjustment-workspace.service";
import { buildPendingChangesView } from "@/modules/adjustment-workspace/pending-changes-view";
import type { PendingChangeRow } from "@/modules/adjustment-workspace/pending-changes-view";
import type { AdjustmentWorkspaceEdit } from "@/modules/adjustment-workspace/adjustment-workspace.types";
import {
  cancelAdjustmentWorkspaceAction,
  removeWorkspaceEditAction,
  takeOverAdjustmentWorkspaceAction,
} from "./actions";
import {
  createWorkspaceAddOnHandlers,
  createWorkspaceCompositionHandlers,
} from "./pos-handler-adapters";

export default async function AdjustmentWorkspacePage(
  props: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await props.params;
  const [appUser, openWorkspace] = await Promise.all([
    requireCurrentAppUser(),
    getOpenWorkspaceForOrder(orderId),
  ]);
  if (!openWorkspace) redirect(`/orders/${orderId}/sales`);

  const [workspace, derivedPOSWorkspace, financialPreview] = await Promise.all([
    getAdjustmentWorkspaceView(openWorkspace.id),
    derivePOSWorkspaceFromAdjustmentWorkspace(openWorkspace.id),
    derivePendingAdjustmentPreview(openWorkspace.id),
  ]);
  if (!workspace || !derivedPOSWorkspace || !financialPreview) notFound();

  const isManager = appUser.role === "ADMIN" || appUser.role === "MANAGER";
  const isOwner = workspace.currentOwnerUserId === appUser.id;
  const canEdit = isOwner || isManager;
  const compositionHandlers = createWorkspaceCompositionHandlers(
    orderId,
    workspace.id
  );
  const addOnHandlers = createWorkspaceAddOnHandlers(
    orderId,
    workspace.id
  );
  const previewComposition = buildCompositionView({
    lines: workspace.proposal.proposed.lines,
    totals: workspace.proposal.proposed.totals,
    mode: "adjustment",
  });
  const pendingChanges = buildPendingChangesView(workspace.pendingChanges.edits, {
    base: workspace.baseSnapshot,
    proposed: workspace.proposal.proposed,
    deltas: workspace.proposal.deltas,
  });
  const pendingOverlayByOrderPackageId = buildSessionConfigurationPendingOverlay(
    workspace.pendingChanges.edits
  );
  console.info(
    JSON.stringify({
      metric: "adjustment_workspace.configure_session_panel_rendered",
      orderId,
      workspaceId: workspace.id,
    })
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

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section className="space-y-5">
            {canEdit ? (
              <section className="space-y-4">
                <div>
                  <h2 className="text-xl font-semibold text-text-primary">
                    Stage Edits
                  </h2>
                  <p className="mt-1 text-sm text-text-secondary">
                    Use the POS tools to stage package, photo, and add-on changes.
                  </p>
                </div>
                <POSPackageComposition
                  workspace={derivedPOSWorkspace}
                  handlers={compositionHandlers}
                  configurePanelMode="adjustment"
                  workspaceId={workspace.id}
                  workspaceVersion={workspace.version}
                  pendingOverlayByOrderPackageId={pendingOverlayByOrderPackageId}
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
            ) : null}

            <CurrentCompositionCard view={previewComposition} />

            <PendingChangesBlock
              rows={pendingChanges}
              workspaceId={workspace.id}
              orderId={orderId}
              version={workspace.version}
              canEdit={canEdit}
            />

            <PendingAdjustmentSummary
              workspaceId={workspace.id}
              orderId={orderId}
              version={workspace.version}
              canEdit={canEdit}
              additions={financialPreview.pendingAdditions}
              reductions={financialPreview.pendingReductions}
              net={financialPreview.pendingNet}
              approvalRequired={financialPreview.approvalRequired}
            />
          </section>

          <FinancialSidebarAdjustment
            orderId={orderId}
            workspace={workspace}
            preview={financialPreview}
            canEdit={canEdit}
            className="lg:sticky lg:top-6"
          />
        </div>
      </main>
    </div>
  );
}

function buildSessionConfigurationPendingOverlay(
  edits: AdjustmentWorkspaceEdit[]
): Record<string, PendingSessionConfigurationOverlay> {
  const overlays: Record<string, PendingSessionConfigurationOverlay> = {};
  for (const edit of edits) {
    if (edit.op !== "change_session_configuration_selection") continue;
    overlays[edit.orderPackageId] ??= {};
    overlays[edit.orderPackageId][edit.configurationId] =
      edit.desired === null
        ? null
        : { configurationId: edit.configurationId, ...edit.desired };
  }
  return overlays;
}

function PendingChangesBlock({
  rows,
  workspaceId,
  orderId,
  version,
  canEdit,
}: {
  rows: PendingChangeRow[];
  workspaceId: string;
  orderId: string;
  version: number;
  canEdit: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pending Changes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length > 0 ? (
          <div className="grid gap-2">
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-soft p-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium text-text-primary">{row.label}</p>
                  <p className="mt-1 text-text-secondary">
                    {row.description}
                    {row.amount !== 0 ? ` (${formatSignedKD(row.amount)})` : ""}
                  </p>
                </div>
                {canEdit ? (
                  <form
                    action={removeWorkspaceEditAction.bind(
                      null,
                      orderId,
                      workspaceId
                    )}
                  >
                    <input type="hidden" name="version" value={version} />
                    <input type="hidden" name="editId" value={row.id} />
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
      </CardContent>
    </Card>
  );
}

function PendingAdjustmentSummary({
  workspaceId,
  orderId,
  version,
  canEdit,
  additions,
  reductions,
  net,
  approvalRequired,
}: {
  workspaceId: string;
  orderId: string;
  version: number;
  canEdit: boolean;
  additions: number;
  reductions: number;
  net: number;
  approvalRequired: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pending Adjustment Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <SummaryAmount label="Total Additions" value={additions} />
          <SummaryAmount label="Total Reductions" value={reductions} />
          <SummaryAmount label="Net Adjustment" value={net} strong />
          <div className="rounded-md border border-border bg-surface-soft p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-text-muted">
              Approval
            </p>
            <p className="mt-2 text-sm font-semibold text-text-primary">
              {approvalRequired ? "Required" : "Not required"}
            </p>
          </div>
        </div>
        <form
          action={cancelAdjustmentWorkspaceAction.bind(null, orderId, workspaceId)}
          className="border-t border-border pt-4"
        >
          <input type="hidden" name="version" value={version} />
          <ConfirmSubmitButton
            variant="outline"
            disabled={!canEdit}
            confirmMessage="Discard all staged changes and close this workspace?"
          >
            Cancel / Discard staged changes
          </ConfirmSubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}

function SummaryAmount({
  label,
  value,
  strong,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-soft p-3">
      <p className="text-xs uppercase tracking-[0.14em] text-text-muted">{label}</p>
      <p
        className={`mt-2 text-sm font-semibold tabular-nums ${
          strong
            ? Number(value) < 0
              ? "text-danger"
              : Number(value) > 0
                ? "text-success"
                : "text-text-primary"
            : "text-text-primary"
        }`}
      >
        {formatSignedKD(value)}
      </p>
    </div>
  );
}

function formatSignedKD(value: number) {
  const formatted = `${Math.abs(value).toFixed(3)} KD`;
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return "0.000 KD";
}
