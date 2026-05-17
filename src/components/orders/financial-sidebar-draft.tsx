import { AlertCircle, ChevronDown, Lock, ReceiptText } from "lucide-react";
import { createOrderInvoiceAction } from "@/app/orders/[orderId]/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { POSRecordPaymentDialog } from "@/components/orders/pos-record-payment-dialog";
import { MoneyRow, formatKD } from "@/components/financial";
import type { POSWorkspace } from "@/modules/orders/order.types";
import { AdjustmentInvoiceBlock } from "./financial-sidebar-adjustment-blocks";
import {
  AdjustmentInvoiceSummary,
  InvoiceLineRow,
} from "./financial-sidebar-primitives";

export function FinancialSidebarDraft({
  workspace,
  className,
}: {
  workspace: POSWorkspace;
  className?: string;
}) {
  const invoice = workspace.invoice;
  const packageAmount =
    workspace.packageLines.reduce(
      (sum, line) => sum + line.currentPackage.price,
      0
    );
  const extraPhotoAmount = workspace.extraPhotoTotal;
  const totalAmount =
    invoice?.invoiceTotal ??
    packageAmount + extraPhotoAmount + workspace.addOnTotal;

  return (
    <aside className={className}>
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
                {workspace.packageLines.length > 0 ? (
                  workspace.packageLines.map((line) => (
                    <MoneyRow
                      key={line.id}
                      label={`Package (${line.currentPackage.name})`}
                      value={formatKD(line.currentPackage.price)}
                    />
                  ))
                ) : null}
                {invoice?.depositPaidAmount &&
                !(invoice.renderMode === "SNAPSHOT" && invoice.lineItems.length === 0) ? (
                  <MoneyRow
                    label={`Deposit${invoice.depositInvoiceNumber ? ` (${invoice.depositInvoiceNumber})` : ""}`}
                    value={`-${formatKD(invoice.depositPaidAmount)}`}
                  />
                ) : null}
                {extraPhotoAmount > 0 ? (
                  <MoneyRow
                    label={`Extra photos total (${workspace.extraPhotoCount})`}
                    value={formatKD(extraPhotoAmount)}
                  />
                ) : null}
                {workspace.addOns.map((addOn) => (
                  <MoneyRow key={addOn.id} label={addOn.name} value={addOn.priceLabel} />
                ))}
              </>
            )}
            {invoice?.renderMode === "SNAPSHOT" && invoice.depositPaidAmount ? (
              <MoneyRow
                label={`Deposit${invoice.depositInvoiceNumber ? ` (${invoice.depositInvoiceNumber})` : ""}`}
                value={`-${formatKD(invoice.depositPaidAmount)}`}
              />
            ) : null}
            <MoneyRow
              label={invoice ? "Final invoice total" : "Preview total"}
              value={formatKD(totalAmount)}
              strong
            />
          </div>

          {invoice ? (
            <div className="space-y-2 border-t border-border pt-4">
              <MoneyRow label="Paid" value={formatKD(invoice.paidAmount)} />
              <MoneyRow label="Remaining balance" value={formatKD(invoice.remainingAmount)} strong />
            </div>
          ) : null}

          {workspace.adjustmentInvoices.length > 0 ? (
            <div className="space-y-3 border-t border-border pt-4">
              <p className="text-xs uppercase tracking-[0.18em] text-text-muted">
                Open adjustments
              </p>
              {workspace.adjustmentInvoices.map((adjustment) => (
                <AdjustmentInvoiceBlock
                  key={adjustment.invoiceId}
                  invoice={adjustment}
                  workspace={workspace}
                />
              ))}
            </div>
          ) : null}

          {workspace.paidAdjustmentInvoices.length > 0 ? (
            <details className="group border-t border-border pt-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-text-primary">
                <span>Paid adjustments ({workspace.paidAdjustmentInvoices.length})</span>
                <ChevronDown className="h-4 w-4 text-text-muted transition group-open:rotate-180" />
              </summary>
              <div className="mt-3 space-y-2">
                {workspace.paidAdjustmentInvoices.map((adjustment) => (
                  <AdjustmentInvoiceSummary
                    key={adjustment.invoiceId}
                    invoice={adjustment}
                  />
                ))}
              </div>
            </details>
          ) : null}

          {invoice || workspace.adjustmentInvoices.length > 0 ? (
            <div className="border-t border-border pt-4">
              <MoneyRow
                label="Outstanding total"
                value={formatKD(workspace.aggregateOutstanding)}
                strong
              />
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
                    orderStatus={workspace.orderStatusRaw}
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
                <input type="hidden" name="returnTo" value="sales" />
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
