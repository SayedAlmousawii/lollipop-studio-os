"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Lock, PackagePlus, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReductiveEditApprovalModal } from "@/components/orders/reductive-edit-approval-modal";
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
  POSAddOn,
  POSAddOnCatalogItem,
  POSProductOption,
  POSWorkspace,
} from "@/modules/orders/order.types";
import type {
  HandlerResult,
  POSAddOnHandlers,
  POSMutationActionState,
} from "@/modules/orders/pos-handlers.types";

const QUICK_ACTIONS: Array<{ label: string; category: string }> = [
  { label: "Add Album", category: "ALBUM" },
  { label: "Add Canvas", category: "CANVAS" },
  { label: "Add Prints", category: "PRINT" },
  { label: "Add Digital", category: "DIGITAL" },
];

interface POSAddOnMarketplaceProps {
  workspace: POSWorkspace;
  handlers: POSAddOnHandlers;
}

export function POSAddOnMarketplace({
  workspace,
  handlers,
}: POSAddOnMarketplaceProps) {
  const locked = workspace.invoice?.isLocked ?? false;
  const addedProductIds = new Set(
    workspace.addOns.flatMap((addOn) => (addOn.productId ? [addOn.productId] : []))
  );
  const addOnCountsByProductId = new Map<string, number>();
  for (const addOn of workspace.addOns) {
    if (!addOn.productId) continue;
    addOnCountsByProductId.set(
      addOn.productId,
      (addOnCountsByProductId.get(addOn.productId) ?? 0) + 1
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4 text-accent" />
            Commercial Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <LockedNotice locked={locked} />
          <div className="flex flex-wrap gap-2">
            {QUICK_ACTIONS.map((action) => (
              <QuickAddDialog
                key={action.category}
                label={action.label}
                category={action.category}
                options={workspace.productOptions}
                handlers={handlers}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PackagePlus className="h-4 w-4 text-accent" />
            Add-On Marketplace
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <LockedNotice locked={locked} />
          {workspace.addOnCatalog.length > 0 ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {workspace.addOnCatalog.map((item) => (
                <CatalogCard
                  key={item.id}
                  orderId={workspace.orderId}
                  item={item}
                  addOn={workspace.addOns.find((current) => current.productId === item.id)}
                  added={addedProductIds.has(item.id)}
                  count={addOnCountsByProductId.get(item.id) ?? 0}
                  handlers={handlers}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-border p-4 text-sm text-text-secondary">
              No marketplace add-ons are configured yet.
            </p>
          )}

          <CurrentAddOns
            orderId={workspace.orderId}
            addOns={workspace.addOns}
            handlers={handlers}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function QuickAddDialog({
  label,
  category,
  options,
  handlers,
}: {
  label: string;
  category: string;
  options: POSProductOption[];
  handlers: POSAddOnHandlers;
}) {
  const categoryOptions = useMemo(
    () => options.filter((option) => option.category === category),
    [category, options]
  );
  const [selectedProductId, setSelectedProductId] = useState(categoryOptions[0]?.id ?? "");
  const [state, formAction] = useHandlerAction(
    handlers.addAddOn,
    (formData) => ({
      productId: formDataString(formData, "productId"),
      quantity: 1,
    })
  );
  const disabled = categoryOptions.length === 0;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          <Plus className="h-4 w-4" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            Add a standalone {category.toLowerCase()} item at its catalog price.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="productId" value={selectedProductId} />
          <div className="space-y-2">
            <Label htmlFor={`productId-${category}`}>Product</Label>
            <Select value={selectedProductId} onValueChange={setSelectedProductId}>
              <SelectTrigger id={`productId-${category}`}>
                <SelectValue placeholder="Select product..." />
              </SelectTrigger>
              <SelectContent>
                {categoryOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name} · {option.canonicalPriceLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError messages={state.errors?.productId} />
          </div>
          <GlobalError messages={state.errors?._global} />
          <DialogFooter>
            <SubmitButton label="Add Item" disabled={disabled || !selectedProductId} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CatalogCard({
  orderId,
  item,
  addOn,
  added,
  count,
  handlers,
}: {
  orderId: string;
  item: POSAddOnCatalogItem;
  addOn?: POSAddOn;
  added: boolean;
  count: number;
  handlers: POSAddOnHandlers;
}) {
  const [addState, addAction] = useHandlerAction(
    handlers.addAddOn,
    (formData) => ({
      productId: formDataString(formData, "productId"),
      quantity: 1,
    })
  );
  const [removeState, removeAction] = useHandlerAction(
    handlers.removeAddOn,
    (formData) => ({
      addOnId: formDataString(formData, "addOnId"),
    })
  );

  return (
    <div className="min-w-44 rounded-md border border-border bg-surface-soft p-4">
      <div className="min-h-20 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-text-primary">{item.name}</p>
          {added ? (
            <Badge variant="outline" className="rounded-md">
              Added x{count}
            </Badge>
          ) : null}
        </div>
        <p className="text-xs uppercase text-text-muted">{item.category}</p>
        <p className="text-sm font-semibold text-text-primary">+{item.priceLabel}</p>
      </div>
      <div className="mt-4 space-y-2">
        <form action={addAction} className="space-y-2">
          <input type="hidden" name="productId" value={item.id} />
          <SubmitButton label={added ? "Add Another" : "Add"} />
          <GlobalError messages={addState.errors?._global} />
        </form>
        {added && addOn ? (
          <>
            <form action={removeAction} className="space-y-2">
              <input type="hidden" name="addOnId" value={addOn.addOnRowId} />
              <SubmitButton label="Remove One" variant="ghost" icon="trash" />
              <GlobalError messages={removeState.errors?._global} />
            </form>
            {handlers.shouldPromptInlineApproval ? (
              <ReductiveEditApprovalModal
                orderId={orderId}
                action="remove-add-on"
                approval={removeState.payload}
                hiddenFields={[{ name: "addOnId", value: addOn.addOnRowId }]}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function CurrentAddOns({
  orderId,
  addOns,
  handlers,
}: {
  orderId: string;
  addOns: POSAddOn[];
  handlers: POSAddOnHandlers;
}) {
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <h3 className="text-sm font-medium text-text-primary">Current add-ons</h3>
      {addOns.length > 0 ? (
        <div className="space-y-2">
          {addOns.map((addOn) => (
            <CurrentAddOnRow
              key={addOn.id}
              orderId={orderId}
              addOn={addOn}
              handlers={handlers}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-border p-4 text-sm text-text-secondary">
          No standalone add-ons are attached to this order yet.
        </p>
      )}
    </div>
  );
}

function CurrentAddOnRow({
  orderId,
  addOn,
  handlers,
}: {
  orderId: string;
  addOn: POSAddOn;
  handlers: POSAddOnHandlers;
}) {
  const [state, formAction] = useHandlerAction(
    handlers.removeAddOn,
    (formData) => ({
      addOnId: formDataString(formData, "addOnId"),
    })
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
      <div>
        <p className="font-medium text-text-primary">{addOn.name}</p>
        <GlobalError messages={state.errors?._global} />
      </div>
      <div className="flex items-center gap-2">
        <span className="font-medium tabular-nums text-text-primary">{addOn.priceLabel}</span>
        <form action={formAction} className="space-y-2">
          <input type="hidden" name="addOnId" value={addOn.addOnRowId} />
          <SubmitIconButton />
        </form>
        {handlers.shouldPromptInlineApproval ? (
          <ReductiveEditApprovalModal
            orderId={orderId}
            action="remove-add-on"
            approval={state.payload}
            hiddenFields={[{ name: "addOnId", value: addOn.addOnRowId }]}
          />
        ) : null}
      </div>
    </div>
  );
}

function useHandlerAction<TInput>(
  handler: (input: TInput) => Promise<HandlerResult>,
  readInput: (formData: FormData) => TInput
) {
  return useActionState<POSMutationActionState, FormData>(
    async (_previousState, formData) =>
      actionStateFromHandlerResult(await handler(readInput(formData))),
    {}
  );
}

function actionStateFromHandlerResult(
  result: HandlerResult
): POSMutationActionState {
  if (result.ok) {
    return { kind: "success" };
  }

  if (result.approval) {
    return {
      kind: "approval-required",
      errors: result.errors,
      payload: result.approval,
    };
  }

  return { kind: "error", errors: result.errors };
}

function formDataString(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

function LockedNotice({ locked }: { locked: boolean }) {
  if (!locked) return null;

  return (
    <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
      <Lock className="mt-0.5 h-4 w-4 shrink-0" />
      Invoice is locked. Additions issue adjustments; removals require manager confirmation for a credit note.
    </div>
  );
}

function SubmitButton({
  label,
  disabled,
  variant = "outline",
  icon,
}: {
  label: string;
  disabled?: boolean;
  variant?: "outline" | "ghost";
  icon?: "trash";
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" variant={variant} disabled={disabled || pending}>
      {icon === "trash" ? <Trash2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
      {pending ? "Saving..." : label}
    </Button>
  );
}

function SubmitIconButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      size="icon"
      variant="ghost"
      disabled={disabled || pending}
      aria-label="Remove add-on"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-sm text-danger">{messages[0]}</p>;
}

function GlobalError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-sm text-danger">{messages[0]}</p>;
}
