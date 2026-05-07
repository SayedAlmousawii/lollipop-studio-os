import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Baby,
  CalendarPlus,
  CalendarRange,
  ClipboardList,
  History,
  Pencil,
  Phone,
  UserRound,
} from "lucide-react";
import { BookingStatusBadge } from "@/components/bookings/booking-status-badge";
import { CustomerStatusBadge } from "@/components/customers/customer-status-badge";
import { PageContainer } from "@/components/layout/page-container";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getCustomerById } from "@/modules/customers/customer.service";
import type {
  CustomerProfile,
  CustomerProfileBooking,
  CustomerProfileOrder,
} from "@/modules/customers/customer.types";

interface CustomerProfilePageProps {
  params: Promise<{ customerId: string }>;
}

export default async function CustomerProfilePage(
  props: CustomerProfilePageProps
) {
  const { customerId } = await props.params;
  const customer = await getCustomerById(customerId);

  if (!customer) {
    notFound();
  }

  return (
    <PageContainer>
      <div className="space-y-6">
        <Button variant="ghost" asChild className="px-0">
          <Link href="/customers">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to customers
          </Link>
        </Button>

        <header className="rounded-lg border border-border bg-surface p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <CustomerStatusBadge status={customer.status} />
                <span className="text-xs text-text-muted">
                  Customer since {customer.createdAt}
                </span>
              </div>
              <div>
                <h1 className="text-[28px] font-semibold text-text-primary">
                  {customer.fullName}
                </h1>
                <p className="mt-1 flex items-center gap-2 text-sm text-text-secondary">
                  <Phone className="h-4 w-4" />
                  {customer.phone}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href={`/customers/${customer.id}/edit`}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit Customer
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={`/bookings/new?customerId=${customer.id}`}>
                  <CalendarPlus className="mr-2 h-4 w-4" />
                  New Booking
                </Link>
              </Button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <HeaderMetric
              label="Children"
              value={customer.childrenCount.toString()}
              detail="Linked child profiles"
            />
            <HeaderMetric
              label="Bookings"
              value={customer.bookingsCount.toString()}
              detail="Studio sessions"
            />
            <HeaderMetric
              label="Orders"
              value={customer.ordersCount.toString()}
              detail="Production records"
            />
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <ContactAndNotes customer={customer} />
            <ChildrenPreview customer={customer} />
            <BookingsPreview bookings={customer.bookings} />
            <OrdersPreview orders={customer.orders} />
          </div>

          <div className="space-y-6">
            <NextActions customerId={customer.id} />
            <RecentHistory customer={customer} />
          </div>
        </div>
      </div>
    </PageContainer>
  );
}

function HeaderMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-soft px-4 py-3">
      <p className="text-xs font-medium uppercase text-text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold text-text-primary">{value}</p>
      <p className="mt-1 text-xs text-text-secondary">{detail}</p>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        {icon}
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ContactAndNotes({ customer }: { customer: CustomerProfile }) {
  return (
    <Section title="Profile Summary" icon={<UserRound className="h-4 w-4" />}>
      <div className="grid gap-4 md:grid-cols-2">
        <InfoItem label="Full name" value={customer.fullName} />
        <InfoItem label="Phone" value={customer.phone} />
        <InfoItem label="Status" value={customer.status} />
        <InfoItem label="Last updated" value={customer.updatedAt} />
      </div>
      <div className="mt-5 border-t border-border pt-4">
        <p className="text-xs font-medium uppercase text-text-muted">
          Internal notes
        </p>
        <p className="mt-2 text-sm text-text-secondary">
          {customer.notes || "No customer notes added yet."}
        </p>
      </div>
    </Section>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase text-text-muted">{label}</p>
      <p className="text-sm font-medium text-text-primary">{value}</p>
    </div>
  );
}

