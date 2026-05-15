"use client";

import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  confirmReductiveEditWithApproval,
  type PendingCreditNoteApprovalPayload,
  type POSCompositionActionState,
  type ReductiveEditAction,
} from "@/app/orders/[orderId]/sales/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreditNoteApprovalForm } from "@/components/orders/credit-note-approval-fields";

type HiddenField = {
  name: string;
  value: string | number;
};

type ReductiveEditApprovalModalProps = {
  orderId: string;
  action: ReductiveEditAction;
  approval?: PendingCreditNoteApprovalPayload;
  hiddenFields: HiddenField[];
};

export function ReductiveEditApprovalModal({
  orderId,
  action,
  approval,
  hiddenFields,
}: ReductiveEditApprovalModalProps) {
  const router = useRouter();
  const [state, setState] = useState<POSCompositionActionState>({});
  const [pending, startTransition] = useTransition();
  const [dismissedApproval, setDismissedApproval] =
    useState<PendingCreditNoteApprovalPayload | null>(null);
  const triggerElementRef = useRef<HTMLElement | null>(null);
  const managerInputId = `managerApprovedReductionByUserId-${action}`;
  const reasonInputId = `managerApprovedReason-${action}`;
  const open = Boolean(approval) && dismissedApproval !== approval;

  useEffect(() => {
    if (!approval) return;

    triggerElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [approval]);

  if (!approval) return null;

  function cancelReduction() {
    setDismissedApproval(approval ?? null);
    setState({});
    toast.info("Reduction cancelled. The order was not changed.");
    triggerElementRef.current?.focus();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const nextState = await confirmReductiveEditWithApproval(orderId, {}, formData);
      setState(nextState);
      if (nextState.kind === "success") {
        setDismissedApproval(approval ?? null);
        router.refresh();
        triggerElementRef.current?.focus();
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          cancelReduction();
          return;
        }
        setDismissedApproval(null);
      }}
    >
      <DialogContent role="alertdialog" aria-describedby="reductive-edit-approval-description">
        <DialogHeader>
          <DialogTitle>Manager Approval Required</DialogTitle>
          <DialogDescription id="reductive-edit-approval-description">
            Review the reduction and enter a manager or admin user ID before the
            credit note is issued.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="hidden" name="reductiveAction" value={action} />
          {hiddenFields.map((field) => (
            <input
              key={`${field.name}:${field.value}`}
              type="hidden"
              name={field.name}
              value={field.value}
            />
          ))}
          <CreditNoteApprovalForm
            approval={approval}
            managerInputId={managerInputId}
            reasonInputId={reasonInputId}
          />
          <InlineErrors state={state} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={cancelReduction}>
              Cancel
            </Button>
            <ConfirmButton pending={pending} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmButton({ pending }: { pending: boolean }) {
  return (
    <Button type="submit" disabled={pending}>
      <ShieldCheck className="h-4 w-4" />
      {pending ? "Confirming..." : "Confirm Reduction"}
    </Button>
  );
}

function InlineErrors({ state }: { state: POSCompositionActionState }) {
  const messages = [
    ...(state.errors?._global ?? []),
    ...(state.errors?.managerApprovedReductionByUserId ?? []),
    ...(state.errors?.managerApprovedReason ?? []),
  ];

  if (messages.length === 0) return null;

  return (
    <div className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
      {messages[0]}
    </div>
  );
}
