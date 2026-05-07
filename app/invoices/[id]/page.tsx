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
import { getInvoiceById } from "@/modules/invoices/invoice.service";
import {
  closeInvoiceAction,
  createAdjustmentInvoiceAction,
  issueInvoiceAction,
} from "../actions";

type InvoiceDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function InvoiceDetailPage(props: InvoiceDetailPageProps) {
  const { id } = await props.params;
  const invoice = await getInvoiceById(id);
  if (!invoice) notFound();

  const createAdjustment = createAdjustmentInvoiceAction.bind(null, invoice.id);
  const issue = issueInvoiceAction.bind(null, invoice.id);
  const close = closeInvoiceAction.bind(null, invoice.id);

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
              {invoice.customerName} · Job {invoice.jobNumber}
            </p>
          </div>
          <InvoiceStatusBadge status={invoice.status} />
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Metric label="Total" value={invoice.totalAmount} />
          <Metric label="Paid" value={invoice.paidAmount} />
          <Metric label="Remaining" value={invoice.remainingAmount} />
          <Metric label="Locked" value={invoice.isLocked ? "Yes" : "No"} />
        </div>

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

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payment History</CardTitle>
            </CardHeader>
            <CardContent>
              <PaymentHistoryTable payments={invoice.payments} />
            </CardContent>
          </Card>

          <div className="space-y-6">
            {!invoice.isLocked ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Record Payment</CardTitle>
                </CardHeader>
                <CardContent>
                  <RecordPaymentForm invoiceId={invoice.id} />
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

function Field({
  label,
  name,
  type = "text",
  required = true,
  step,
  min,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  step?: string;
  min?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} required={required} step={step} min={min} />
    </div>
  );
}