function ChildrenPreview({ customer }: { customer: CustomerProfile }) {
  return (
    <Section title="Children" icon={<Baby className="h-4 w-4" />}>
      {customer.children.length > 0 ? (
        <div className="divide-y divide-border rounded-md border border-border">
          {customer.children.map((child) => (
            <div
              key={child.id}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <p className="text-sm font-medium text-text-primary">
                {child.name}
              </p>
              <p className="text-sm text-text-secondary">
                DOB {child.dateOfBirth}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="No children linked yet." />
      )}
      {customer.childrenCount > customer.children.length ? (
        <p className="mt-3 text-xs text-text-muted">
          Showing {customer.children.length} of {customer.childrenCount} linked
          children.
        </p>
      ) : null}
    </Section>
  );
}

function BookingsPreview({
  bookings,
}: {
  bookings: CustomerProfileBooking[];
}) {
  return (
    <Section title="Bookings" icon={<CalendarRange className="h-4 w-4" />}>
      {bookings.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow className="border-border bg-surface-soft">
                <TableHead className="text-text-secondary">Booking</TableHead>
                <TableHead className="text-text-secondary">Session</TableHead>
                <TableHead className="text-text-secondary">Package</TableHead>
                <TableHead className="text-text-secondary">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((booking) => (
                <TableRow key={booking.id} className="border-border">
                  <TableCell>
                    <Link
                      href={`/bookings/${booking.id}`}
                      className="font-medium text-text-primary hover:text-accent-dark"
                    >
                      {booking.publicId}
                    </Link>
                    <p className="text-xs text-text-muted">
                      Job {booking.jobNumber}
                    </p>
                  </TableCell>
                  <TableCell className="text-sm text-text-secondary">
                    {booking.sessionDate}
                    <p className="text-xs text-text-muted">
                      {booking.sessionType} · {booking.department}
                    </p>
                  </TableCell>
                  <TableCell className="text-sm text-text-secondary">
                    {booking.packageName}
                  </TableCell>
                  <TableCell>
                    <BookingStatusBadge status={booking.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState text="No bookings linked yet." />
      )}
    </Section>
  );
}

function OrdersPreview({ orders }: { orders: CustomerProfileOrder[] }) {
  return (
    <Section title="Orders" icon={<ClipboardList className="h-4 w-4" />}>
      {orders.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow className="border-border bg-surface-soft">
                <TableHead className="text-text-secondary">Order</TableHead>
                <TableHead className="text-text-secondary">Booking Date</TableHead>
                <TableHead className="text-text-secondary">Package</TableHead>
                <TableHead className="text-text-secondary">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id} className="border-border">
                  <TableCell>
                    <Link
                      href={`/orders/${order.id}`}
                      className="font-medium text-text-primary hover:text-accent-dark"
                    >
                      {order.publicId}
                    </Link>
                    <p className="text-xs text-text-muted">
                      Job {order.jobNumber}
                    </p>
                  </TableCell>
                  <TableCell className="text-sm text-text-secondary">
                    {order.bookingDate}
                  </TableCell>
                  <TableCell className="text-sm text-text-secondary">
                    {order.packageName}
                  </TableCell>
                  <TableCell>
                    <OrderStatusBadge status={order.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState text="No orders linked yet." />
      )}
    </Section>
  );
}

function NextActions({ customerId }: { customerId: string }) {
  return (
    <Section title="Next Actions" icon={<CalendarPlus className="h-4 w-4" />}>
      <div className="space-y-3">
        <Button className="w-full justify-start" asChild>
          <Link href={`/bookings/new?customerId=${customerId}`}>
            <CalendarPlus className="mr-2 h-4 w-4" />
            New Booking
          </Link>
        </Button>
        <Button variant="outline" className="w-full justify-start" asChild>
          <Link href={`/customers/${customerId}/edit`}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit Customer
          </Link>
        </Button>
      </div>
    </Section>
  );
}

function RecentHistory({ customer }: { customer: CustomerProfile }) {
  return (
    <Section title="Recent History" icon={<History className="h-4 w-4" />}>
      {customer.recentHistory.length > 0 ? (
        <div className="space-y-3">
          {customer.recentHistory.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="block rounded-md border border-border px-4 py-3 transition-colors hover:bg-surface-soft"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    {item.label}
                  </p>
                  <p className="mt-1 text-xs text-text-secondary">
                    {item.detail}
                  </p>
                </div>
                <p className="shrink-0 text-xs text-text-muted">{item.date}</p>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState text="No recent bookings or orders yet." />
      )}
    </Section>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-surface-soft px-4 py-6 text-center text-sm text-text-secondary">
      {text}
    </div>
  );
}
