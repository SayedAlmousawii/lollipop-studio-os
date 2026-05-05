"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  recordDepositAction,
  type RecordDepositActionState,
} from "@/app/bookings/actions";
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

interface RecordDepositFormProps {
  bookingId: string;
}

export function RecordDepositForm({ bookingId }: RecordDepositFormProps) {
  const [state, formAction] = useActionState<RecordDepositActionState, FormData>(
    recordDepositAction,
    {}
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="bookingId" value={bookingId} />
      {state.errors?._global ? (
        <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.errors._global[0]}
        </p>
      ) : null}
      {state.success ? (
        <p className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">
          {state.success}
        </p>
      ) : null}
      <DepositFields errors={state.errors} />
      <SubmitButton />
    </form>
  );
}

function DepositFields({
  errors,
}: {
  errors?: RecordDepositActionState["errors"];
}) {
  const { pending } = useFormStatus();

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="deposit-amount">Amount</Label>
        <Input
          id="deposit-amount"
          name="amount"
          type="number"
          step="0.001"
          min="0.001"
          defaultValue="20.000"
          required
          disabled={pending}
          aria-invalid={errors?.amount?.length ? true : undefined}
        />
        <FieldError messages={errors?.amount} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="deposit-method">Payment Method</Label>
        <Select name="method" defaultValue="KNET" required disabled={pending}>
          <SelectTrigger
            id="deposit-method"
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
        <Label htmlFor="deposit-reference">Reference</Label>
        <Input
          id="deposit-reference"
          name="reference"
          disabled={pending}
          aria-invalid={errors?.reference?.length ? true : undefined}
        />
        <FieldError messages={errors?.reference} />
      </div>
    </>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Recording..." : "Record Deposit"}
    </Button>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-xs text-danger">{messages[0]}</p>;
}
