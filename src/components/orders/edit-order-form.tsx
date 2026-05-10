"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Plus, Save, Trash2 } from "lucide-react";
import { updateOrderAction, type UpdateOrderActionState } from "@/app/orders/[orderId]/edit/actions";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { EditableOrder, OrderAddOn, OrderEditPackage } from "@/modules/orders/order.types";
import type { PackageOption } from "@/modules/packages/package.types";

interface EditOrderFormProps {
  order: EditableOrder;
  packages: PackageOption[];
}

export function EditOrderForm({ order, packages }: EditOrderFormProps) {
  const packageOptions = useMemo(
    () => mergePackageOptions(packages, order.originalPackage, order.finalPackage),
    [packages, order.originalPackage, order.finalPackage]
  );
  const initialPackageId =
    order.finalPackage?.id ?? order.originalPackage?.id ?? packageOptions[0]?.id ?? "";
  const [selectedPackageId, setSelectedPackageId] = useState(initialPackageId);
  const [selectedPhotos, setSelectedPhotos] = useState(order.selectedPhotos);
  const [addOns, setAddOns] = useState<OrderAddOn[]>(
    order.addOns.length ? order.addOns : []
  );
  const [state, formAction] = useActionState<UpdateOrderActionState, FormData>(
    updateOrderAction.bind(null, order.id),
    {}
  );

  const selectedPackage = packageOptions.find((item) => item.id === selectedPackageId) ?? null;
  const originalPrice = order.originalPackage?.price ?? 0;
  const selectedPrice = selectedPackage?.price ?? 0;
  const currentAddOnTotal = sumAddOns(order.addOns);
  const selectedAddOnTotal = sumAddOns(addOns);
  const recognizedPackageBaseline =
    order.invoiceSummary?.recognizedPackageBaseline ??
    order.finalPackage?.price ??
    order.originalPackage?.price ??
    0;
  const packageAdjustment = selectedPrice - recognizedPackageBaseline;
  const addOnAdjustment = selectedAddOnTotal - currentAddOnTotal;
  const totalAdjustment = packageAdjustment + addOnAdjustment;
  const projectedInvoiceTotal = selectedPrice + selectedAddOnTotal;
  const projectedBalanceDue = Math.max(
    projectedInvoiceTotal - (order.invoiceSummary?.paidAmount ?? 0),
    0
  );
  const packageChangeLabel =
    packageAdjustment > 0 ? "Package upgraded" : packageAdjustment < 0 ? "Package downgraded" : "No package adjustment";
  const includedPhotos = selectedPackage?.photoCount ?? order.originalPackage?.photoCount ?? 0;
  const extraPhotos = Math.max(selectedPhotos - includedPhotos, 0);
  const isDelivered = order.orderStatus === "Delivered";
  const isInvoiceLocked = order.invoiceSummary?.isLocked ?? false;
  const saveDisabled = isDelivered || isInvoiceLocked || packageOptions.length === 0;

  return (
    <form action={formAction} className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold text-text-primary">Edit Order</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {order.customerPhone} · {selectedPackage?.name ?? "No package selected"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" asChild>
            <Link href={`/orders/${order.id}`}>Back to Order Details</Link>
          </Button>
          <SubmitButton disabled={saveDisabled} />
        </div>
      </div>

      {state.errors?._global ? (
        <p className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
          {state.errors._global[0]}
        </p>
      ) : null}

      {isDelivered ? (
        <p className="rounded-md bg-warning-soft px-4 py-3 text-sm text-warning">
          Delivered orders cannot be edited.
        </p>
      ) : null}

      {packageOptions.length === 0 ? (
        <p className="rounded-md bg-warning-soft px-4 py-3 text-sm text-warning">
          No packages are available. Saving is disabled until a package exists.
        </p>
      ) : null}

      {isInvoiceLocked ? (
        <p className="rounded-md bg-warning-soft px-4 py-3 text-sm text-warning">
          This order&apos;s invoice is locked. Unlock or adjust the invoice before editing financial order fields.
        </p>
      ) : null}

      <Section title="Order Summary">
        <InfoGrid
          items={[
            ["Customer phone", order.customerPhone],
            ["Booking date", order.bookingDate],
            ["Original package", order.originalPackage?.name ?? "—"],
            ["Current final package", order.finalPackage?.name ?? order.originalPackage?.name ?? "—"],
          ]}
        />
        <div className="mt-4">
          <p className="mb-1 text-xs font-medium uppercase text-text-muted">Order status</p>
          <OrderStatusBadge status={order.orderStatus} />
        </div>
      </Section>

      <Section title="Package Adjustment">
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="space-y-2">
            <Label htmlFor="finalPackageId">Package</Label>
            <Select
              name="finalPackageId"
              value={selectedPackageId}
              onValueChange={setSelectedPackageId}
              disabled={isDelivered || packageOptions.length === 0}
              required
            >
              <SelectTrigger id="finalPackageId" aria-invalid={state.errors?.finalPackageId?.length ? true : undefined}>
                <SelectValue placeholder="Select a package..." />
              </SelectTrigger>
              <SelectContent>
                {packageOptions.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name} · {item.priceLabel} · {item.photoCount} photos
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError messages={state.errors?.finalPackageId} />
          </div>

          <div className="rounded-md border border-border bg-surface-soft p-4">
            <div className="grid gap-3 text-sm">
              <PriceRow label="Original package price" value={formatMoney(originalPrice)} />
              <PriceRow
                label="Invoice package baseline"
                value={formatMoney(recognizedPackageBaseline)}
              />
              <PriceRow label="Selected package price" value={formatMoney(selectedPrice)} />
              <div className="flex items-center justify-between border-t border-border pt-3">
                <span className="text-text-secondary">Package adjustment</span>
                <span className={packageAdjustment > 0 ? "font-semibold text-accent-dark" : "font-medium text-text-primary"}>
                  {formatSignedMoney(packageAdjustment)}
                </span>
              </div>
              {packageAdjustment !== 0 ? (
                <p className="rounded-sm bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent-dark">
                  {packageChangeLabel}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Financial Consequence">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <ReadOnlyMetric
            label="Package adjustment"
            value={formatSignedMoney(packageAdjustment)}
          />
          <ReadOnlyMetric
            label="Add-on adjustment"
            value={formatSignedMoney(addOnAdjustment)}
          />
          <ReadOnlyMetric
            label="Total adjustment"
            value={formatSignedMoney(totalAdjustment)}
          />
          <ReadOnlyMetric
            label="Projected balance due"
            value={formatMoney(projectedBalanceDue)}
          />
        </div>
        <p className="mt-3 text-sm text-text-secondary">
          {order.invoiceSummary
            ? `Saving will sync invoice ${order.invoiceSummary.invoiceNumber} and preserve the recorded paid amount of ${formatMoney(order.invoiceSummary.paidAmount)}.`
            : "Saving will create the order invoice context and apply these totals."}
        </p>
      </Section>

      <Section title="Photo Selection">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="selectedPhotos">Selected photos count</Label>
            <Input
              id="selectedPhotos"
              name="selectedPhotos"
              type="number"
              min="0"
              step="1"
              value={selectedPhotos}
              onChange={(event) => setSelectedPhotos(Number(event.target.value))}
              disabled={isDelivered}
              aria-invalid={state.errors?.selectedPhotos?.length ? true : undefined}
            />
            <FieldError messages={state.errors?.selectedPhotos} />
          </div>
          <ReadOnlyMetric label="Included photos" value={String(includedPhotos)} />
          <ReadOnlyMetric label="Extra photos" value={String(extraPhotos)} />
        </div>
      </Section>

      <Section title="Add-ons">
        <div className="space-y-3">
          {addOns.length === 0 ? (
            <p className="text-sm text-text-secondary">No add-ons added.</p>
          ) : null}
          {addOns.map((addOn, index) => (
            <div key={index} className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
              <div className="space-y-2">
                <Label htmlFor={`add-on-name-${index}`}>Name</Label>
                <Input
                  id={`add-on-name-${index}`}
                  name="addOnName"
                  value={addOn.name}
                  onChange={(event) => updateAddOn(index, { name: event.target.value })}
                  disabled={isDelivered}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`add-on-price-${index}`}>Price</Label>
                <Input
                  id={`add-on-price-${index}`}
                  name="addOnPrice"
                  type="number"
                  min="0"
                  step="0.001"
                  value={addOn.price}
                  onChange={(event) => updateAddOn(index, { price: Number(event.target.value) })}
                  disabled={isDelivered}
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setAddOns((items) => items.filter((_, itemIndex) => itemIndex !== index))}
                  disabled={isDelivered}
                  aria-label="Remove add-on"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          <FieldError messages={state.errors?.addOns} />
          <Button
            type="button"
            variant="outline"
            onClick={() => setAddOns((items) => [...items, { name: "", price: 0 }])}
            disabled={isDelivered}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add item
          </Button>
        </div>
      </Section>

      <Section title="Notes">
        <div className="space-y-2">
          <Label htmlFor="notes">Internal notes</Label>
          <Textarea
            id="notes"
            name="notes"
            defaultValue={order.notes}
            rows={5}
            disabled={isDelivered}
            className="resize-none"
          />
          <FieldError messages={state.errors?.notes} />
        </div>
      </Section>

      <div className="flex justify-end">
        <SubmitButton disabled={saveDisabled} />
      </div>
    </form>
  );

  function updateAddOn(index: number, patch: Partial<OrderAddOn>) {
    setAddOns((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item
      )
    );
  }
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending} className="min-w-[120px]">
      <Save className="mr-2 h-4 w-4" />
      {pending ? "Saving..." : "Save"}
    </Button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
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
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="space-y-1">
          <p className="text-xs font-medium uppercase text-text-muted">{label}</p>
          <p className="text-sm font-medium text-text-primary">{value}</p>
        </div>
      ))}
    </div>
  );
}

function PriceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-secondary">{label}</span>
      <span className="font-medium text-text-primary">{value}</span>
    </div>
  );
}

function ReadOnlyMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-soft p-3">
      <p className="text-xs font-medium uppercase text-text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold text-text-primary">{value}</p>
    </div>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-xs text-danger">{messages[0]}</p>;
}

function mergePackageOptions(
  packages: PackageOption[],
  originalPackage: OrderEditPackage | null,
  finalPackage: OrderEditPackage | null
): PackageOption[] {
  const byId = new Map<string, PackageOption>();
  for (const packageOption of packages) {
    byId.set(packageOption.id, packageOption);
  }
  for (const packageOption of [originalPackage, finalPackage]) {
    if (packageOption && !byId.has(packageOption.id)) {
      byId.set(packageOption.id, packageOption);
    }
  }

  return Array.from(byId.values()).sort((a, b) => a.price - b.price);
}

function formatMoney(value: number): string {
  return `${value.toFixed(3)} KD`;
}

function formatSignedMoney(value: number): string {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatMoney(value)}`;
}

function sumAddOns(addOns: OrderAddOn[]): number {
  return addOns.reduce((sum, addOn) => sum + addOn.price, 0);
}
