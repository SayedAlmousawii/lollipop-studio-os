"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  recordUpgradePaymentAction,
  type RecordUpgradePaymentActionState,
} from "@/app/orders/[orderId]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface RecordUpgradePaymentFormProps {
  orderId: string;
  invoiceId: string;
  defaultAmount: number;
}

export function RecordUpgradePaymentForm({
  orderId,
  invoiceId,
  defaultAmount,
}: RecordUpgradePaymentFormProps) {
  const action = recordUpgradePaymentAction.bind(null, orderId, invoiceId);
  const [state, formAction] = useActionState<RecordUpgradePaymentActionState, FormData>(
    action,
    {}
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.errors?._global ? (
        <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.errors._global[0]}
        </p>
      ) : null}
      <UpgradePaymentFields errors={state.errors} defaultAmount={defaultAmount} />
      <SubmitButton />
    </form>
  );
}

function UpgradePaymentFields({
  errors,
  defaultAmount,
}: {
  errors?: RecordUpgradePaymentActionState["errors"];
  defaultAmount: number;
}) {
  const { pending } = useFormStatus();

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="upgrade-payment-amount">Amount</Label>
        <Input
          id="upgrade-payment-amount"
          name="amount"
          type="number"
          step="0.001"
          min="0.001"
          defaultValue={defaultAmount.toFixed(3)}
          required
          readOnly
          disabled={pending}
          aria-readonly="true"
          aria-invalid={errors?.amount?.length ? true : undefined}
          className={cn(
            "bg-surface-soft text-text-secondary",
            pending && "bg-background"
          )}
        />
        <p className="text-xs text-text-muted">Amount is auto-calculated from the balance due.</p>
        <FieldError messages={errors?.amount} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="upgrade-payment-method">Payment Method</Label>
        <Select name="method" defaultValue="KNET" required disabled={pending}>
          <SelectTrigger
            id="upgrade-payment-method"
            aria-invalid={errors?.method?.length ? true : undefined}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CASH">Cash</SelectItem>
            <SelectItem value="KNET">KNET</SelectItem>
            <SelectItem value="LINK">Link</SelectItem>
          </SelectContent>
        </Select>
        <FieldError messages={errors?.method} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="upgrade-payment-reference">Reference</Label>
        <Input
          id="upgrade-payment-reference"
          name="reference"
          disabled={pending}
          aria-invalid={errors?.reference?.length ? true : undefined}
        />
        <FieldError messages={errors?.reference} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="upgrade-payment-notes">Notes</Label>
        <Textarea
          id="upgrade-payment-notes"
          name="notes"
          disabled={pending}
          aria-invalid={errors?.notes?.length ? true : undefined}
        />
        <FieldError messages={errors?.notes} />
      </div>
    </>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Recording..." : "Record Upgrade Payment"}
    </Button>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-xs text-danger">{messages[0]}</p>;
}
