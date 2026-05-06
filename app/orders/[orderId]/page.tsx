import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  ExternalLink,
  PackageCheck,
  Pencil,
  Truck,
} from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { InvoiceStatusBadge } from "@/components/orders/invoice-status-badge";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { SelectionWorkflowForm } from "@/components/orders/selection-workflow-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  getOrderHubById,
  getOrderSelectionWorkflowById,
} from "@/modules/orders/order.service";
import type {
  OrderActivityPreviewItem,
  OrderDetail,
  OrderSelectionWorkflow,
  OrderWorkflowStep,
} from "@/modules/orders/order.types";
import { createOrderInvoiceAction } from "./actions";

const TAB_ITEMS = [
  ["overview", "Overview"],
  ["selection", "Selection"],
  ["editing", "Editing"],
  ["production", "Production"],
  ["delivery", "Delivery"],
  ["financials", "Financials"],
  ["activity", "Activity"],
] as const;

export default async function OrderDetailPage(
  props: PageProps<"/orders/[orderId]">
) {
  const { orderId } = await props.params;
  const [order, selection] = await Promise.all([
    getOrderHubById(orderId),
    getOrderSelectionWorkflowById(orderId),
  ]);
  if (!order) notFound();
  if (!selection) notFound();

  return (
    <PageContainer>
      <div className="space-y-5">
        <Button variant="ghost" asChild className="px-0">
          <Link href="/orders">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to orders
          </Link>
        </Button>

        <header className="rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium uppercase text-text-muted">
                  {order.publicId}
                </span>
                <span className="text-xs text-text-muted">Job {order.jobNumber}</span>
              </div>
              <div>
                <h1 className="text-[28px] font-semibold text-text-primary">
                  {order.customerName}
                </h1>
                <p className="mt-1 text-sm text-text-secondary">
                  {order.sessionDateTime} · {order.sessionType} · {order.finalPackageName}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <OrderStatusBadge status={order.orderStatus} />
              <InvoiceStatusBadge status={order.invoiceStatus} />
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <HeaderMetric
              label="Package"
              value={order.finalPackageName}
              detail={`Original: ${order.originalPackageName}`}
            />
            <HeaderMetric
              label="Financials"
              value={order.remainingAmount}
              detail={`Paid ${order.paidAmount} of ${order.totalAmount}`}
            />
            <HeaderMetric
              label="Next action"
              value={order.nextAction}
              detail={order.paymentStatus}
            />
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <Button asChild>
              <Link href={`/orders/${order.id}/edit`}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit Order
              </Link>
            </Button>
            {order.primaryInvoiceId ? (
              <Button variant="outline" asChild>
                <Link href={`/invoices/${order.primaryInvoiceId}`}>
                  <CreditCard className="mr-2 h-4 w-4" />
                  View Invoice
                </Link>
              </Button>
            ) : (
              <form action={createOrderInvoiceAction.bind(null, order.id)}>
                <Button type="submit" variant="outline">
                  <CreditCard className="mr-2 h-4 w-4" />
                  Create Invoice
                </Button>
              </form>
            )}
          </div>
        </header>

        <WorkflowStrip steps={order.workflowSteps} />

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="h-auto flex-wrap justify-start gap-1 bg-surface-soft">
            {TAB_ITEMS.map(([value, label]) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <OverviewTab order={order} />
          </TabsContent>
          <TabsContent value="selection" className="space-y-4">
            <SelectionTab selection={selection} />
          </TabsContent>
          <TabsContent value="editing" className="space-y-4">
            <WorkflowAreaTab
              icon={<Pencil className="h-4 w-4" />}
              title="Editing"
              status={order.editingStatus}
              items={[
                ["Current package", order.finalPackageName],
                ["Selected photos", order.selectedPhotoCount],
                ["Notes", order.notes],
              ]}
            />
          </TabsContent>
          <TabsContent value="production" className="space-y-4">
            <WorkflowAreaTab
              icon={<PackageCheck className="h-4 w-4" />}
              title="Production"
              status={order.productionStatus}
              items={[
                ["Deliverables", order.addonsSummary],
                ["Included photos", order.includedPhotoCount],
                ["Extra photos", order.extraPhotoCount],
              ]}
            />
          </TabsContent>
          <TabsContent value="delivery" className="space-y-4">
            <WorkflowAreaTab
              icon={<Truck className="h-4 w-4" />}
              title="Delivery"
              status={order.deliveryStatus}
              items={[
                ["Customer", order.customerName],
                ["Order status", order.orderStatus],
                ["Production status", order.productionStatus],
              ]}
            />
          </TabsContent>
          <TabsContent value="financials" className="space-y-4">
            <FinancialsTab order={order} />
          </TabsContent>
          <TabsContent value="activity" className="space-y-4">
            <ActivityPanel items={order.recentActivity} fullList />
          </TabsContent>
        </Tabs>
      </div>
    </PageContainer>
  );
}

function OverviewTab({ order }: { order: OrderDetail }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Next Action</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-accent" />
              <div>
                <p className="text-sm font-medium text-text-primary">
                  {order.nextAction}
                </p>
                <p className="mt-1 text-sm text-text-secondary">
                  Current order state: {order.orderStatus}; payment state: {order.paymentStatus}.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Workflow Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <WorkflowStrip steps={order.workflowSteps} compact />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Key Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-text-secondary">{order.notes}</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <RelatedRecords order={order} />
        <ActivityPanel items={order.recentActivity} />
      </div>
    </div>
  );
}

function SelectionTab({ selection }: { selection: OrderSelectionWorkflow }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="text-accent">
              <ClipboardList className="h-4 w-4" />
            </span>
            Selection
          </CardTitle>
        </CardHeader>
        <CardContent>
          <InfoGrid
            items={[
              ["Package", selection.finalPackageName],
              ["Package limit", String(selection.includedPhotoCount)],
              ["Selected photos", String(selection.selectedPhotos)],
              ["Extra selected", String(selection.extraPhotoCount)],
            ]}
          />
        </CardContent>
      </Card>
      <SelectionWorkflowForm selection={selection} />
    </div>
  );
}

