import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { InvoiceStatusBadge } from "@/components/invoices/invoice-status-badge";
import { PaymentHistoryTable } from "@/components/invoices/payment-history-table";
import { RecordPaymentForm } from "@/components/invoices/record-payment-form";
import { getCurrentAppUser } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { getInvoiceById } from "@/modules/invoices/invoice.service";
import {
  closeInvoiceAction,
  createAdjustmentInvoiceAction,
  issueCreditNoteAction,
  issueRefundAction,
  issueInvoiceAction,
} from "../actions";

type InvoiceDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function InvoiceDetailPage(props: InvoiceDetailPageProps) {
  const { id } = await props.params;
  const [invoice, appUser] = await Promise.all([
    getInvoiceById(id),
    getCurrentAppUser(),
  ]);
  if (!invoice) notFound();

  const createAdjustment = createAdjustmentInvoiceAction.bind(null, invoice.id);
  const issueCreditNote = issueCreditNoteAction.bind(null, invoice.id);
  const issueRefund = issueRefundAction.bind(null, invoice.id);
  const issue = issueInvoiceAction.bind(null, invoice.id);
  const close = closeInvoiceAction.bind(null, invoice.id);
  const canIssueCreditNote =
    appUser !== null && hasPermission(appUser, PERMISSIONS.CREDIT_NOTE_ISSUE);
  const canCreditNoteInvoice =
    canIssueCreditNote &&
    invoice.isLocked &&
    invoice.invoiceType === "FINAL" &&
    invoice.creditNoteCapacity !== null &&
    moneyInputValue(invoice.creditNoteCapacity) !== "0.000";
  const canIssueRefund =
    appUser !== null && hasPermission(appUser, PERMISSIONS.REFUND_ISSUE);
  const canRefundInvoice =
    canIssueRefund &&
    invoice.isLocked &&
    (invoice.invoiceType === "FINAL" || invoice.invoiceType === "ADJUSTMENT") &&
    invoice.refundableAmount !== null &&
    moneyInputValue(invoice.refundableAmount) !== "0.000";
  const sourcePayments = invoice.payments.filter(
    (payment) => payment.direction === "IN"
  );

  return (
    <PageContainer>
      <div className="space-y-6">
        <Button variant="ghost" asChild className="px-0">
          <Link href="/invoices">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to invoices
          </Link>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold text-text-primary">
              {invoice.invoiceNumber}
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              {invoice.customerPhone} · Job {invoice.jobNumber}
            </p>
          </div>
          <InvoiceStatusBadge status={invoice.status} />
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Metric label="Total" value={invoice.totalAmount} />
          <Metric label="Paid" value={invoice.paidAmount} />
          <Metric label="Remaining" value={invoice.remainingAmount} />
          <Metric
            label={invoice.isOverpaid ? "Overpaid" : "Locked"}
            value={
              invoice.isOverpaid
                ? invoice.overpaidAmount ?? "0.000 KD"
                : invoice.isLocked
                  ? "Yes"
                  : "No"
            }
          />
        </div>

        {invoice.isOverpaid && invoice.overpaidAmount ? (
          <Card>
            <CardContent className="pt-6 text-sm text-text-secondary">
              Credit available: {invoice.overpaidAmount}. Issue a refund when the
              outbound money movement is ready to record.
            </CardContent>
          </Card>
        ) : null}

        {invoice.parentInvoiceId && invoice.parentInvoiceNumber ? (
          <Card>
            <CardContent className="pt-6 text-sm text-text-secondary">
              Adjustment for{" "}
              <Link
                href={`/invoices/${invoice.parentInvoiceId}`}
                className="font-medium text-primary"
              >
                {invoice.parentInvoiceNumber}
              </Link>
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_380px] xl:items-start">
          <div className="space-y-6">
            {invoice.invoiceType === "FINAL" ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Financial Breakdown</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <MoneyRow label="Invoice total" value={invoice.totalAmount} />
                  <MoneyRow label="Direct payments" value={invoice.paidAmount} />
                  {invoice.depositPaidAmount ? (
                    <MoneyRow
                      label={`Deposit credited${invoice.depositInvoiceNumber ? ` (${invoice.depositInvoiceNumber})` : ""}`}
                      value={`-${invoice.depositPaidAmount}`}
                    />
                  ) : null}
                  <div className="border-t border-border pt-2">
                    <MoneyRow
                      label="Remaining balance"
                      value={invoice.remainingAmount}
                      strong
                    />
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {invoice.lineItems.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Invoice Composition</CardTitle>
                  {invoice.lineItemsAreComputed ? (
                    <p className="text-xs uppercase tracking-[0.18em] text-text-muted">
                      Computed current composition
                    </p>
                  ) : null}
                </CardHeader>
                <CardContent className="space-y-2">
                  {invoice.lineItems.map((item) => (
                    <InvoiceLineRow
                      key={item.id}
                      label={item.description}
                      meta={`${item.quantity} × ${item.unitPrice}`}
                      value={item.lineTotal}
                    />
                  ))}
                </CardContent>
              </Card>
            ) : null}

            {canRefundInvoice ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Refund This Invoice</CardTitle>
                </CardHeader>
                <CardContent>
                  <form action={issueRefund} className="space-y-4">
                    <Field
                      label="Refund Amount"
                      name="amount"
                      type="number"
                      step="0.001"
                      min="0.001"
                      max={moneyInputValue(invoice.refundableAmount ?? "0.000 KD")}
                      defaultValue={moneyInputValue(invoice.refundableAmount ?? "0.000 KD")}
                    />
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
                        defaultValue={sourcePayments[0]?.id ?? ""}
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
                    <Field label="Reference" name="reference" required={false} />
                    <Button type="submit" className="w-full">
                      Issue Refund
                    </Button>
                  </form>
                </CardContent>
              </Card>
            ) : null}

            {canCreditNoteInvoice ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Issue Credit Note</CardTitle>
                </CardHeader>
                <CardContent>
                  <form action={issueCreditNote} className="space-y-4">
                    <CreditNoteLineFields
                      index={0}
                      required
                      max={moneyInputValue(invoice.creditNoteCapacity ?? "0.000 KD")}
                    />
                    <CreditNoteLineFields index={1} />
                    <CreditNoteLineFields index={2} />
                    <div className="space-y-2">
                      <Label htmlFor="credit-note-reason">Reason</Label>
                      <Textarea id="credit-note-reason" name="reason" required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="credit-note-notes">Notes</Label>
                      <Textarea id="credit-note-notes" name="notes" />
                    </div>
                    <div className="rounded-md border border-border bg-surface-soft px-3 py-2 text-sm text-text-secondary">
                      Credit capacity: {invoice.creditNoteCapacity}. The final
                      invoice receivable updates after issuance.
                    </div>
                    <Button type="submit" className="w-full">
                      Issue Credit Note
                    </Button>
                  </form>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Payment History</CardTitle>
              </CardHeader>
              <CardContent>
                <PaymentHistoryTable payments={invoice.payments} />
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            {!invoice.isLocked ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Record Payment</CardTitle>
                </CardHeader>
                <CardContent>
                  <RecordPaymentForm
                    invoiceId={invoice.id}
                    defaultPaymentType={
                      invoice.invoiceType === "FINAL" ? "FINAL" : undefined
                    }
                  />
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Create Adjustment</CardTitle>
                </CardHeader>
                <CardContent>
                  <form action={createAdjustment} className="space-y-4">
                    <Field
                      label="Adjustment Total"
                      name="totalAmount"
                      type="number"
                      step="0.001"
                      min="0.001"
                    />
                    <div className="space-y-2">
                      <Label htmlFor="adjustment-notes">Notes</Label>
                      <Textarea id="adjustment-notes" name="notes" />
                    </div>
                    <Button type="submit" className="w-full">
                      Create Adjustment
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Invoice Actions</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                {!invoice.isLocked && invoice.status === "Draft" ? (
                  <form action={issue}>
                    <Button type="submit" variant="outline">
                      Issue Invoice
                    </Button>
                  </form>
                ) : null}
                {!invoice.isLocked ? (
                  <form action={close}>
                    <Button type="submit" variant="outline">
                      Close Invoice
                    </Button>
                  </form>
                ) : (
                  <span className="text-sm text-text-secondary">
                    Closed invoices are locked.
                  </span>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}

function CreditNoteLineFields({
  index,
  required = false,
  max,
}: {
  index: number;
  required?: boolean;
  max?: string;
}) {
  return (
    <div className="grid gap-3 rounded-md border border-border bg-surface-soft p-3 sm:grid-cols-[minmax(0,1fr)_80px_120px]">
      <Field
        label={index === 0 ? "Description" : `Description ${index + 1}`}
        name="creditLineDescription"
        required={required}
      />
      <Field
        label="Qty"
        name="creditLineQuantity"
        type="number"
        min="1"
        step="1"
        defaultValue={required ? "1" : undefined}
        required={required}
      />
      <Field
        label="Unit Price"
        name="creditLineUnitPrice"
        type="number"
        min="0.001"
        max={max}
        step="0.001"
        required={required}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs font-medium uppercase text-text-muted">{label}</p>
        <p className="mt-2 text-lg font-semibold text-text-primary">{value}</p>
      </CardContent>
    </Card>
  );
}

function MoneyRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 ${
        strong ? "font-semibold text-text-primary" : "text-text-secondary"
      }`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function InvoiceLineRow({
  label,
  meta,
  value,
}: {
  label: string;
  meta: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-soft px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">{label}</p>
          <p className="text-xs text-text-secondary">{meta}</p>
        </div>
        <span className="text-sm font-medium tabular-nums text-text-primary">{value}</span>
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  required = true,
  step,
  min,
  max,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  step?: string;
  min?: string;
  max?: string;
  defaultValue?: string;
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
        max={max}
        defaultValue={defaultValue}
      />
    </div>
  );
}

function moneyInputValue(value: string): string {
  const match = value.match(/\d+(?:\.\d+)?/);
  return Number(match?.[0] ?? 0).toFixed(3);
}
