"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import {
  updateExtraPhotoPricingAction,
  type ExtraPhotoPricingActionState,
  type ExtraPhotoPricingFormValues,
} from "@/app/pricing/actions";
import { Button } from "@/components/ui/button";
import { DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ExtraPhotoPricingRow } from "@/modules/pricing/pricing.types";

interface ExtraPhotoPricingFormProps {
  row: ExtraPhotoPricingRow;
  onSaved?: () => void;
}

export function ExtraPhotoPricingForm({
  row,
  onSaved,
}: ExtraPhotoPricingFormProps) {
  const action = updateExtraPhotoPricingAction.bind(null, row.sessionTypeId);
  const [state, formAction] = useActionState<
    ExtraPhotoPricingActionState,
    FormData
  >(action, { values: valuesFromRow(row) });

  useEffect(() => {
    if (state.success) {
      onSaved?.();
    }
  }, [onSaved, state.success]);

  return (
    <form action={formAction} className="space-y-5">
      {state.errors?._global ? (
        <p className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
          {state.errors._global[0]}
        </p>
      ) : null}
      {state.success ? (
        <p className="rounded-md bg-success-soft px-4 py-3 text-sm text-success">
          {state.success}
        </p>
      ) : null}

      <ExtraPhotoPricingFields row={row} state={state} />

      <div className="flex items-center justify-end gap-3 pt-2">
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Close
          </Button>
        </DialogClose>
        <SubmitButton />
      </div>
    </form>
  );
}

function ExtraPhotoPricingFields({
  row,
  state,
}: {
  row: ExtraPhotoPricingRow;
  state: ExtraPhotoPricingActionState;
}) {
  const { pending } = useFormStatus();

  return (
    <>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Department</Label>
          <div className="flex h-10 items-center rounded-md border border-border bg-surface-soft px-3 text-sm text-text-secondary">
            {row.departmentName}
          </div>
        </div>
        <div className="space-y-2">
          <Label>Session type</Label>
          <div className="flex h-10 items-center rounded-md border border-border bg-surface-soft px-3 text-sm text-text-secondary">
            {row.sessionTypeName}
          </div>
        </div>
      </div>

      <div className="rounded-md bg-info-soft px-4 py-3 text-sm text-info">
        Changes apply to invoices generated after this point.
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`digital-unit-price-${row.sessionTypeId}`}>
            Digital unit price *
          </Label>
          <Input
            id={`digital-unit-price-${row.sessionTypeId}`}
            name="digitalUnitPrice"
            defaultValue={state.values?.digitalUnitPrice ?? ""}
            disabled={pending}
            aria-invalid={
              state.errors?.digitalUnitPrice?.length ? true : undefined
            }
            inputMode="decimal"
            placeholder="5.000"
            required
          />
          <FieldError messages={state.errors?.digitalUnitPrice} />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`print-unit-price-${row.sessionTypeId}`}>
            Print unit price *
          </Label>
          <Input
            id={`print-unit-price-${row.sessionTypeId}`}
            name="printUnitPrice"
            defaultValue={state.values?.printUnitPrice ?? ""}
            disabled={pending}
            aria-invalid={
              state.errors?.printUnitPrice?.length ? true : undefined
            }
            inputMode="decimal"
            placeholder="7.000"
            required
          />
          <FieldError messages={state.errors?.printUnitPrice} />
        </div>
      </div>
    </>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} className="min-w-[140px]">
      {pending ? "Saving..." : "Save Changes"}
    </Button>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-xs text-danger">{messages[0]}</p>;
}

function valuesFromRow(row: ExtraPhotoPricingRow): ExtraPhotoPricingFormValues {
  return {
    digitalUnitPrice: row.digitalUnitPriceValue.toFixed(3),
    printUnitPrice: row.printUnitPriceValue.toFixed(3),
  };
}
