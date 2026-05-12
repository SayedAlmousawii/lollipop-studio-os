import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingStatus } from "@prisma/client";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import { BookingStatusBadge } from "@/components/bookings/booking-status-badge";
import { CheckInButton } from "@/components/bookings/check-in-button";
import { DeletePendingBookingButton } from "@/components/bookings/delete-pending-booking-button";
import { PaymentStatusBadge } from "@/components/bookings/payment-status-badge";
import { RecordDepositDialog } from "@/components/bookings/record-deposit-dialog";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getBookingById,
  type BookingDetail,
} from "@/modules/bookings/booking.service";

export default async function BookingDetailPage(
  props: PageProps<"/bookings/[bookingId]">
) {
  const { bookingId } = await props.params;
  const booking = await getBookingById(bookingId);

  if (!booking) notFound();

  const referenceLine = booking.jobNumber
    ? `Booking ${booking.bookingReference} · Job ${booking.jobNumber}`
    : `Booking ${booking.bookingReference}`;
  const summaryItems: Array<[string, string]> = [
    ["BK reference", booking.bookingReference],
  ];
  if (booking.jobNumber) {
    summaryItems.push(["JOB reference", booking.jobNumber]);
  }
  summaryItems.push(
    ["Customer phone", booking.customerPhone],
    ["Session date", booking.sessionDate],
    ["Session time", booking.sessionTime],
    ["Session type", booking.sessionType],
    [
      "Package",
      `${booking.packageName}${
        booking.packagePriceLabel !== "—"
          ? ` · ${booking.packagePriceLabel}`
          : ""
      }`,
    ],
    ["Department", booking.department],
    ["Assigned photographer", booking.assignedPhotographerName],
    ["Booking status", booking.bookingStatus],
    ["Deposit status", booking.depositStatus]
  );

  return (
    <PageContainer>
      <div className="space-y-6">
        <Button variant="ghost" asChild className="px-0">
          <Link href="/bookings">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to bookings
          </Link>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold text-text-primary">
              {booking.customerPhone}
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              {referenceLine}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <BookingStatusBadge status={booking.bookingStatus} />
            <PaymentStatusBadge status={booking.depositStatus} />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {booking.canEdit ? (
            <Button asChild>
              <Link href={`/bookings/${booking.id}/edit`}>Edit Booking</Link>
            </Button>
          ) : (
            <Button disabled>Edit Booking</Button>
          )}
          {booking.canRecordDeposit ? (
            <RecordDepositDialog
              bookingId={booking.id}
              trigger={<Button variant="outline">Record Deposit</Button>}
            />
          ) : null}
          {booking.canCheckIn ? <CheckInButton bookingId={booking.id} /> : null}
          {booking.isCheckedIn ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success">
                Checked In
              </span>
              {booking.orderId ? (
                <Button variant="outline" asChild>
                  <Link href={`/orders/${booking.orderId}`}>View Order</Link>
                </Button>
              ) : null}
            </div>
          ) : null}
          {booking.canDeletePending ? (
            <DeletePendingBookingButton bookingId={booking.id} />
          ) : null}
        </div>

        <Section title="Booking Summary">
          <InfoGrid items={summaryItems} />
        </Section>

        {booking.depositInvoice ? (
          <DepositInvoiceSection booking={booking} />
        ) : null}

        <Section title="Notes">
          <p className="text-sm text-text-secondary">
            {booking.notes || "No notes added."}
          </p>
        </Section>

        <Section title="Themes">
          {booking.themes.length > 0 ? (
            <div className="space-y-3">
              {booking.themes.map((theme) => (
                <div key={theme.id} className="space-y-1">
                  <p className="text-sm font-medium text-text-primary">
                    {theme.themeName}
                  </p>
                  <p className="text-sm text-text-secondary">
                    {theme.notes || "No theme notes."}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-secondary">No themes added.</p>
          )}
        </Section>
      </div>
    </PageContainer>
  );
}

function DepositInvoiceSection({ booking }: { booking: BookingDetail }) {
  const depositInvoice = booking.depositInvoice;
  if (!depositInvoice) return null;

  const remainingBalanceLabel = booking.packageRemainingBalanceLabel;
  const statusLabel = getDepositInvoiceStatusLabel(depositInvoice.status);
  const showPackageContext =
    booking.status === BookingStatus.CONFIRMED &&
    booking.packageName !== "—" &&
    booking.packagePriceLabel !== "—" &&
    remainingBalanceLabel !== null;

  const items: Array<[string, string]> = [
    ["Invoice number", depositInvoice.invoiceNumber],
    ["BK reference", booking.bookingReference],
    ["Deposit amount", `${depositInvoice.totalAmount} - ${statusLabel}`],
  ];

  if (showPackageContext) {
    items.push(
      ["Package", booking.packageName],
      ["Package full price", booking.packagePriceLabel],
      ["Remaining at session", remainingBalanceLabel]
    );
  }

  items.push(["Locked", depositInvoice.isLocked ? "Yes" : "No"]);

  return (
    <Section title="Deposit Invoice">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-text-primary">
              {depositInvoice.invoiceNumber}
            </p>
            <p className="text-sm text-text-secondary">
              {depositInvoice.isLocked
                ? `Deposit invoice is ${statusLabel.toLowerCase()} and locked.`
                : `Deposit invoice is ${statusLabel.toLowerCase()}.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PaymentStatusBadge status={statusLabel} />
            {depositInvoice.isLocked ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success">
                <LockKeyhole className="h-3.5 w-3.5" />
                Locked
              </span>
            ) : null}
          </div>
        </div>
        <InfoGrid items={items} />
      </div>
    </Section>
  );
}

function getDepositInvoiceStatusLabel(
  status: NonNullable<BookingDetail["depositInvoice"]>["status"]
): "Paid" | "Partial" | "Unpaid" {
  switch (status) {
    case "PAID":
    case "CLOSED":
      return "Paid";
    case "PARTIAL":
      return "Partial";
    case "ISSUED":
      return "Unpaid";
    case "DRAFT":
      return "Unpaid";
    default:
      return "Unpaid";
  }
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
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
