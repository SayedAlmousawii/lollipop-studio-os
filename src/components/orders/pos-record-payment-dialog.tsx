"use client";

import { useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Banknote, CreditCard, LinkIcon, ReceiptText } from "lucide-react";
import { toast } from "sonner";
import {
  recordPOSPaymentAction,
  type POSRecordPaymentActionState,
} from "@/app/orders/[orderId]/sales/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
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
import { Textarea } from "@/components/ui/textarea";
import { TimePicker } from "@/components/ui/time-picker";
import { cn } from "@/lib/utils";
import type { POSInvoiceSummary } from "@/modules/orders/order.types";

interface POSRecordPaymentDialogProps {
  orderId: string;
  invoice: POSInvoiceSummary;
  customerName: string;
  jobNumber: string;
  trigger?: ReactNode;
}

const PAYMENT_METHODS = [
  { value: "KNET", label: "KNET", icon: CreditCard },
  { value: "CASH", label: "Cash", icon: Banknote },
  { value: "LINK", label: "Link", icon: LinkIcon },
] as const;
const PAYMENT_HOURS = Array.from({ length: 24 }, (_, index) =>
  String(index).padStart(2, "0")
);
const PAYMENT_MINUTES = Array.from({ length: 60 }, (_, index) =>
  String(index).padStart(2, "0")
);

export function POSRecordPaymentDialog({
  orderId,
  invoice,
  customerName,
  jobNumber,
  trigger,
}: POSRecordPaymentDialogProps) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [state, setState] = useState<POSRecordPaymentActionState>({});
  const router = useRouter();

  async function submitPayment(formData: FormData) {
    setIsSubmitting(true);
    const nextState = await recordPOSPaymentAction(
      orderId,
      invoice.invoiceId,
      state,
      formData
    );
    setState(nextState);
    setIsSubmitting(false);

    if (nextState.success) {
      toast.success(nextState.success);
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isSubmitting && setOpen(nextOpen)}>
      <DialogTrigger asChild>
        {trigger ?? <Button className="w-full">Record Payment</Button>}
      </DialogTrigger>
      <DialogContent
        className="grid max-h-[calc(100svh-2rem)] max-w-2xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0"
        onEscapeKeyDown={(event) => {
          if (isSubmitting) event.preventDefault();
        }}
      >
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle className="flex items-center gap-2">
            <ReceiptText className="h-5 w-5 text-accent" />
            Record Payment
          </DialogTitle>
          <DialogDescription>Record a payment for this invoice</DialogDescription>
        </DialogHeader>
        <PaymentForm
          invoice={invoice}
          customerName={customerName}
          jobNumber={jobNumber}
          state={state}
          formAction={submitPayment}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function PaymentForm({
  invoice,
  customerName,
  jobNumber,
  state,
  formAction,
  onCancel,
}: {
  invoice: POSInvoiceSummary;
  customerName: string;
  jobNumber: string;
  state: POSRecordPaymentActionState;
  formAction: (payload: FormData) => Promise<void>;
  onCancel: () => void;
}) {
  const now = new Date();
  const [amount, setAmount] = useState(invoice.remainingAmount.toFixed(3));
  const [paidDate, setPaidDate] = useState(formatDateInput(now));
  const [paidTime, setPaidTime] = useState(formatTimeInput(now));
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]["value"]>("KNET");
  const amountRef = useRef<HTMLInputElement>(null);

  return (
    <form action={formAction} className="flex min-h-0 flex-col">
      <div className="min-h-0 space-y-4 overflow-y-auto px-6 py-4">
        <InvoiceSummary invoice={invoice} customerName={customerName} jobNumber={jobNumber} />
        {state.errors?._global ? (
          <p
            role="alert"
            className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
          >
            {state.errors._global[0]}
          </p>
        ) : null}
        {invoice.isLocked ? (
          <p
            role="status"
            className="rounded-md border border-info/30 bg-info-soft px-3 py-2 text-sm text-info"
          >
            Invoice is locked. Payments can still be recorded.
          </p>
        ) : null}

        <input type="hidden" name="method" value={method} />
        <input type="hidden" name="paidDate" value={paidDate} />
        <input type="hidden" name="paidTime" value={paidTime} />

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="space-y-2">
            <Label htmlFor="pos-payment-amount">Amount</Label>
            <Input
              ref={amountRef}
              id="pos-payment-amount"
              name="amount"
              type="number"
              step="0.001"
              min="0.001"
              max={invoice.remainingAmount.toFixed(3)}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
              autoFocus
              aria-invalid={state.errors?.amount?.length ? true : undefined}
            />
            <FieldError messages={state.errors?.amount} />
          </div>
          <QuickAmountActions
            remainingAmount={invoice.remainingAmount}
            onFull={() => setAmount(invoice.remainingAmount.toFixed(3))}
            onHalf={() => setAmount((invoice.remainingAmount / 2).toFixed(3))}
            onCustom={() => amountRef.current?.focus()}
          />
        </div>

        <div className="space-y-2">
          <Label>Payment Method</Label>
          <div className="grid gap-2 sm:grid-cols-3">
            {PAYMENT_METHODS.map((option) => {
              const Icon = option.icon;
              const selected = method === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setMethod(option.value)}
                  className={cn(
                    "flex h-14 items-center justify-center gap-2 rounded-md border bg-surface text-sm font-semibold text-text-primary transition",
                    selected
                      ? "border-accent bg-accent-soft text-accent-dark ring-2 ring-accent/30"
                      : "border-border hover:border-accent/60"
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {option.label}
                </button>
              );
            })}
          </div>
          <FieldError messages={state.errors?.method} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pos-payment-date">Payment Date</Label>
            <DatePicker
              value={paidDate}
              onChange={(value) => setPaidDate(value ?? "")}
              placeholder="Select date"
              className="w-full"
            />
            <FieldError messages={state.errors?.paidDate} />
            <FieldError messages={state.errors?.paidAt} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pos-payment-time">Payment Time</Label>
            <TimePicker
              id="pos-payment-time"
              value={paidTime}
              onChange={(value) => setPaidTime(value ?? "")}
              className="w-full"
              hourOptions={PAYMENT_HOURS}
              minuteOptions={PAYMENT_MINUTES}
              hourFormat="12"
            />
            <FieldError messages={state.errors?.paidTime} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pos-payment-reference">Reference Number</Label>
            <Input
              id="pos-payment-reference"
              name="reference"
              aria-invalid={state.errors?.reference?.length ? true : undefined}
            />
            <FieldError messages={state.errors?.reference} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pos-payment-notes">Notes</Label>
            <Textarea
              id="pos-payment-notes"
              name="notes"
              rows={2}
              aria-invalid={state.errors?.notes?.length ? true : undefined}
            />
            <FieldError messages={state.errors?.notes} />
          </div>
        </div>
      </div>

      <DialogFooter className="border-t border-border px-6 py-4">
        <CancelButton onCancel={onCancel} />
        <SubmitButton />
      </DialogFooter>
    </form>
  );
}

