import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { InvoiceStatusBadge } from "@/components/orders/invoice-status-badge";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getOrderById } from "@/modules/orders/order.service";

export default async function OrderDetailPage(
  props: PageProps<"/orders/[orderId]">
) {
  const { orderId } = await props.params;
  const order = await getOrderById(orderId);
  if (!order) notFound();

  return (
    <PageContainer>
      <div className="space-y-6">
        <Button variant="ghost" asChild className="px-0">
          <Link href="/orders">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to orders
          </Link>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold text-text-primary">
              {order.customerName}
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              Order {order.id}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <OrderStatusBadge status={order.orderStatus} />
            <InvoiceStatusBadge status={order.invoiceStatus} />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href={`/orders/${order.id}/edit`}>Edit Order</Link>
          </Button>
          {order.primaryInvoiceId ? (
            <Button variant="outline" asChild>
              <Link href={`/invoices/${order.primaryInvoiceId}`}>View Invoice</Link>
            </Button>
          ) : (
            <Button variant="outline" disabled>
              Create Invoice
            </Button>
          )}
        </div>

        <Section title="Order Summary">
          <InfoGrid
            items={[
              ["Customer", order.customerName],
              ["Booking date", order.bookingDate],
              ["Session type", order.sessionType],
              ["Original package", order.originalPackageName],
              ["Final package", order.finalPackageName],
              ["Order status", order.orderStatus],
              ["Created date", order.createdAt],
            ]}
          />
        </Section>

        <Section title="Financial Summary">
          <InfoGrid
            items={[
              ["Invoice status", order.invoiceStatus],
              ["Total", order.totalAmount],
              ["Paid", order.paidAmount],
              ["Remaining", order.remainingAmount],
            ]}
          />
        </Section>

        <Section title="Deliverables">
          <InfoGrid
            items={[
              ["Selected photo count", order.selectedPhotoCount],
              ["Included photo count", order.includedPhotoCount],
              ["Extra photos", order.extraPhotoCount],
              ["Albums / prints / add-ons", order.addonsSummary],
            ]}
          />
        </Section>

        <Section title="Workflow Status">
          <InfoGrid
            items={[
              ["Selection status", order.selectionStatus],
              ["Editing status", order.editingStatus],
              ["Production status", order.productionStatus],
              ["Delivery status", order.deliveryStatus],
            ]}
          />
        </Section>

        <Section title="Notes">
          <p className="text-sm text-text-secondary">{order.notes}</p>
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
