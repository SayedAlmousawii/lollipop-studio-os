import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { BookingStatusBadge } from "@/components/bookings/booking-status-badge";
import { PaymentStatusBadge } from "@/components/bookings/payment-status-badge";
import { RecordDepositDialog } from "@/components/bookings/record-deposit-dialog";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getBookingById } from "@/modules/bookings/booking.service";

export default async function BookingDetailPage(
  props: PageProps<"/bookings/[bookingId]">
) {
  const { bookingId } = await props.params;
  const booking = await getBookingById(bookingId);

  if (!booking) notFound();

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
              {booking.customerName}
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              Booking {booking.publicId} · Job {booking.jobNumber}
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
        </div>

        <Section title="Booking Summary">
          <InfoGrid
            items={[
              ["Customer", booking.customerName],
              ["Booking ID", booking.publicId],
              ["Job number", booking.jobNumber],
              ["Session date", booking.sessionDate],
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
              ["Deposit status", booking.depositStatus],
            ]}
          />
        </Section>

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