function FinancialsTab({ order }: { order: OrderDetail }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoice Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <InfoGrid
            items={[
              ["Invoice status", order.invoiceStatus],
              ["Payment status", order.paymentStatus],
              ["Total", order.totalAmount],
              ["Paid", order.paidAmount],
              ["Remaining", order.remainingAmount],
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Related Invoice</CardTitle>
        </CardHeader>
        <CardContent>
          {order.primaryInvoiceId ? (
            <Button variant="outline" asChild>
              <Link href={`/invoices/${order.primaryInvoiceId}`}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Open {order.primaryInvoicePublicId}
              </Link>
            </Button>
          ) : (
            <p className="text-sm text-text-secondary">
              No invoice exists for this order yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function WorkflowAreaTab({
  icon,
  title,
  status,
  items,
}: {
  icon: ReactNode;
  title: string;
  status: string;
  items: Array<[string, string]>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="text-accent">{icon}</span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-border bg-surface-soft p-4">
          <p className="text-xs font-medium uppercase text-text-muted">Current status</p>
          <p className="mt-1 text-sm font-medium text-text-primary">{status}</p>
        </div>
        <InfoGrid items={items} />
      </CardContent>
    </Card>
  );
}

function RelatedRecords({ order }: { order: OrderDetail }) {
  const records: Array<[string, string, string | null]> = [
    ["Booking", order.bookingDate, `/bookings/${order.bookingId}`],
    ["Invoice", order.primaryInvoicePublicId ?? "No invoice", order.primaryInvoiceId ? `/invoices/${order.primaryInvoiceId}` : null],
    ["Customer", order.customerName, null],
    ["Package", order.finalPackageName, null],
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Related Records</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {records.map(([label, value, href]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-soft px-3 py-2"
          >
            <div>
              <p className="text-xs font-medium uppercase text-text-muted">{label}</p>
              <p className="text-sm font-medium text-text-primary">{value}</p>
            </div>
            {href ? (
              <Button variant="ghost" size="sm" asChild>
                <Link href={href}>
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </Button>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ActivityPanel({
  items,
  fullList = false,
}: {
  items: OrderActivityPreviewItem[];
  fullList?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {fullList ? "Activity" : "Recent Activity"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length > 0 ? (
          <div className="space-y-4">
            {items.map((item) => (
              <div key={item.id} className="border-l border-border pl-4">
                <p className="text-sm font-medium text-text-primary">{item.title}</p>
                {item.description ? (
                  <p className="mt-1 text-sm text-text-secondary">
                    {item.description}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-text-muted">{item.createdAt}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-text-secondary">
            No activity has been recorded for this order yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function WorkflowStrip({
  steps,
  compact = false,
}: {
  steps: OrderWorkflowStep[];
  compact?: boolean;
}) {
  return (
    <div className={compact ? "grid gap-3 md:grid-cols-4" : "grid gap-3 md:grid-cols-4"}>
      {steps.map((step) => (
        <div
          key={step.label}
          className="rounded-lg border border-border bg-surface p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase text-text-muted">
              {step.label}
            </p>
            <span className={`h-2.5 w-2.5 rounded-full ${stepToneClass(step.tone)}`} />
          </div>
          <p className="mt-2 text-sm font-medium text-text-primary">
            {step.status}
          </p>
        </div>
      ))}
    </div>
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
    <div className="rounded-md border border-border bg-surface-soft p-3">
      <p className="text-xs font-medium uppercase text-text-muted">{label}</p>
      <p className="mt-1 text-sm font-medium text-text-primary">{value}</p>
      <p className="mt-1 text-xs text-text-secondary">{detail}</p>
    </div>
  );
}

function InfoGrid({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
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

function stepToneClass(tone: OrderWorkflowStep["tone"]): string {
  switch (tone) {
    case "complete":
      return "bg-success";
    case "active":
      return "bg-info";
    case "pending":
      return "bg-warning";
  }
}
