import type { InvoiceStatus } from "@prisma/client";
import type { ReactNode } from "react";
import { LockKeyhole } from "lucide-react";
import { formatMoney } from "@/lib/formatting/money";
import { FINANCIAL_CASE_PAYMENT_STATUS_LABELS } from "@/modules/financial-cases/financial-case-summary.constants";
import type { FinancialCasePaymentStatus } from "@/modules/financial-cases/financial-case-summary.types";
import type { BookingPageFinancialProjection } from "@/modules/financial-cases/projections/to-booking-page-financial";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PaymentStatusBadge,
  type PaymentStatus,
} from "@/components/bookings/payment-status-badge";

interface BookingFinancialSectionProps {
  bookingReference: string;
  financial: BookingPageFinancialProjection | null;
}

const financialStatusStyles: Record<FinancialCasePaymentStatus, string> = {
  UNPAID: "bg-danger-soft text-danger",
  PARTIAL: "bg-warning-soft text-warning",
  PAID: "bg-success-soft text-success",
  OVERPAID: "bg-warning-soft text-warning",
  REFUNDED: "bg-info-soft text-info",
};

export function BookingFinancialSection({
  bookingReference,
  financial,
}: BookingFinancialSectionProps) {
  if (!financial) return null;

  if (financial.stage === "booking") {
    const depositInvoice = financial.depositInvoice;
    if (!depositInvoice) return null;

    const statusLabel = getDepositInvoiceStatusLabel(depositInvoice.status);
    const items: Array<[string, string]> = [
      ["Invoice number", depositInvoice.invoiceNumber],
      ["BK reference", bookingReference],
      ["Deposit amount", formatMoney(depositInvoice.total)],
      ["Deposit paid", financial.depositPaid ? "Yes" : "No"],
      ["Locked", depositInvoice.isLocked ? "Yes" : "No"],
      [
        "Final invoice",
        financial.finalInvoicePending ? "Pending after check-in" : "Ready",
      ],
    ];

    if (financial.awaitingFinalInvoiceAfterCheckIn) {
      items.push(["Next step", "Awaiting final invoice after check-in"]);
    }

    return (
      <FinancialCard
        title="Financial Summary"
        heading={depositInvoice.invoiceNumber}
        description={
          depositInvoice.isLocked
            ? `Deposit invoice is ${statusLabel.toLowerCase()} and locked.`
            : `Deposit invoice is ${statusLabel.toLowerCase()}.`
        }
        badges={
          <>
            <PaymentStatusBadge status={statusLabel} />
            {depositInvoice.isLocked ? <LockedBadge /> : null}
          </>
        }
        items={items}
      />
    );
  }

  const depositInvoice = financial.depositInvoice;
  const depositStatusLabel = depositInvoice
    ? getDepositInvoiceStatusLabel(depositInvoice.status)
    : null;
  const paymentStatusLabel =
    FINANCIAL_CASE_PAYMENT_STATUS_LABELS[financial.paymentStatusEnum];
  const items: Array<[string, string]> = [
    ["BK reference", bookingReference],
    ["Deposit invoice", depositInvoice?.invoiceNumber ?? "—"],
    ["Deposit amount", depositInvoice ? formatMoney(depositInvoice.total) : "—"],
    ["Deposit status", depositStatusLabel ?? "—"],
    ["Final invoice", financial.finalInvoice.invoiceNumber],
    ["Final invoice total", formatMoney(financial.finalInvoice.total)],
    ["Remaining", formatMoney(financial.remaining)],
    ["Payment status", paymentStatusLabel],
    ["Final locked", financial.finalInvoice.isLocked ? "Yes" : "No"],
  ];

  return (
    <FinancialCard
      title="Financial Summary"
      heading={financial.finalInvoice.invoiceNumber}
      description={`Final invoice is ${paymentStatusLabel.toLowerCase()}.`}
      badges={
        <>
          <FinancialStatusBadge status={financial.paymentStatusEnum} />
          {financial.finalInvoice.isLocked ? <LockedBadge /> : null}
        </>
      }
      items={items}
    />
  );
}

function FinancialCard({
  title,
  heading,
  description,
  badges,
  items,
}: {
  title: string;
  heading: string;
  description: string;
  badges: ReactNode;
  items: Array<[string, string]>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-text-primary">{heading}</p>
              <p className="text-sm text-text-secondary">{description}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">{badges}</div>
          </div>
          <InfoGrid items={items} />
        </div>
      </CardContent>
    </Card>
  );
}

function LockedBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success">
      <LockKeyhole className="h-3.5 w-3.5" />
      Locked
    </span>
  );
}

function FinancialStatusBadge({
  status,
}: {
  status: FinancialCasePaymentStatus;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${financialStatusStyles[status]}`}
    >
      {FINANCIAL_CASE_PAYMENT_STATUS_LABELS[status]}
    </span>
  );
}

function InfoGrid({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label} className="space-y-1">
          <p className="text-xs font-medium uppercase text-text-muted">
            {label}
          </p>
          <p className="text-sm font-medium text-text-primary">{value}</p>
        </div>
      ))}
    </div>
  );
}

function getDepositInvoiceStatusLabel(status: InvoiceStatus): PaymentStatus {
  switch (status) {
    case "PAID":
    case "CLOSED":
      return "Paid";
    case "PARTIAL":
      return "Partial";
    case "ISSUED":
    case "DRAFT":
      return "Unpaid";
    default:
      return "Unpaid";
  }
}
