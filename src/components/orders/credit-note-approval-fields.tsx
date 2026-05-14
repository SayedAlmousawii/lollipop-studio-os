"use client";

import { useFormStatus } from "react-dom";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type PendingCreditNoteApproval = {
  reductions: Array<{ lineName: string; amount: string; reason: string }>;
  adjustmentLines: Array<{
    description: string;
    quantity: number;
    unitPrice: string;
  }>;
};

type CreditNoteApprovalFieldsProps = {
  approval?: PendingCreditNoteApproval;
};

export function CreditNoteApprovalFields({
  approval,
}: CreditNoteApprovalFieldsProps) {
  if (!approval) return null;

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
            This reduces the final invoice by {formatKD(reductionTotal)} via
            credit note.
          </p>
        </div>
      </div>

      <div className="space-y-1 text-xs">
        {approval.reductions.map((reduction, index) => (
          <div
            key={`${reduction.lineName}:${reduction.reason}:${reduction.amount}:${index}`}
            className="flex justify-between gap-3"
          >
            <span className="min-w-0 truncate">{reduction.lineName}</span>
            <span className="shrink-0 tabular-nums">{reduction.amount} KD</span>
          </div>
        ))}
        {approval.adjustmentLines.length > 0 ? (
          <p className="pt-1 text-text-secondary">
            This save also issues an adjustment invoice in the same transaction.
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="managerApprovedReason">Reason</Label>
        <Textarea
          id="managerApprovedReason"
          name="managerApprovedReason"
          maxLength={500}
          placeholder="Reason for issuing this credit note"
        />
      </div>
      <ConfirmReductionButton />
    </div>
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

function formatKD(value: number): string {
  return `${value.toFixed(3)} KD`;
}
