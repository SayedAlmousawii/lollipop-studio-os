import { notFound } from "next/navigation";
import { AlertCircle, Lock, ReceiptText } from "lucide-react";
import { createOrderInvoiceAction } from "@/app/orders/[orderId]/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { POSAddOnMarketplace } from "@/components/orders/pos-add-on-marketplace";
import {
  POSPackageComposition,
  POSPhotoCountCard,
} from "@/components/orders/pos-package-composition";
import { POSRecordPaymentDialog } from "@/components/orders/pos-record-payment-dialog";
import { getPOSWorkspace } from "@/modules/orders/order.service";
import type { POSWorkspace } from "@/modules/orders/order.types";

export default async function SalesPage(
  props: PageProps<"/orders/[orderId]/sales">
) {
  const { orderId } = await props.params;
  const workspace = await getPOSWorkspace(orderId);
  if (!workspace) notFound();

  return (
    <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
      <main className="space-y-5">
        <POSPackageComposition workspace={workspace} />
        <POSPhotoCountCard workspace={workspace} />
        <POSAddOnMarketplace workspace={workspace} />
      </main>
      <FinancialSidebar workspace={workspace} />
    </div>
  );
}

function FinancialSidebar({ workspace }: { workspace: POSWorkspace }) {
  const invoice = workspace.invoice;
  const packageAmount = workspace.currentPackage?.price ?? 0;
  const bundleAdjustment = workspace.bundleAdjustment;
  const extraPhotoAmount = workspace.extraPhotoTotal;
  const totalAmount =
    invoice?.invoiceTotal ??
    packageAmount + bundleAdjustment + extraPhotoAmount + workspace.addOnTotal;

  return (
    <aside className="space-y-4 md:sticky md:top-4">
      <Card className="border-text-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3 text-base">
            <span className="inline-flex items-center gap-2">
              <ReceiptText className="h-4 w-4 text-accent" />
              Financial Summary
            </span>
            {invoice?.isLocked ? (
              <Badge variant="outline" className="rounded-md">
                Locked
              </Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {invoice ? (
            <div className="space-y-2">
              <div className="space-y-1">
                <p className="text-sm font-medium text-text-primary">
                  Invoice #{invoice.invoiceNumber}
                </p>
                <Badge variant="secondary" className="w-fit rounded-md">
                  {invoice.invoiceStatus}
                </Badge>
              </div>
              {invoice.isLocked ? (
                <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                  Invoice locked. Composition changes now require the future adjustment flow.
                </div>
              ) : null}
              <p className="text-xs uppercase tracking-[0.18em] text-text-muted">
                {invoice.renderMode === "SNAPSHOT"
                  ? "Snapshot line items"
                  : "Computed current composition"}
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-md border border-border bg-surface-soft p-3 text-sm text-text-secondary">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              No invoice exists yet. The sidebar is showing the current commercial totals.
            </div>
          )}

          <div className="space-y-2 border-t border-border pt-4">
            {invoice?.renderMode === "SNAPSHOT" && invoice.lineItems.length > 0 ? (
              invoice.lineItems.map((item) => (
                <InvoiceLineRow
                  key={item.id}
                  label={item.description}
                  meta={`${item.quantity} × ${item.unitPriceLabel}`}
                  value={item.lineTotalLabel}
                />
              ))
            ) : (
              <>
                <MoneyRow
                  label={`Package${workspace.currentPackage ? ` (${workspace.currentPackage.name})` : ""}`}
                  value={formatKD(packageAmount)}
                />
                {bundleAdjustment !== 0 ? (
                  <MoneyRow label="Bundle adjustment" value={formatKD(bundleAdjustment)} />
                ) : null}
                {extraPhotoAmount > 0 ? (
                  <MoneyRow
                    label={`Extra Photos (${workspace.extraPhotoCount})`}
                    value={formatKD(extraPhotoAmount)}
                  />
                ) : null}
                {workspace.addOns.map((addOn) => (
                  <MoneyRow key={addOn.id} label={addOn.name} value={addOn.priceLabel} />
                ))}
              </>
            )}
            <MoneyRow label="Total" value={formatKD(totalAmount)} strong />
          </div>

          {invoice ? (
            <div className="space-y-2 border-t border-border pt-4">
              <MoneyRow label="Paid" value={formatKD(invoice.paidAmount)} />
              <MoneyRow label="Remaining" value={formatKD(invoice.remainingAmount)} strong />
            </div>
          ) : null}

          <div className="border-t border-border pt-4">
            {invoice ? (
              invoice.remainingAmount <= 0 ? (
                <div className="space-y-2">
                  <Button className="w-full" disabled>
                    Fully Paid
                  </Button>
                  <p className="text-center text-xs text-text-muted">
                    No outstanding balance remains.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <POSRecordPaymentDialog
                    orderId={workspace.orderId}
                    invoice={invoice}
                    customerName={workspace.customerName}
                    jobNumber={workspace.jobNumber}
                  />
                  <p className="text-center text-xs text-text-muted">
                    Opens without leaving the sales workspace.
                  </p>
                </div>
              )
            ) : (
              <form action={createOrderInvoiceAction.bind(null, workspace.orderId)}>
                <Button type="submit" className="w-full">
                  Create Invoice
                </Button>
              </form>
            )}
          </div>
        </CardContent>
      </Card>
    </aside>
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
    <div className={`flex items-center justify-between gap-3 text-sm ${strong ? "font-semibold text-text-primary" : "text-text-secondary"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function formatKD(value: number): string {
  return `${value.toFixed(3)} KD`;
}