function InvoiceSummary({
  invoice,
  customerName,
  jobNumber,
}: {
  invoice: POSInvoiceSummary;
  customerName: string;
  jobNumber: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-soft p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text-primary">
            Invoice #{invoice.invoiceNumber}
          </p>
          <p className="mt-1 text-xs text-text-secondary">
            {customerName} · Job {jobNumber}
          </p>
        </div>
        <Badge variant="secondary" className="rounded-md">
          {invoice.invoiceStatus}
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <SummaryAmount label="Total" value={formatKD(invoice.invoiceTotal)} />
        <SummaryAmount label="Paid" value={formatKD(invoice.paidAmount)} />
        <SummaryAmount label="Remaining" value={formatKD(invoice.remainingAmount)} strong />
      </div>
    </div>
  );
}

function SummaryAmount({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div>
      <p className="text-xs uppercase text-text-muted">{label}</p>
      <p className={cn("mt-1 tabular-nums", strong ? "text-lg font-semibold" : "text-sm")}>
        {value}
      </p>
    </div>
  );
}

function QuickAmountActions({
  remainingAmount,
  onFull,
  onHalf,
  onCustom,
}: {
  remainingAmount: number;
  onFull: () => void;
  onHalf: () => void;
  onCustom: () => void;
}) {
  return (
    <div className="grid w-full grid-cols-3 gap-2 self-end md:w-[220px]">
      <Button type="button" variant="outline" size="sm" onClick={onFull}>
        Full
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={onHalf}>
        Half
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onCustom}
        disabled={remainingAmount <= 0}
      >
        Custom
      </Button>
    </div>
  );
}

function CancelButton({ onCancel }: { onCancel: () => void }) {
  const { pending } = useFormStatus();
  return (
    <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
      Cancel
    </Button>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Recording..." : "Record Payment"}
    </Button>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-xs text-danger">{messages[0]}</p>;
}

function formatKD(value: number): string {
  return `${value.toFixed(3)} KD`;
}

function formatDateInput(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTimeInput(value: Date): string {
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}
