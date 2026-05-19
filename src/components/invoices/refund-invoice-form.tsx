"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatMoneyInputValue } from "@/lib/formatting/money";

type RefundFormAction = (formData: FormData) => void | Promise<void>;

type SourcePayment = {
  id: string;
  publicId: string;
  amount: string;
  method: string;
};

type RefundInvoiceFormProps = {
  action: RefundFormAction;
  overpaymentCapacity: string;
  sourcePayments: SourcePayment[];
};

export function RefundInvoiceForm({
  action,
  overpaymentCapacity,
  sourcePayments,
}: RefundInvoiceFormProps) {
  const capacityValue = formatMoneyInputValue(overpaymentCapacity);
  const [error, setError] = useState<string | null>(null);

  function validateAmountInput(amountInput: HTMLInputElement): string | null {
    const amount = Number(amountInput.value);
    const capacity = Number(capacityValue);
    if (Number.isFinite(amount) && amount > capacity) {
      const message = `Cannot refund more than ${capacityValue} KD (overpayment capacity).`;
      amountInput.setCustomValidity(message);
      setError(message);
      return message;
    }

    amountInput.setCustomValidity("");
    setError(null);
    return null;
  }

  function validateRefundAmount(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const amountInput = form.elements.namedItem("amount");
    if (!(amountInput instanceof HTMLInputElement)) return;

    const message = validateAmountInput(amountInput);
    if (message) {
      event.preventDefault();
      amountInput.reportValidity();
    }
  }

  return (
    <form action={action} onSubmit={validateRefundAmount} className="space-y-4">
      {error ? (
        <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="refund-amount">Refund Amount</Label>
        <Input
          id="refund-amount"
          name="amount"
          type="number"
          required
          step="0.001"
          min="0.001"
          max={capacityValue}
          defaultValue={capacityValue}
          onChange={(event) => {
            validateAmountInput(event.currentTarget);
          }}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="refund-reason">Reason</Label>
        <Textarea id="refund-reason" name="reason" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="refund-of-payment">Original Payment</Label>
        <select
          id="refund-of-payment"
          name="refundOfPaymentId"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-text-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          defaultValue={sourcePayments.length === 1 ? sourcePayments[0].id : ""}
        >
          <option value="">Unattributed</option>
          {sourcePayments.map((payment) => (
            <option key={payment.id} value={payment.id}>
              {payment.publicId} · {payment.amount} · {payment.method}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="refund-method">Payment Method</Label>
        <select
          id="refund-method"
          name="method"
          required
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-text-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          defaultValue="CASH"
        >
          <option value="CASH">CASH</option>
          <option value="KNET">KNET</option>
          <option value="LINK">LINK</option>
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="refund-reference">Reference</Label>
        <Input id="refund-reference" name="reference" />
      </div>
      <Button type="submit" className="w-full">
        Issue Refund
      </Button>
    </form>
  );
}
