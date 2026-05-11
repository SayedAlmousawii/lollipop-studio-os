"use client";

import { Plus, Trash2 } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  createPackage,
  updatePackage,
  type PackageActionState,
  type PackageFormValues,
} from "@/app/packages/actions";
import { DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  GroupedProductOptions,
  ProductOption,
} from "@/modules/products/product.types";

interface PackageCreateFormProps {
  mode: "create";
  packageId?: never;
  productOptions: GroupedProductOptions[];
  defaultValues?: PackageFormValues;
}

interface PackageEditFormProps {
  mode: "edit";
  packageId: string;
  productOptions: GroupedProductOptions[];
  defaultValues: PackageFormValues;
}

type PackageFormProps = PackageCreateFormProps | PackageEditFormProps;

type PackageItemRow = {
  key: string;
  productId: string;
  quantity: string;
  priceSnapshot: string;
};

export function PackageForm({
  mode,
  packageId,
  productOptions,
  defaultValues,
}: PackageFormProps) {
  const action = mode === "edit"
    ? updatePackage.bind(null, packageId)
    : createPackage;
  const initialValues = defaultValues ?? emptyValues();
  const [state, formAction] = useActionState<PackageActionState, FormData>(
    action,
    { values: initialValues }
  );
  const [packagePrice, setPackagePrice] = useState(
    state.values?.price ?? initialValues.price
  );
  const [items, setItems] = useState<PackageItemRow[]>(() =>
    rowsFromValues(state.values ?? initialValues)
  );
  const productById = useMemo(
    () => mapProductOptions(productOptions),
    [productOptions]
  );
  const bundleAdjustment = calculateBundleAdjustment(packagePrice, items);

  function addItem() {
    setItems((current) => [...current, emptyItemRow()]);
  }

  function removeItem(key: string) {
    setItems((current) => current.filter((item) => item.key !== key));
  }

  function updateItem(key: string, patch: Partial<PackageItemRow>) {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item))
    );
  }

  function selectProduct(key: string, productId: string) {
    const product = productById.get(productId);
    updateItem(key, {
      productId,
      priceSnapshot: product
        ? product.canonicalPrice.toFixed(3)
        : "",
    });
  }

  return (
    <form action={formAction} className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
        {state.errors?._global ? (
          <p className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
            {state.errors._global[0]}
          </p>
        ) : null}
        {state.success ? (
          <p className="rounded-md bg-success-soft px-4 py-3 text-sm text-success">
            {state.success}
          </p>
        ) : null}

        <PackageFields
          state={state}
          mode={mode}
          packagePrice={packagePrice}
          onPackagePriceChange={setPackagePrice}
        />

        <div className="space-y-3 rounded-[14px] border border-border bg-surface-soft p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">
                Deliverable Items
              </h3>
              <p className="mt-1 text-xs text-text-secondary">
                At least one item is recommended for a complete package.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addItem}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Add Item
            </Button>
          </div>

          <FieldError messages={state.errors?.items} />

          {items.length === 0 ? (
            <p className="rounded-md border border-border bg-surface px-3 py-4 text-sm text-text-secondary">
              No deliverables selected.
            </p>
          ) : (
            <div className="space-y-3">
              {items.map((item, index) => (
                <PackageItemFields
                  key={item.key}
                  index={index}
                  item={item}
                  productOptions={productOptions}
                  onSelectProduct={selectProduct}
                  onChange={updateItem}
                  onRemove={removeItem}
                />
              ))}
            </div>
          )}

          <div className="flex items-center justify-between rounded-md border border-border bg-surface px-4 py-3">
            <span className="text-sm font-medium text-text-primary">
              Bundle adjustment
            </span>
            <span className="text-sm font-semibold text-text-primary">
              {formatSignedMoney(bundleAdjustment)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border bg-background px-6 py-4">
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Close
          </Button>
        </DialogClose>
        <SubmitButton mode={mode} />
      </div>
    </form>
  );
}

