"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Plus, Save, Trash2 } from "lucide-react";
import {
  updateSelectionWorkflowAction,
  type UpdateSelectionActionState,
} from "@/app/orders/[orderId]/actions";
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
import type {
  OrderAddOn,
  OrderSelectionWorkflow,
} from "@/modules/orders/order.types";

interface SelectionWorkflowFormProps {
  selection: OrderSelectionWorkflow;
}

export function SelectionWorkflowForm({ selection }: SelectionWorkflowFormProps) {
  const resetKey = [
    selection.finalPackageId,
    selection.extraPhotoCount,
    selection.addOns
      .map((addOn) => `${addOn.productId ?? addOn.name}:${addOn.price}`)
      .join("|"),
  ].join("::");

  return <SelectionWorkflowFormBody key={resetKey} selection={selection} />;
}

function SelectionWorkflowFormBody({ selection }: SelectionWorkflowFormProps) {
  const [selectedPackageId, setSelectedPackageId] = useState(selection.finalPackageId);
  const [extraPhotos, setExtraPhotos] = useState(selection.extraPhotoCount);
  const [addOns, setAddOns] = useState<OrderAddOn[]>(
    selection.addOns.map((addOn) => ({
      ...addOn,
      productId: addOn.productId ?? findProductIdForAddOn(addOn, selection.addOnOptions),
    }))
  );
  const [state, formAction] = useActionState<UpdateSelectionActionState, FormData>(
    updateSelectionWorkflowAction.bind(null, selection.orderId),
    {}
  );
  const selectedPackage = useMemo(
    () =>
      selection.packageOptions.find((packageOption) => packageOption.id === selectedPackageId) ??
      selection.packageOptions[0] ??
      null,
    [selection.packageOptions, selectedPackageId]
  );
  const packageLimit = selectedPackage?.photoCount ?? selection.includedPhotoCount;
  const totalSelectedPhotos = packageLimit + extraPhotos;
  const extraPhotoCharge = extraPhotos * selection.extraPhotoUnitPriceAmount;
  const manualAddOnTotal = addOns.reduce((sum, addOn) => sum + addOn.price, 0);
  const selectionAddOnTotal = manualAddOnTotal + extraPhotoCharge;
  const isComplete = selection.selectionStatus === "Completed";
  const saveDisabled = selection.invoiceLocked || selection.packageOptions.length === 0;

  return (
    <form action={formAction} className="space-y-4">
      {state.errors?._global ? (
        <p className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
          {state.errors._global[0]}
        </p>
      ) : null}

      {selection.invoiceLocked ? (
        <p className="rounded-md bg-warning-soft px-4 py-3 text-sm text-warning">
          This order&apos;s invoice is locked. Unlock or adjust the invoice before changing selection financial fields.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Photo Selection</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <ReadOnlyMetric
                label="Package limit"
                value={String(packageLimit)}
              />
              <div className="space-y-2">
                <Label htmlFor="extraPhotos">Extra photos</Label>
                <Input
                  id="extraPhotos"
                  name="extraPhotos"
                  type="number"
                  min="0"
                  step="1"
                  value={extraPhotos}
                  onChange={(event) =>
                    setExtraPhotos(Math.max(Number(event.target.value), 0))
                  }
                  aria-invalid={state.errors?.extraPhotos?.length ? true : undefined}
                />
                <FieldError messages={state.errors?.extraPhotos} />
              </div>
              <ReadOnlyMetric label="Total selected" value={String(totalSelectedPhotos)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Package Decision</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="finalPackageId">Final package</Label>
                <Select
                  name="finalPackageId"
                  value={selectedPackageId}
                  onValueChange={setSelectedPackageId}
                  disabled={selection.packageOptions.length === 0}
                  required
                >
                  <SelectTrigger
                    id="finalPackageId"
                    aria-invalid={state.errors?.finalPackageId?.length ? true : undefined}
                  >
                    <SelectValue placeholder="Select package..." />
                  </SelectTrigger>
                  <SelectContent>
                    {selection.packageOptions.map((packageOption) => (
                      <SelectItem key={packageOption.id} value={packageOption.id}>
                        {packageOption.name} · {packageOption.priceLabel} · {packageOption.photoCount} photos
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError messages={state.errors?.finalPackageId} />
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <DecisionAid
                  title="Keep current package + pay extras/add-ons"
                  body={selection.keepCurrentPackageLabel}
                />
                <DecisionAid
                  title="Upgrade package + pay difference"
                  body={
                    selectedPackage?.isCurrent
                      ? selection.upgradePackageLabel
                      : `${selectedPackage?.name ?? "Selected package"} changes package adjustment by ${selectedPackage?.upgradeDifferenceLabel ?? "0.000 KD"}.`
                  }
                  highlighted={Boolean(selectedPackage && !selectedPackage.isCurrent)}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add-ons</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {addOns.length === 0 ? (
                <p className="text-sm text-text-secondary">No add-ons added.</p>
              ) : null}
              {addOns.map((addOn, index) => (
                <div key={index} className="grid gap-3 md:grid-cols-[1fr_160px_auto]">
                  <div className="space-y-2">
                    <Label htmlFor={`selection-add-on-option-${index}`}>Add-on</Label>
                    <Select
                      name="addOnProductId"
                      value={addOn.productId ?? ""}
                      onValueChange={(productId) => {
                        const option = selection.addOnOptions.find((item) => item.id === productId);
                        updateAddOn(index, option ? {
                          productId: option.id,
                          name: option.name,
                          price: option.price,
                        } : { productId });
                      }}
                      required
                    >
                      <SelectTrigger id={`selection-add-on-option-${index}`}>
                        <SelectValue placeholder="Select add-on..." />
                      </SelectTrigger>
                      <SelectContent>
                        {selection.addOnOptions.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`selection-add-on-price-${index}`}>Price</Label>
                    <Input
                      id={`selection-add-on-price-${index}`}
                      value={formatMoney(addOn.price)}
                      readOnly
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() =>
                        setAddOns((items) =>
                          items.filter((_, itemIndex) => itemIndex !== index)
                        )
                      }
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
                onClick={() =>
                  setAddOns((items) => [
                    ...items,
                    optionToAddOn(selection.addOnOptions[0]),
                  ])
                }
                disabled={selection.addOnOptions.length === 0}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add add-on
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Selection Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="selection-notes">Internal notes</Label>
              <Textarea
                id="selection-notes"
                name="notes"
                defaultValue={selection.notes}
                rows={5}
                className="resize-none"
              />
              <FieldError messages={state.errors?.notes} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Selection Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ReadOnlyMetric label="Current status" value={selection.selectionStatus} />
              <ReadOnlyMetric
                label="Completed"
                value={selection.completedAt ?? "Not completed"}
              />
              <ReadOnlyMetric
                label="Extra photo rate"
                value={selection.extraPhotoUnitPrice}
              />
              <ReadOnlyMetric
                label="Extra photo charge"
                value={formatMoney(extraPhotoCharge)}
              />
              <ReadOnlyMetric
                label="Selected add-ons"
                value={formatMoney(manualAddOnTotal)}
              />
              <ReadOnlyMetric
                label="Selection add-on total"
                value={formatMoney(selectionAddOnTotal)}
              />
              <ReadOnlyMetric
                label="Package adjustment"
                value={
                  selectedPackage?.isCurrent
                    ? selection.packageUpgradeDifference
                    : (selectedPackage?.upgradeDifferenceLabel ?? selection.packageUpgradeDifference)
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Next Financial Action</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="rounded-md border border-border bg-surface-soft p-4 text-sm font-medium text-text-primary">
                {selection.nextRecommendedFinancialAction}
              </p>
              {selection.recommendedPackage ? (
                <p className="text-sm text-text-secondary">
                  Recommended package: {selection.recommendedPackage.name} · {selection.recommendedPackage.upgradeDifferenceLabel}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <div className="flex flex-wrap justify-end gap-2">
            <SelectionSubmitButton
              name="completeSelection"
              value="false"
              disabled={saveDisabled}
              variant="outline"
            >
              <Save className="mr-2 h-4 w-4" />
              Save Selection
            </SelectionSubmitButton>
            <SelectionSubmitButton
              name="completeSelection"
              value="true"
              disabled={saveDisabled || isComplete}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Mark Completed
            </SelectionSubmitButton>
          </div>
        </div>
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

function SelectionSubmitButton({
  children,
  disabled,
  name,
  value,
  variant,
}: {
  children: React.ReactNode;
  disabled: boolean;
  name: string;
  value: string;
  variant?: "default" | "outline";
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name={name}
      value={value}
      variant={variant}
      disabled={disabled || pending}
    >
      {pending ? "Saving..." : children}
    </Button>
  );
}

function DecisionAid({
  title,
  body,
  highlighted = false,
}: {
  title: string;
  body: string;
  highlighted?: boolean;
}) {
  return (
    <div
      className={`rounded-md border p-4 ${
        highlighted
          ? "border-accent bg-accent-soft"
          : "border-border bg-surface-soft"
      }`}
    >
      <p className="text-sm font-semibold text-text-primary">{title}</p>
      <p className="mt-2 text-sm text-text-secondary">{body}</p>
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

function optionToAddOn(option: OrderSelectionWorkflow["addOnOptions"][number] | undefined): OrderAddOn {
  if (!option) return { name: "", price: 0 };
  return {
    productId: option.id,
    name: option.name,
    price: option.price,
  };
}

function findProductIdForAddOn(
  addOn: OrderAddOn,
  options: OrderSelectionWorkflow["addOnOptions"]
): string | undefined {
  return options.find((option) => option.name === addOn.name && option.price === addOn.price)?.id;
}

function formatMoney(value: number): string {
  return `${value.toFixed(3)} KD`;
}
