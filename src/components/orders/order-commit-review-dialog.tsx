"use client";

import {
  type FormEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import {
  commitSalesChangesAction,
} from "@/app/orders/[orderId]/sales/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney, formatSignedMoney } from "@/lib/formatting/money";
import type { POSMutationActionState } from "@/modules/orders/pos-handlers.types";
import type {
  SalesPageDraftState,
  SalesPageFinancialPreview,
  SalesPagePreviewState,
  SalesPageStagedChangesRow,
} from "@/modules/order-commits/projections/sales-page-view.types";

type CommitAction = (
  orderId: string,
  expectedDraftVersion: number,
  approvalActorUserId?: string
) => Promise<POSMutationActionState>;

export type OrderCommitReviewDialogProps = {
  orderId: string;
  draft: SalesPageDraftState | null;
  preview: SalesPagePreviewState | null;
  stagedChanges: SalesPageStagedChangesRow[];
  financialPreview: SalesPageFinancialPreview;
  canCommit?: boolean;
  commitAction?: CommitAction;
};

export type OrderCommitReviewDialogBodyProps = {
  preview: SalesPagePreviewState;
  stagedChanges: SalesPageStagedChangesRow[];
  financialPreview: SalesPageFinancialPreview;
  actionState?: POSMutationActionState;
  approvalActorUserId: string;
  onApprovalActorUserIdChange: (value: string) => void;
  approvalInputRef?: Ref<HTMLInputElement>;
  pending?: boolean;
};

export function OrderCommitReviewDialog({
  orderId,
  draft,
  preview,
  stagedChanges,
  financialPreview,
  canCommit = true,
  commitAction = commitSalesChangesAction,
}: OrderCommitReviewDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [approvalActorUserId, setApprovalActorUserId] = useState("");
  const [state, setState] = useState<POSMutationActionState>({});
  const [pending, startTransition] = useTransition();
  const approvalInputRef = useRef<HTMLInputElement>(null);
  const canSubmit = Boolean(draft && preview && canCommit);
  const needsApproval = previewRequiresApproval(preview, state);

  useEffect(() => {
    if (state.kind === "approval-required") {
      approvalInputRef.current?.focus();
    }
  }, [state]);

  if (!canSubmit || !draft || !preview) {
    return (
      <Button type="button" variant="outline" disabled>
        <ClipboardCheck className="h-4 w-4" />
        Review &amp; commit
      </Button>
    );
  }

  const expectedDraftVersion = draft.version;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (needsApproval && approvalActorUserId.trim().length === 0) {
      setState({
        kind: "approval-required",
        errors: {
          approvalActorUserId: ["Manager/admin user ID is required."],
          _global: ["commit.approvalRequired"],
        },
      });
      return;
    }

    startTransition(async () => {
      const nextState = await commitAction(
        orderId,
        expectedDraftVersion,
        approvalActorUserId.trim() || undefined
      );
      setState(nextState);

      if (nextState.kind === "success") {
        setOpen(false);
        setApprovalActorUserId("");
        toast.success("Sales changes committed.");
        router.refresh();
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) return;
        setState({});
        setApprovalActorUserId("");
      }}
    >
      <DialogTrigger asChild>
        <Button type="button">
          <ClipboardCheck className="h-4 w-4" />
          Review &amp; commit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Review &amp; commit</DialogTitle>
          <DialogDescription>
            Confirm the staged Sales changes and document impact before committing.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <OrderCommitReviewDialogBody
            preview={preview}
            stagedChanges={stagedChanges}
            financialPreview={financialPreview}
            actionState={state}
            approvalActorUserId={approvalActorUserId}
            onApprovalActorUserIdChange={setApprovalActorUserId}
            approvalInputRef={approvalInputRef}
            pending={pending}
          />
          <DialogFooter>
            {commitErrorNeedsRefresh(state) ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => router.refresh()}
                disabled={pending}
              >
                Refresh
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              <CheckCircle2 className="h-4 w-4" />
              {pending ? "Committing..." : "Commit changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function OrderCommitReviewDialogBody({
  preview,
  stagedChanges,
  financialPreview,
  actionState = {},
  approvalActorUserId,
  onApprovalActorUserIdChange,
  approvalInputRef,
}: OrderCommitReviewDialogBodyProps) {
  const totals = useMemo(
    () => getOrderCommitReviewTotals(preview, financialPreview),
    [preview, financialPreview]
  );
  const inlineMessages = commitDialogInlineMessages(actionState);
  const needsApproval = previewRequiresApproval(preview, actionState);

  return (
    <div className="space-y-4">
      {inlineMessages.length > 0 ? (
        <div
          className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
          role="alert"
        >
          {inlineMessages[0]}
        </div>
      ) : null}

      <section className="grid gap-2 sm:grid-cols-3">
        <SummaryMetric label="Previous total" value={formatMoney(totals.previousTotal)} />
        <SummaryMetric
          label="Pending delta"
          value={formatSignedMoney(totals.pendingDelta)}
        />
        <SummaryMetric label="After commit" value={formatMoney(totals.pendingTotal)} />
      </section>

      <section className="space-y-2">
        <SectionHeading icon={<ClipboardCheck className="h-4 w-4" />}>
          Staged changes
        </SectionHeading>
        {stagedChanges.length > 0 ? (
          <div className="space-y-2">
            {stagedChanges.map((row) => (
              <div
                key={row.id}
                className="flex items-start justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-text-primary">{row.label}</p>
                  <p className="text-xs text-text-secondary">
                    {humanizeIdentifier(row.changeKind)}
                    {row.parentLabel ? ` · ${row.parentLabel}` : ""}
                  </p>
                </div>
                <span className="shrink-0 tabular-nums text-text-primary">
                  {formatSignedMoney(row.netDelta)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-border bg-surface-soft px-3 py-2 text-sm text-text-secondary">
            {previewNoOpCopy(preview)}
          </div>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <ConsequenceBlock
          title="Document plan"
          badge={humanizeIdentifier(preview.documentPlan.kind)}
          lines={[
            ["Amount", formatMoney(preview.documentPlan.amount)],
            ["Reason", preview.documentPlan.reason ?? "No additional reason"],
          ]}
        />
        <ConsequenceBlock
          title="Payment impact"
          badge={humanizeIdentifier(preview.paymentImpact.kind)}
          lines={[
            ["Amount due", formatMoney(preview.paymentImpact.amountDue)],
            ["Credit", formatMoney(preview.paymentImpact.creditAmount)],
            [
              "Remaining",
              formatSignedMoney(preview.paymentImpact.remainingAfterCommit),
            ],
          ]}
        />
        <ConsequenceBlock
          title="Refund impact"
          badge={preview.refundImpact.refundRequired ? "Review needed" : "None"}
          lines={[
            ["Refundable", formatMoney(preview.refundImpact.refundableAmount)],
            ["Credit note", formatMoney(preview.refundImpact.creditNoteAmount)],
            ["Reason", preview.refundImpact.reason ?? "No refund review required"],
          ]}
        />
      </section>

      {preview.approvalReasons.length > 0 ? (
        <section className="space-y-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
          <SectionHeading icon={<ShieldCheck className="h-4 w-4" />}>
            Approval required
          </SectionHeading>
          <div className="space-y-1">
            {preview.approvalReasons.map((reason) => (
              <p key={reason.code}>{reason.message}</p>
            ))}
          </div>
        </section>
      ) : null}

      {needsApproval ? (
        <section className="space-y-2">
          <Label htmlFor="orderCommitApprovalActorUserId">
            Manager/admin user ID
          </Label>
          <Input
            ref={approvalInputRef}
            id="orderCommitApprovalActorUserId"
            name="approvalActorUserId"
            value={approvalActorUserId}
            onChange={(event) => onApprovalActorUserIdChange(event.target.value)}
            placeholder="Manager or admin user ID"
            aria-invalid={Boolean(actionState.errors?.approvalActorUserId)}
          />
          {actionState.errors?.approvalActorUserId?.[0] ? (
            <p className="text-xs text-danger">
              {actionState.errors.approvalActorUserId[0]}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export function getOrderCommitReviewTotals(
  preview: SalesPagePreviewState,
  financialPreview: SalesPageFinancialPreview
): {
  previousTotal: number;
  pendingDelta: number;
  pendingTotal: number;
} {
  return {
    previousTotal:
      financialPreview.overlay.previousTotal ?? preview.totals.baselineTotal,
    pendingDelta:
      financialPreview.overlay.pendingDelta ?? preview.totals.netDelta,
    pendingTotal:
      financialPreview.overlay.pendingTotal ?? preview.totals.pendingTotal,
  };
}

export function commitDialogInlineMessages(
  state: POSMutationActionState
): string[] {
  const globalMessages = state.errors?._global ?? [];
  if (globalMessages[0] === "commit.approvalRequired") {
    return ["Manager/admin approval is required before this commit can finish."];
  }
  if (globalMessages[0] === "commit.permission") {
    return ["Another user owns this draft. Refresh or coordinate before committing."];
  }
  if (globalMessages[0] === "commit.stale") return [];
  if (globalMessages[0] === "commit.concurrent") return [];
  return globalMessages;
}

export function commitErrorNeedsRefresh(state: POSMutationActionState): boolean {
  const globalMessages = state.errors?._global ?? [];
  return globalMessages.some((message) =>
    ["commit.stale", "commit.concurrent", "commit.permission"].includes(message)
  );
}

export function previewRequiresApproval(
  preview: SalesPagePreviewState | null,
  state: POSMutationActionState
): boolean {
  return Boolean(preview?.requiresApproval || state.kind === "approval-required");
}

export function previewNoOpCopy(preview: SalesPagePreviewState): string {
  if (preview.zeroNetReason) return humanizeIdentifier(preview.zeroNetReason);
  return preview.documentPlan.reason ?? "No staged rows require a financial document.";
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-soft px-3 py-2">
      <p className="text-xs text-text-secondary">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-text-primary">{value}</p>
    </div>
  );
}

function SectionHeading({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
      {icon}
      <span>{children}</span>
    </div>
  );
}

function ConsequenceBlock({
  title,
  badge,
  lines,
}: {
  title: string;
  badge: string;
  lines: Array<[string, string]>;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-surface px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium text-text-primary">
          {title === "Document plan" ? (
            <FileText className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
          <span>{title}</span>
        </div>
        <Badge variant="outline">{badge}</Badge>
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

function humanizeIdentifier(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
