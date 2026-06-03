"use client";

import { type ReactNode, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, RotateCcw } from "lucide-react";
import {
  discardSalesDraftAction,
} from "@/app/orders/[orderId]/sales/actions";
import { OrderCommitReviewDialog } from "@/components/orders/order-commit-review-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatSignedMoney } from "@/lib/formatting/money";
import type { POSMutationActionState } from "@/modules/orders/pos-handlers.types";
import type {
  SalesPageDraftState,
  SalesPageDraftOwnership,
  SalesPageFinancialPreview,
  SalesPagePreviewState,
  SalesPageStagedChangesRow,
} from "@/modules/order-commits/projections/sales-page-view.types";

type DiscardDraftAction = (
  orderId: string,
  expectedVersion: number
) => Promise<POSMutationActionState>;

export type SalesStagedCommitControlsProps = {
  orderId: string;
  draft: SalesPageDraftState | null;
  preview: SalesPagePreviewState | null;
  stagedChanges: SalesPageStagedChangesRow[];
  financialPreview: SalesPageFinancialPreview;
  ownership: SalesPageDraftOwnership;
  discardAction?: DiscardDraftAction;
};

export function SalesStagedCommitControls({
  orderId,
  draft,
  preview,
  stagedChanges,
  financialPreview,
  ownership,
  discardAction = discardSalesDraftAction,
}: SalesStagedCommitControlsProps) {
  const router = useRouter();
  const [discardState, setDiscardState] = useState<POSMutationActionState>({});
  const [pending, startTransition] = useTransition();
  const discardError = discardState.errors?._global?.[0] ?? null;
  const canDiscard = Boolean(draft && ownership.canDiscard);

  function handleDiscard() {
    if (!draft || !ownership.canDiscard) return;

    startTransition(async () => {
      const nextState = await discardAction(orderId, draft.version);
      setDiscardState(nextState);
    });
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <ClipboardList className="h-4 w-4" />
            <span>Staged changes</span>
            <Badge variant="outline">{stagedChanges.length}</Badge>
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            Draft changes stay staged until they are reviewed and committed.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {draft ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleDiscard}
              disabled={pending || !canDiscard}
            >
              <RotateCcw className="h-4 w-4" />
              {pending ? "Discarding..." : "Discard draft"}
            </Button>
          ) : null}
          <OrderCommitReviewDialog
            orderId={orderId}
            draft={draft}
            preview={preview}
            stagedChanges={stagedChanges}
            financialPreview={financialPreview}
            canCommit={ownership.canCommit}
          />
        </div>
      </div>

      {!ownership.canCommit && ownership.mode === "blocked_non_owner" ? (
        <RefreshNotice onRefresh={() => router.refresh()}>
          Another user owns this draft. Refresh or coordinate before committing.
        </RefreshNotice>
      ) : null}

      {discardError ? (
        <RefreshNotice onRefresh={() => router.refresh()}>
          {copyForActionError(discardError)}
        </RefreshNotice>
      ) : null}

      <StagedChangesList stagedChanges={stagedChanges} />
    </section>
  );
}

function RefreshNotice({
  children,
  onRefresh,
}: {
  children: ReactNode;
  onRefresh: () => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
      role="alert"
    >
      <span>{children}</span>
      <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
        Refresh
      </Button>
    </div>
  );
}

function copyForActionError(error: string): string {
  if (error === "draft.stale") {
    return "Draft changed since you opened it. Refresh to see the latest.";
  }
  if (error === "draft.permission") {
    return "Another user owns this draft. Refresh or coordinate before editing.";
  }
  return error;
}

export function StagedChangesList({
  stagedChanges,
}: {
  stagedChanges: SalesPageStagedChangesRow[];
}) {
  if (stagedChanges.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface-soft px-3 py-2 text-sm text-text-secondary">
        No staged changes yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {stagedChanges.map((row) => (
        <StagedChangesRow key={row.id} row={row} />
      ))}
    </div>
  );
}

function StagedChangesRow({ row }: { row: SalesPageStagedChangesRow }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-surface-soft px-3 py-2 text-sm">
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
  );
}

function humanizeIdentifier(value: string): ReactNode {
  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
