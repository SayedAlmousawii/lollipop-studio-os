"use client";

import { useActionState } from "react";
import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRightLeft, Lock, PackageOpen } from "lucide-react";
import {
  updateOrderPackageAction,
  updateOrderSelectedPhotoCountAction,
  upgradeOrderPackageItemAction,
  type POSCompositionActionState,
} from "@/app/orders/[orderId]/sales/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  POSPackageLine,
  POSPackageItem,
  POSProductOption,
  POSWorkspace,
} from "@/modules/orders/order.types";

interface POSPackageCompositionProps {
  workspace: POSWorkspace;
}

export function POSPackageComposition({ workspace }: POSPackageCompositionProps) {
  const locked = workspace.invoice?.isLocked ?? false;
  const packagePriceTotal =
    workspace.packageLines.length > 0
      ? workspace.packageLines.reduce(
          (sum, line) => sum + line.currentPackage.price,
          0
        )
      : workspace.currentPackage?.price ?? 0;

  return (
    <Card id="package-composition">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PackageOpen className="h-4 w-4 text-accent" />
          Package Composition
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {locked ? (
          <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
            Invoice is locked. Package and item changes require the future adjustment flow.
          </div>
        ) : null}

        <div className="space-y-4">
          {workspace.packageLines.map((line) => (
            <div key={line.id} className="space-y-4 rounded-md border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-text-primary">
                    {line.currentPackage.name}
                  </p>
                  <p className="text-sm text-text-secondary">
                    {line.sessionTypeName} · {line.includedPhotoCount} included photos · {line.currentPackage.priceLabel}
                  </p>
                </div>
                <PackageUpgradeDialog
                  orderId={workspace.orderId}
                  line={line}
                  locked={locked}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {line.packageItems.map((item) => (
                  <DeliverableCard
                    key={item.id}
                    item={item}
                    orderId={workspace.orderId}
                    orderPackageId={line.id}
                    productOptions={workspace.productOptions}
                    locked={locked}
                  />
                ))}
                {line.packageItems.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border p-4 text-sm text-text-secondary">
                    Structured package deliverables will appear here when available.
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {workspace.packageLines.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-4 text-sm text-text-secondary">
              Structured package deliverables will appear here when available.
            </div>
          ) : null}
        </div>

        <div className="space-y-2 border-t border-border pt-4 text-sm">
          <MoneyLine
            label="Package price"
            value={formatKD(packagePriceTotal)}
            strong
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function POSPhotoCountCard({ workspace }: POSPackageCompositionProps) {
  const locked = workspace.invoice?.isLocked ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Selected Photos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {locked ? (
          <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
            Invoice is locked. Selected-photo changes require the future adjustment flow.
          </div>
        ) : null}
        <div className="space-y-4">
          {workspace.packageLines.map((line) => (
            <POSPhotoLineForm
              key={line.id}
              orderId={workspace.orderId}
              line={line}
              locked={locked}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function POSPhotoLineForm({
  orderId,
  line,
  locked,
}: {
  orderId: string;
  line: POSPackageLine;
  locked: boolean;
}) {
  const [state, formAction] = useActionState<POSCompositionActionState, FormData>(
    updateOrderSelectedPhotoCountAction.bind(null, orderId),
    {}
  );

  return (
    <form action={formAction} className="space-y-3 rounded-md border border-border bg-surface-soft p-4">
      <input type="hidden" name="orderPackageId" value={line.id} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-text-primary">
            {line.currentPackage.name}
          </p>
          <p className="mt-1 text-xs uppercase text-text-muted">{line.sessionTypeName}</p>
        </div>
        <Badge variant="secondary" className="rounded-md">
          {line.includedPhotoCount} included
        </Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-4 md:items-end">
        <div className="space-y-2">
          <Label htmlFor={`selectedPhotoCount-${line.id}`}>Selected</Label>
          <Input
            id={`selectedPhotoCount-${line.id}`}
            name="selectedPhotoCount"
            type="number"
            min={line.includedPhotoCount}
            step={1}
            defaultValue={line.selectedPhotoCount}
            disabled={locked}
          />
          <FieldError messages={state.errors?.selectedPhotoCount} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`extraDigitalCount-${line.id}`}>Digital extras</Label>
          <Input
            id={`extraDigitalCount-${line.id}`}
            name="extraDigitalCount"
            type="number"
            min={0}
            step={1}
            defaultValue={line.extraDigitalCount}
            disabled={locked}
          />
          <FieldError messages={state.errors?.extraDigitalCount} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`extraPrintCount-${line.id}`}>Print extras</Label>
          <Input
            id={`extraPrintCount-${line.id}`}
            name="extraPrintCount"
            type="number"
            min={0}
            step={1}
            defaultValue={line.extraPrintCount}
            disabled={locked}
          />
          <FieldError messages={state.errors?.extraPrintCount} />
        </div>
        <SubmitButton label="Update" disabled={locked} />
      </div>
      <p className="text-xs text-text-secondary">
        Digital {line.extraDigitalCount} x {formatKD(line.extraDigitalUnitPrice)} · Print {line.extraPrintCount} x {formatKD(line.extraPrintUnitPrice)} · Total {formatKD(line.extraPhotoTotal)}
      </p>
      <GlobalError messages={state.errors?._global} />
    </form>
  );
}

function PackageUpgradeDialog({
  orderId,
  line,
  locked,
}: {
  orderId: string;
  line: POSPackageLine;
  locked: boolean;
}) {
  const [selectedPackageId, setSelectedPackageId] = useState(
    line.currentPackage.id ?? line.packageOptions[0]?.id ?? ""
  );
  const [state, formAction] = useActionState<POSCompositionActionState, FormData>(
    updateOrderPackageAction.bind(null, orderId),
    {}
  );
  const packageSelectId = `packageId-${line.id}`;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={locked || line.packageOptions.length === 0}>
          <ArrowRightLeft className="h-4 w-4" />
          Upgrade Package
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upgrade Package</DialogTitle>
          <DialogDescription>
            Choose the final package for this order. The package template is not changed.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="orderPackageId" value={line.id} />
          <input type="hidden" name="packageId" value={selectedPackageId} />
          <div className="space-y-2">
            <Label htmlFor={packageSelectId}>Package</Label>
            <Select value={selectedPackageId} onValueChange={setSelectedPackageId}>
              <SelectTrigger id={packageSelectId}>
                <SelectValue placeholder="Select package..." />
              </SelectTrigger>
              <SelectContent>
                {line.packageOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name} · {option.priceLabel} · {option.upgradeDeltaLabel}
                    {option.isCurrentPackage ? " · Current" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError messages={state.errors?.packageId} />
          </div>
          <GlobalError messages={state.errors?._global} />
          <DialogFooter>
            <SubmitButton label="Update Package" disabled={locked || !selectedPackageId} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeliverableCard({
  item,
  orderId,
  orderPackageId,
  productOptions,
  locked,
}: {
  item: POSPackageItem;
  orderId: string;
  orderPackageId: string;
  productOptions: POSProductOption[];
  locked: boolean;
}) {
  const replacementOptions = useMemo(
    () =>
      productOptions.filter(
        (option) => option.category === item.category && option.id !== item.productId
      ),
    [item.category, item.productId, productOptions]
  );

  return (
    <div className="rounded-md border border-border bg-surface-soft p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-text-primary">{item.productName}</p>
          <p className="mt-1 text-xs uppercase text-text-muted">{item.category}</p>
        </div>
        <Badge variant="outline" className="rounded-md">
          {item.quantity}x
        </Badge>
      </div>
      <p className="mt-3 text-sm text-text-secondary">
        {item.quantity}x · {item.priceSnapshotLabel}
      </p>
      <ItemUpgradeDialog
        orderId={orderId}
        orderPackageId={orderPackageId}
        item={item}
        options={replacementOptions}
        locked={locked}
      />
    </div>
  );
}

function ItemUpgradeDialog({
  orderId,
  orderPackageId,
  item,
  options,
  locked,
}: {
  orderId: string;
  orderPackageId: string;
  item: POSPackageItem;
  options: POSProductOption[];
  locked: boolean;
}) {
  const [selectedProductId, setSelectedProductId] = useState(options[0]?.id ?? "");
  const [state, formAction] = useActionState<POSCompositionActionState, FormData>(
    upgradeOrderPackageItemAction.bind(null, orderId),
    {}
  );
  const disabled = locked || options.length === 0;

  return (
    <Dialog>
      <div className="mt-4 flex flex-wrap gap-2">
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" disabled={disabled}>
            Upgrade
          </Button>
        </DialogTrigger>
        <DialogTrigger asChild>
          <Button size="sm" variant="ghost" disabled={disabled}>
            Replace
          </Button>
        </DialogTrigger>
      </div>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upgrade {item.productName}</DialogTitle>
          <DialogDescription>
            Select another {item.category.toLowerCase()} product. The price difference is recorded on the order.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="orderPackageId" value={orderPackageId} />
          <input type="hidden" name="packageItemId" value={item.id} />
          <input type="hidden" name="newProductId" value={selectedProductId} />
          <div className="space-y-2">
            <Label htmlFor={`newProductId-${item.id}`}>Replacement product</Label>
            <Select value={selectedProductId} onValueChange={setSelectedProductId}>
              <SelectTrigger id={`newProductId-${item.id}`}>
                <SelectValue placeholder="Select product..." />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name} · {option.canonicalPriceLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError messages={state.errors?.newProductId} />
          </div>
          <GlobalError messages={state.errors?._global} />
          <DialogFooter>
            <SubmitButton label="Apply Upgrade" disabled={disabled || !selectedProductId} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SubmitButton({
  label,
  disabled,
}: {
  label: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending ? "Saving..." : label}
    </Button>
  );
}

function MoneyLine({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${strong ? "font-semibold text-text-primary" : "text-text-secondary"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-sm text-danger">{messages[0]}</p>;
}

function GlobalError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return (
    <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
      {messages[0]}
    </p>
  );
}

function formatKD(value: number): string {
  return `${value.toFixed(3)} KD`;
}
