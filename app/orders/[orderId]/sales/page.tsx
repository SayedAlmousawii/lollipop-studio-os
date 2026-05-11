import { notFound } from "next/navigation";
import { AlertCircle, Lock, Plus, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { POSPackageComposition } from "@/components/orders/pos-package-composition";
import { getPOSWorkspace } from "@/modules/orders/order.service";
import type { POSWorkspace } from "@/modules/orders/order.types";

export default async function SalesPage(
  props: PageProps<"/orders/[orderId]/sales">
) {
  const { orderId } = await props.params;
  const workspace = await getPOSWorkspace(orderId);
  if (!workspace) notFound();

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
      <main className="space-y-5">
        <POSPackageComposition workspace={workspace} />
        <ActionsSkeleton workspace={workspace} />
        <AddOnsSkeleton workspace={workspace} />
      </main>
      <FinancialSidebar workspace={workspace} />
    </div>
  );
}

function ActionsSkeleton({ workspace }: { workspace: POSWorkspace }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plus className="h-4 w-4 text-accent" />
          Commercial Actions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {workspace.invoice?.isLocked ? (
          <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
            Invoice is locked. Composition changes will require the future adjustment flow.
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {["Add Album", "Add Canvas", "Add Prints", "Add Digital"].map((label) => (
            <Button key={label} variant="outline" disabled>
              {label}
            </Button>
          ))}
        </div>
        <p className="text-sm text-text-secondary">
          Action pickers are intentionally reserved for the next POS units.
        </p>
      </CardContent>
    </Card>
  );
}

function AddOnsSkeleton({ workspace }: { workspace: POSWorkspace }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Standalone Add-ons</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {workspace.addOns.length > 0 ? (
          workspace.addOns.map((addOn) => (
            <div key={addOn.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              <span className="text-text-primary">{addOn.name}</span>
              <span className="font-medium text-text-primary">{addOn.priceLabel}</span>
            </div>
          ))
        ) : (
          <p className="rounded-md border border-dashed border-border p-4 text-sm text-text-secondary">
            No standalone add-ons are attached to this order yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function FinancialSidebar({ workspace }: { workspace: POSWorkspace }) {
  const invoice = workspace.invoice;
  const packageAmount = invoice?.packageBaseTotal ?? workspace.currentPackage?.price ?? 0;
  const extraPhotoAmount = invoice?.extraPhotoTotal ?? workspace.extraPhotoTotal;
  const addOnAmount = invoice?.addOnTotal ?? workspace.addOnTotal;
  const totalAmount = invoice?.invoiceTotal ?? packageAmount + extraPhotoAmount + addOnAmount;

  return (
    <aside className="space-y-4 lg:sticky lg:top-4">
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
            <div className="space-y-1 text-sm">
              <p className="font-medium text-text-primary">Invoice {invoice.invoiceNumber}</p>
              <p className="text-text-secondary">{invoice.invoiceStatus}</p>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-md border border-border bg-surface-soft p-3 text-sm text-text-secondary">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              No invoice exists yet. The current package snapshot is shown below.
            </div>
          )}

          <div className="space-y-2 border-t border-border pt-4">
            <MoneyRow label="Package" value={formatKD(packageAmount)} />
            <MoneyRow label="Extra photos" value={formatKD(extraPhotoAmount)} />
            <MoneyRow label="Add-ons" value={formatKD(addOnAmount)} />
            <MoneyRow label="Total" value={formatKD(totalAmount)} strong />
          </div>

          {invoice ? (
            <div className="space-y-2 border-t border-border pt-4">
              <MoneyRow label="Paid" value={formatKD(invoice.paidAmount)} />
              <MoneyRow label="Remaining" value={formatKD(invoice.remainingAmount)} strong />
            </div>
          ) : null}
        </CardContent>
      </Card>
    </aside>
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
