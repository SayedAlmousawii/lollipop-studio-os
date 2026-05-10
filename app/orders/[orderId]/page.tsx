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
} from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { ActivityTabContent } from "@/components/orders/activity-tab-content";
import { DeliveryWorkflowForm } from "@/components/orders/delivery-workflow-form";
import { EditingWorkflowForm } from "@/components/orders/editing-workflow-form";
import { InvoiceStatusBadge } from "@/components/orders/invoice-status-badge";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { ProductionWorkflowForm } from "@/components/orders/production-workflow-form";
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
  getOrderDeliveryWorkflowById,
  getOrderEditingWorkflowById,
  getOrderFinancialSummary,
  getOrderProductionWorkflowById,
  getOrderSelectionWorkflowById,
} from "@/modules/orders/order.service";
import { getOrderActivityTimeline } from "@/modules/orders/order-activity.service";
import type {
  OrderActivityPreviewItem,
  OrderDetail,
  OrderDeliveryWorkflow,
  OrderEditingWorkflow,
  OrderFinancialSummary,
  OrderProductionWorkflow,
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
  const [order, selection, editing, production, delivery, financial, activity] =
    await Promise.all([
      getOrderHubById(orderId),
      getOrderSelectionWorkflowById(orderId),
      getOrderEditingWorkflowById(orderId),
      getOrderProductionWorkflowById(orderId),
      getOrderDeliveryWorkflowById(orderId),
      getOrderFinancialSummary(orderId),
      getOrderActivityTimeline(orderId),
    ]);
  if (!order) notFound();
  if (!selection) notFound();
  if (!editing) notFound();
  if (!production) notFound();
  if (!delivery) notFound();

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
            <EditingTab editing={editing} order={order} />
          </TabsContent>
          <TabsContent value="production" className="space-y-4">
            <ProductionTab production={production} order={order} />
          </TabsContent>
          <TabsContent value="delivery" className="space-y-4">
            <DeliveryTab delivery={delivery} order={order} />
          </TabsContent>
          <TabsContent value="financials" className="space-y-4">
            <FinancialsTab order={order} financial={financial} />
          </TabsContent>
          <TabsContent value="activity" className="space-y-4">
            <ActivityTabContent items={activity} />
          </TabsContent>
        </Tabs>
      </div>
    </PageContainer>
  );
}

function ProductionTab({
  production,
  order,
}: {
  production: OrderProductionWorkflow;
  order: OrderDetail;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="text-accent">
              <PackageCheck className="h-4 w-4" />
            </span>
            Production
          </CardTitle>
        </CardHeader>
        <CardContent>
          <InfoGrid
            items={[
              ["Production status", production.productionStatus],
              ["Delivery readiness", production.deliveryStatus],
              ["Ready for pickup", production.readyAt ?? "Not ready"],
              ["Deliverables", order.addonsSummary],
              ["Included photos", order.includedPhotoCount],
              ["Extra photos", order.extraPhotoCount],
            ]}
          />
        </CardContent>
      </Card>
      <ProductionWorkflowForm production={production} />
    </div>
  );
}

function DeliveryTab({
  delivery,
  order,
}: {
  delivery: OrderDeliveryWorkflow;
  order: OrderDetail;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="text-accent">
              <PackageCheck className="h-4 w-4" />
            </span>
            Delivery
          </CardTitle>
        </CardHeader>
        <CardContent>
          <InfoGrid
            items={[
              ["Customer", order.customerName],
              ["Order status", order.orderStatus],
              ["Delivery status", delivery.deliveryStatus],
              ["Payment status", delivery.paymentStatus],
              ["Production status", delivery.productionStatus],
              ["Pickup notes", delivery.pickupNotes || "—"],
            ]}
          />
        </CardContent>
      </Card>
      <DeliveryWorkflowForm delivery={delivery} />
    </div>
  );
}

function EditingTab({
  editing,
  order,
}: {
  editing: OrderEditingWorkflow;
  order: OrderDetail;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="text-accent">
              <Pencil className="h-4 w-4" />
            </span>
            Editing
          </CardTitle>
        </CardHeader>
        <CardContent>
          <InfoGrid
            items={[
              ["Assigned editor", editing.assignedEditorName],
              ["Assigned date", editing.assignedAt ?? "Not assigned"],
              ["Editing status", editing.editingStatus],
              ["Edited photos", `${editing.editedPhotoCount} of ${editing.targetPhotoCount}`],
              ["Revision count", String(editing.revisionCount)],
              ["Customer approval", editing.approvalState],
              ["Estimated completion", editing.estimatedCompletionDate ?? "Not set"],
              ["Production status", editing.productionStatus],
              ["Current package", order.finalPackageName],
              ["Selection status", order.selectionStatus],
            ]}
          />
        </CardContent>
      </Card>
      <EditingWorkflowForm editing={editing} />
    </div>
  );
}

