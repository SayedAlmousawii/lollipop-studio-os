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
  POSPackageItem,
  POSProductOption,
  POSWorkspace,
} from "@/modules/orders/order.types";

interface POSPackageCompositionProps {
  workspace: POSWorkspace;
}

export function POSPackageComposition({ workspace }: POSPackageCompositionProps) {
  const locked = workspace.invoice?.isLocked ?? false;

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

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium text-text-primary">
              {workspace.currentPackage?.name ?? "No package selected"}
            </p>
            <p className="text-sm text-text-secondary">
              {workspace.includedPhotoCount} included photos · {workspace.currentPackage?.priceLabel ?? "0.000 KD"}
            </p>
          </div>
          <PackageUpgradeDialog workspace={workspace} locked={locked} />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {workspace.packageItems.map((item) => (
            <DeliverableCard
              key={item.id}
              item={item}
              orderId={workspace.orderId}
              productOptions={workspace.productOptions}
              locked={locked}
            />
          ))}
          {workspace.packageItems.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-4 text-sm text-text-secondary">
              Structured package deliverables will appear here when available.
            </div>
          ) : null}
        </div>

        <div className="space-y-2 border-t border-border pt-4 text-sm">
          <MoneyLine
            label="Package price"
            value={workspace.currentPackage?.priceLabel ?? "0.000 KD"}
            strong
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function POSPhotoCountCard({ workspace }: POSPackageCompositionProps) {
  const locked = workspace.invoice?.isLocked ?? false;
  const [state, formAction] = useActionState<POSCompositionActionState, FormData>(
    updateOrderSelectedPhotoCountAction.bind(null, workspace.orderId),
    {}
  );

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
        <div className="rounded-md border border-border bg-surface-soft p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-text-primary">
                {workspace.includedPhotoCount} Included Edited Photos
              </p>
              <p className="mt-1 text-xs uppercase text-text-muted">DIGITAL</p>
            </div>
            <Badge variant="secondary" className="rounded-md">
              Included
            </Badge>
          </div>
          {workspace.extraPhotoCount > 0 ? (
            <p className="mt-3 text-sm text-text-secondary">
              {workspace.extraPhotoCount} extra selected · {workspace.extraPhotoCount} x{" "}
              {formatKD(workspace.extraPhotoUnitPrice)} = {formatKD(workspace.extraPhotoTotal)}
            </p>
          ) : (
            <p className="mt-3 text-sm text-text-secondary">No extra-photo charge</p>
          )}
        </div>
        <form action={formAction} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="selectedPhotoCount">Selected photos</Label>
              <Input
                key={`${workspace.currentPackage?.id ?? "none"}:${workspace.selectedPhotoCount}`}
                id="selectedPhotoCount"
                name="selectedPhotoCount"
                type="number"
                min={workspace.includedPhotoCount}
                step={1}
                defaultValue={workspace.selectedPhotoCount}
                disabled={locked}
                aria-invalid={
                  state.errors?.selectedPhotoCount?.length ||
                  state.errors?._global?.length
                    ? true
                    : undefined
                }
              />
            </div>
            <SubmitButton label="Update Count" disabled={locked} />
          </div>
          <div className="grid gap-2 text-xs text-text-secondary sm:grid-cols-3">
            <span>Included: {workspace.includedPhotoCount}</span>
            <span>Selected: {workspace.selectedPhotoCount}</span>
            <span>Extra: {workspace.extraPhotoCount}</span>
          </div>
          <FieldError messages={state.errors?.selectedPhotoCount} />
          <GlobalError messages={state.errors?._global} />
        </form>
      </CardContent>
    </Card>
  );
}

function PackageUpgradeDialog({
  workspace,
  locked,
}: {
  workspace: POSWorkspace;
  locked: boolean;
}) {
  const [selectedPackageId, setSelectedPackageId] = useState(
    workspace.currentPackage?.id ?? workspace.packageOptions[0]?.id ?? ""
  );
  const [state, formAction] = useActionState<POSCompositionActionState, FormData>(
    updateOrderPackageAction.bind(null, workspace.orderId),
    {}
  );

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={locked || workspace.packageOptions.length === 0}>
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
          <input type="hidden" name="packageId" value={selectedPackageId} />
          <div className="space-y-2">
            <Label htmlFor="packageId">Package</Label>
            <Select value={selectedPackageId} onValueChange={setSelectedPackageId}>
              <SelectTrigger id="packageId">
                <SelectValue placeholder="Select package..." />
              </SelectTrigger>
              <SelectContent>
                {workspace.packageOptions.map((option) => (
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
  productOptions,
  locked,
}: {
  item: POSPackageItem;
  orderId: string;
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
        item={item}
        options={replacementOptions}
        locked={locked}
      />
    </div>
  );
}

function ItemUpgradeDialog({
  orderId,
  item,
  options,
  locked,
}: {
  orderId: string;
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
