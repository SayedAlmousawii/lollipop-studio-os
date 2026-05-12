"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { recordPaymentAction, type RecordPaymentActionState } from "@/app/invoices/actions";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
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

interface RecordPaymentFormProps {
  invoiceId: string;
  defaultPaymentType?: string;
}

export function RecordPaymentForm({
  invoiceId,
  defaultPaymentType = "DEPOSIT",
}: RecordPaymentFormProps) {
  const [state, formAction] = useActionState<RecordPaymentActionState, FormData>(
    recordPaymentAction.bind(null, invoiceId),
    {}
  );

  return (
    <form action={formAction} className="space-y-4">
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
      <PaymentFields
        errors={state.errors}
        defaultPaymentType={defaultPaymentType}
      />
      <SubmitButton />
    </form>
  );
}

function PaymentFields({
  errors,
  defaultPaymentType,
}: {
  errors?: RecordPaymentActionState["errors"];
  defaultPaymentType: string;
}) {
  const { pending } = useFormStatus();
  const [paidAt, setPaidAt] = useState("");

  return (
    <>
      <Field
        label="Amount"
        name="amount"
        type="number"
        step="0.001"
        min="0.001"
        disabled={pending}
        error={errors?.amount}
      />
      <SelectField
        label="Method"
        name="method"
        options={["CASH", "KNET", "LINK"]}
        disabled={pending}
        error={errors?.method}
      />
      <SelectField
        label="Payment Type"
        name="paymentType"
        options={["DEPOSIT", "FINAL", "UPGRADE", "ADDON", "OTHER"]}
        defaultValue={defaultPaymentType}
        disabled={pending}
        error={errors?.paymentType}
      />
      <DateField
        label="Paid At"
        name="paidAt"
        value={paidAt}
        onChange={setPaidAt}
        disabled={pending}
        error={errors?.paidAt}
      />
      <Field
        label="Reference"
        name="reference"
        required={false}
        disabled={pending}
        error={errors?.reference}
      />
      <div className="space-y-2">
        <Label htmlFor="payment-notes">Notes</Label>
        <Textarea id="payment-notes" name="notes" disabled={pending} />
        <FieldError messages={errors?.notes} />
      </div>
    </>
  );
}

function DateField({
  label,
  name,
  value,
  onChange,
  disabled,
  error,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string[];
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <input type="hidden" name={name} value={value} />
      <DatePicker
        value={value}
        onChange={(nextValue) => onChange(nextValue ?? "")}
        placeholder="Select date"
        className={`w-full ${disabled ? "pointer-events-none opacity-50" : ""}`}
      />
      <FieldError messages={error} />
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Submitting..." : "Record Payment"}
    </Button>
  );
}

function Field({
  label,
  name,
  type = "text",
  required = true,
  step,
  min,
  disabled,
  error,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  step?: string;
  min?: string;
  disabled?: boolean;
  error?: string[];
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        required={required}
        step={step}
        min={min}
        disabled={disabled}
        aria-invalid={error?.length ? true : undefined}
      />
      <FieldError messages={error} />
    </div>
  );
}

function SelectField({
  label,
  name,
  options,
  defaultValue,
  disabled,
  error,
}: {
  label: string;
  name: string;
  options: string[];
  defaultValue?: string;
  disabled?: boolean;
  error?: string[];
}) {
  const fallbackValue = options.includes(defaultValue ?? "")
    ? defaultValue
    : options[0];

  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Select name={name} required disabled={disabled} defaultValue={fallbackValue}>
        <SelectTrigger id={name} aria-invalid={error?.length ? true : undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError messages={error} />
    </div>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-xs text-danger">{messages[0]}</p>;
}
