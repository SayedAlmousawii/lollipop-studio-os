"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  createProduct,
  updateProduct,
  type ProductActionState,
} from "@/app/products/actions";
import { DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PRODUCT_CATEGORY_LABELS,
  PRODUCT_CATEGORY_OPTIONS,
} from "@/modules/products/product.constants";

interface ProductFormProps {
  mode: "create" | "edit";
  productId?: string;
  defaultValues?: ProductActionState["values"];
}

export function ProductForm({
  mode,
  productId,
  defaultValues,
}: ProductFormProps) {
  const action =
    mode === "edit" && productId
      ? updateProduct.bind(null, productId)
      : createProduct;
  const [state, formAction] = useActionState<ProductActionState, FormData>(
    action,
    { values: defaultValues ?? emptyValues() }
  );

  return (
    <form action={formAction} className="space-y-5">
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

      <ProductFields state={state} showStatus={mode === "edit"} />

      <div className="flex items-center justify-end gap-3 pt-2">
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

function ProductFields({
  state,
  showStatus,
}: {
  state: ProductActionState;
  showStatus: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="product-name">Name *</Label>
          <Input
            id="product-name"
            name="name"
            defaultValue={state.values?.name ?? ""}
            disabled={pending}
            aria-invalid={state.errors?.name?.length ? true : undefined}
            placeholder="Premium Album"
            required
          />
          <FieldError messages={state.errors?.name} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="product-category">Category *</Label>
          <select
            id="product-category"
            name="category"
            defaultValue={state.values?.category ?? "ALBUM"}
            disabled={pending}
            aria-invalid={state.errors?.category?.length ? true : undefined}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-text-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            required
          >
            {PRODUCT_CATEGORY_OPTIONS.map((category) => (
              <option key={category} value={category}>
                {PRODUCT_CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
          <FieldError messages={state.errors?.category} />
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="product-price">Canonical price *</Label>
          <Input
            id="product-price"
            name="canonicalPrice"
            defaultValue={state.values?.canonicalPrice ?? ""}
            disabled={pending}
            aria-invalid={
              state.errors?.canonicalPrice?.length ? true : undefined
            }
            inputMode="decimal"
            placeholder="80.000"
            required
          />
          <FieldError messages={state.errors?.canonicalPrice} />
        </div>

        {showStatus ? (
          <label className="flex items-center gap-3 self-end rounded-md border border-border px-3 py-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={state.values?.isActive !== ""}
              disabled={pending}
              className="h-4 w-4 rounded border-border"
            />
            Active product
          </label>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="product-description">Description</Label>
        <Textarea
          id="product-description"
          name="description"
          defaultValue={state.values?.description ?? ""}
          disabled={pending}
          aria-invalid={state.errors?.description?.length ? true : undefined}
          placeholder="Optional internal description..."
          rows={4}
        />
        <FieldError messages={state.errors?.description} />
      </div>
    </>
  );
}

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  const label = mode === "edit" ? "Save Changes" : "Create Product";
  const pendingLabel = mode === "edit" ? "Saving..." : "Creating...";

  return (
    <Button type="submit" disabled={pending} className="min-w-[140px]">
      {pending ? pendingLabel : label}
    </Button>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-xs text-danger">{messages[0]}</p>;
}

function emptyValues(): ProductActionState["values"] {
  return {
    name: "",
    category: "ALBUM",
    canonicalPrice: "",
    description: "",
  };
}