function PackageFields({
  state,
  mode,
  packagePrice,
  onPackagePriceChange,
}: {
  state: PackageActionState;
  mode: "create" | "edit";
  packagePrice: string;
  onPackagePriceChange: (value: string) => void;
}) {
  const { pending } = useFormStatus();

  return (
    <>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="package-name">Name *</Label>
          <Input
            id="package-name"
            name="name"
            defaultValue={state.values?.name ?? ""}
            disabled={pending}
            aria-invalid={state.errors?.name?.length ? true : undefined}
            placeholder="Gold Package"
            required
          />
          <FieldError messages={state.errors?.name} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="package-price">Package price *</Label>
          <Input
            id="package-price"
            name="price"
            value={packagePrice}
            onChange={(event) => onPackagePriceChange(event.target.value)}
            disabled={pending}
            aria-invalid={state.errors?.price?.length ? true : undefined}
            inputMode="decimal"
            placeholder="250.000"
            required
          />
          <FieldError messages={state.errors?.price} />
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="package-photo-count">Photo count *</Label>
          <Input
            id="package-photo-count"
            name="photoCount"
            defaultValue={state.values?.photoCount ?? ""}
            disabled={pending}
            aria-invalid={state.errors?.photoCount?.length ? true : undefined}
            inputMode="numeric"
            placeholder="40"
            required
          />
          <FieldError messages={state.errors?.photoCount} />
        </div>

        {mode === "edit" ? (
          <label className="flex items-center gap-3 self-end rounded-md border border-border px-3 py-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={state.values?.isActive !== ""}
              disabled={pending}
              className="h-4 w-4 rounded border-border"
            />
            Active package
          </label>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="package-description">Description</Label>
        <Textarea
          id="package-description"
          name="description"
          defaultValue={state.values?.description ?? ""}
          disabled={pending}
          aria-invalid={state.errors?.description?.length ? true : undefined}
          placeholder="Optional internal description..."
          rows={3}
        />
        <FieldError messages={state.errors?.description} />
      </div>
    </>
  );
}

function PackageItemFields({
  index,
  item,
  productOptions,
  onSelectProduct,
  onChange,
  onRemove,
}: {
  index: number;
  item: PackageItemRow;
  productOptions: GroupedProductOptions[];
  onSelectProduct: (key: string, productId: string) => void;
  onChange: (key: string, patch: Partial<PackageItemRow>) => void;
  onRemove: (key: string) => void;
}) {
  const { pending } = useFormStatus();

  return (
    <div className="grid gap-3 rounded-md border border-border bg-surface p-3 sm:grid-cols-[minmax(0,1fr)_7rem_9rem_2.5rem]">
      <div className="space-y-2">
        <Label htmlFor={`package-item-product-${index}`}>Product</Label>
        <select
          id={`package-item-product-${index}`}
          name="itemProductId"
          value={item.productId}
          disabled={pending}
          onChange={(event) => onSelectProduct(item.key, event.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-text-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">Select product</option>
          {productOptions.map((group) => (
            <optgroup key={group.category} label={group.categoryLabel}>
              {group.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} ({option.canonicalPriceLabel})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`package-item-quantity-${index}`}>Qty</Label>
        <Input
          id={`package-item-quantity-${index}`}
          name="itemQuantity"
          value={item.quantity}
          disabled={pending}
          inputMode="numeric"
          onChange={(event) =>
            onChange(item.key, { quantity: event.target.value })
          }
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`package-item-price-${index}`}>Snapshot</Label>
        <Input
          id={`package-item-price-${index}`}
          name="itemPriceSnapshot"
          value={item.priceSnapshot}
          disabled={pending}
          inputMode="decimal"
          onChange={(event) =>
            onChange(item.key, { priceSnapshot: event.target.value })
          }
        />
      </div>

      <div className="flex items-end">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 text-danger hover:text-danger"
          onClick={() => onRemove(item.key)}
          disabled={pending}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Remove item</span>
        </Button>
      </div>
    </div>
  );
}

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  const label = mode === "edit" ? "Save Changes" : "Create Package";
  const pendingLabel = mode === "edit" ? "Saving..." : "Creating...";

  return (
    <Button type="submit" disabled={pending} className="min-w-[150px]">
      {pending ? pendingLabel : label}
    </Button>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-xs text-danger">{messages[0]}</p>;
}

function rowsFromValues(values: PackageFormValues): PackageItemRow[] {
  return values.items.map((item, index) => ({
    key: `${item.productId || "item"}-${index}`,
    productId: item.productId,
    quantity: item.quantity,
    priceSnapshot: item.priceSnapshot,
  }));
}

function emptyValues(): PackageFormValues {
  return {
    name: "",
    price: "",
    photoCount: "",
    description: "",
    items: [],
  };
}

function emptyItemRow(): PackageItemRow {
  return {
    key: crypto.randomUUID(),
    productId: "",
    quantity: "1",
    priceSnapshot: "",
  };
}

function mapProductOptions(
  groups: GroupedProductOptions[]
): Map<string, ProductOption> {
  const options = new Map<string, ProductOption>();
  for (const group of groups) {
    for (const option of group.options) {
      options.set(option.id, option);
    }
  }
  return options;
}

function calculateBundleAdjustment(
  packagePrice: string,
  items: PackageItemRow[]
): number {
  const price = parseMoney(packagePrice);
  const itemTotal = items.reduce(
    (total, item) =>
      total + parseMoney(item.priceSnapshot) * parseWholeNumber(item.quantity),
    0
  );
  return price - itemTotal;
}

function parseMoney(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseWholeNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function formatSignedMoney(value: number): string {
  const sign = value < 0 ? "-" : "+";
  return `${sign}${Math.abs(value).toFixed(3)} KD`;
}