function OverviewTab({ order }: { order: OrderDetail }) {
  const selectedPhotoCountLabel =
    order.selectedPhotoCount.trim().length > 0 ? order.selectedPhotoCount : "—";
  const extraPhotoCountValue = Number.parseInt(order.extraPhotoCount, 10);
  const selectedPhotosLabel =
    Number.isFinite(extraPhotoCountValue) && extraPhotoCountValue > 0
      ? `${selectedPhotoCountLabel} (${extraPhotoCountValue} extra)`
      : selectedPhotoCountLabel;

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
            <CardTitle className="text-base">Deliverables</CardTitle>
          </CardHeader>
          <CardContent>
            <InfoGrid
              items={[
                ["Package", order.finalPackageName],
                ["Photo limit", order.includedPhotoCount],
                ["Selected photos", selectedPhotosLabel],
                [
                  "Add-ons",
                  order.addonsSummary === "—" ? "None selected" : order.addonsSummary,
                ],
              ]}
            />
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
  if (selection.orderStatus === "Active") {
    return (
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
          <p className="text-sm text-text-secondary">
            Base payment not yet recorded. Use &ldquo;Record Base Payment&rdquo; on
            the booking to unlock selection.
          </p>
        </CardContent>
      </Card>
    );
  }

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
              ["Package includes", selection.packageDescription ?? "—"],
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

function FinancialsTab({
  order,
  financial,
}: {
  order: OrderDetail;
  financial: OrderFinancialSummary | null;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">Invoice Summary</CardTitle>
              {financial?.invoiceId ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/invoices/${financial.invoiceId}`}>
                    <ExternalLink className="mr-2 h-3.5 w-3.5" />
                    {financial.invoiceNumber}
                  </Link>
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            <InfoGrid
              items={[
                ["Invoice number", financial?.invoiceNumber ?? "—"],
                ["Invoice status", financial?.invoiceStatus ?? order.invoiceStatus],
                ["Payment status", financial?.paymentStatus ?? order.paymentStatus],
                ["Invoice total", financial?.invoiceTotal ?? order.totalAmount],
                ["Paid amount", financial?.paidAmount ?? order.paidAmount],
                ["Balance due", financial?.balanceDue ?? order.remainingAmount],
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Price Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <InfoGrid
              items={[
                ["Base package", financial?.basePackageName ?? order.originalPackageName],
                ["Package price", financial?.basePackagePrice ?? "—"],
                ...(financial?.upgradePackageName
                  ? ([
                      ["Upgrade to", financial.upgradePackageName],
                      ["Upgrade charge", financial.upgradeAmount ?? "—"],
                    ] as Array<[string, string]>)
                  : []),
                ["Add-on total", financial?.addOnTotal ?? "—"],
                ["Extra photos", financial?.extraPhotoTotal ?? "—"],
              ]}
            />
          </CardContent>
        </Card>
      </div>

      {financial && financial.payments.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment Records</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {financial.payments.map((payment) => (
                <div
                  key={payment.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-soft px-3 py-2"
                >
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-text-primary">
                      {payment.amount}
                    </p>
                    <p className="text-xs text-text-secondary">
                      {payment.paymentType} · {payment.method}
                      {payment.reference !== "—" ? ` · Ref: ${payment.reference}` : ""}
                    </p>
                  </div>
                  <p className="text-xs text-text-muted">{payment.paidAt}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!financial?.invoiceId ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invoice</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            <p className="text-sm text-text-secondary">
              No invoice exists for this order yet.
            </p>
            <form action={createOrderInvoiceAction.bind(null, order.id)}>
              <Button type="submit" variant="outline" size="sm">
                <CreditCard className="mr-2 h-4 w-4" />
                Create Invoice
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function RelatedRecords({ order }: { order: OrderDetail }) {
  const records: Array<[string, string, string | null]> = [
    ["Booking", order.bookingDate, `/bookings/${order.bookingId}`],
    ["Invoice", order.primaryInvoiceNumber ?? "No invoice", order.primaryInvoiceId ? `/invoices/${order.primaryInvoiceId}` : null],
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
