"use client";

import { useFormStatus } from "react-dom";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/formatting/money";
import type { PendingCreditNoteApprovalPayload } from "@/app/orders/[orderId]/sales/actions";

type CreditNoteApprovalFormProps = {
  approval: PendingCreditNoteApprovalPayload;
  managerInputId?: string;
  reasonInputId?: string;
};

type CreditNoteApprovalFieldsProps = {
  approval?: PendingCreditNoteApprovalPayload;
};

export function CreditNoteApprovalForm({
  approval,
  managerInputId = "managerApprovedReductionByUserId",
  reasonInputId = "managerApprovedReason",
}: CreditNoteApprovalFormProps) {
  const reductionTotal = approval.reductions.reduce(
    (sum, reduction) => sum + Number(reduction.amount),
    0
  );

  return (
    <div className="space-y-3 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1">
          <p className="font-medium text-text-primary">
            Manager confirmation required
          </p>
          <p>
            Removing these items will issue a {formatMoney(reductionTotal)} credit
            note. A manager must authorize the reduction before it is saved.
          </p>
        </div>
      </div>

      <div className="space-y-1 text-xs" aria-live="polite">
        {approval.reductions.map((reduction, index) => (
          <div
            key={`${reduction.lineName}:${reduction.reason}:${reduction.amount}:${index}`}
            className="flex justify-between gap-3"
          >
            <span className="min-w-0 truncate">
              {reduction.lineName}
              <span className="text-text-secondary"> · {formatReason(reduction.reason)}</span>
            </span>
            <span className="shrink-0 tabular-nums">{formatMoney(reduction.amount)}</span>
          </div>
        ))}
        {approval.adjustmentLines.length > 0 ? (
          <div className="space-y-1 pt-1 text-text-secondary">
            <p>This save also issues adjustment lines in the same transaction.</p>
            {approval.adjustmentLines.map((line, index) => (
              <div
                key={`${line.description}:${line.quantity}:${line.unitPrice}:${index}`}
                className="flex justify-between gap-3"
              >
                <span className="min-w-0 truncate">{line.description}</span>
                <span className="shrink-0 tabular-nums">
                  {line.quantity} x {formatMoney(line.unitPrice)}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor={managerInputId}>Manager user ID</Label>
        <Input
          id={managerInputId}
          name="managerApprovedReductionByUserId"
          placeholder="Manager or admin user ID"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={reasonInputId}>Reason</Label>
        <Textarea
          id={reasonInputId}
          name="managerApprovedReason"
          maxLength={500}
          placeholder="Optional reason for issuing this credit note"
        />
      </div>
    </div>
  );
}

export function CreditNoteApprovalFields({
  approval,
}: CreditNoteApprovalFieldsProps) {
  if (!approval) return null;

  return (
    <>
      <CreditNoteApprovalForm approval={approval} />
      <ConfirmReductionButton />
    </>
  );
}

function ConfirmReductionButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" disabled={pending}>
      <ShieldCheck className="h-4 w-4" />
      {pending ? "Confirming..." : "Confirm Reduction"}
    </Button>
  );
}

function formatReason(reason: string): string {
  return reason.toLowerCase().replace(/_/g, " ");
}
