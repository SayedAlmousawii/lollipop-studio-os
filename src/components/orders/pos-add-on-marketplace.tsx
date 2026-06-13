"use client";

import { useMemo, useRef, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  ChevronDown,
  ChevronRight,
  Lock,
  PackagePlus,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SalesAlbumConfigureDialog,
  type SalesAlbumView,
  type UpdateSalesAlbumFinishingAction,
} from "@/components/orders/sales-album-config";
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
  POSAddOnCatalogItem,
  POSWorkspace,
} from "@/modules/orders/order.types";
import type {
  POSAddOnMarketplaceCurrentAddOnProjection,
  POSAddOnMarketplaceProductStateProjection,
  POSAddOnMarketplaceProjection,
} from "@/modules/orders/composition/projections";
import type {
  HandlerResult,
  POSAddOnHandlers,
  POSMutationActionState,
} from "@/modules/orders/pos-handlers.types";
import type {
  OrderEditModePolicy,
  POSAddOnEditPolicies,
} from "@/modules/orders/policies/edit-mode-policy";
import { formatMoney } from "@/lib/formatting/money";

const QUICK_ACTIONS: Array<{ label: string; category: string }> = [
  { label: "Add Album", category: "ALBUM" },
  { label: "Add Canvas", category: "CANVAS" },
  { label: "Add Prints", category: "PRINT" },
  { label: "Add Digital", category: "DIGITAL" },
];

interface POSAddOnMarketplaceProps {
  workspace: POSWorkspace;
  marketplace: POSAddOnMarketplaceProjection;
  handlers: POSAddOnHandlers;
  editPolicies: POSAddOnEditPolicies;
  standaloneAlbums?: SalesAlbumView[];
  updateAlbumFinishingAction?: UpdateSalesAlbumFinishingAction;
}

export function POSAddOnMarketplace({
  workspace,
  marketplace,
  handlers,
  editPolicies,
  standaloneAlbums = [],
  updateAlbumFinishingAction,
}: POSAddOnMarketplaceProps) {
  const addFlowRef = useRef<HTMLDivElement>(null);
  const productStateById = new Map(
    marketplace.productStates.map((state) => [state.productId, state])
  );
  const standaloneAlbumByBackingLineId = new Map(
    standaloneAlbums.map((album) => [album.backingLineId, album])
  );

  function focusAddFlow() {
    addFlowRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    addFlowRef.current?.focus({ preventScroll: true });
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
          <PolicyNotice policy={editPolicies.addAddOn} />
          <div className="flex flex-wrap gap-2">
            {QUICK_ACTIONS.map((action) => (
              <QuickAddDialog
                key={action.category}
                label={action.label}
                category={action.category}
                options={workspace.addOnCatalog}
                handlers={handlers}
                policy={editPolicies.addAddOn}
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
          <div
            ref={addFlowRef}
            tabIndex={-1}
            className="scroll-mt-4 space-y-4 outline-none"
          >
            <PolicyNotice policy={editPolicies.addAddOn} />
            {workspace.addOnCatalog.length > 0 ? (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {workspace.addOnCatalog.map((item) => (
                  <CatalogCard
                    key={item.id}
                    item={item}
                    productState={productStateById.get(item.id) ?? null}
                    handlers={handlers}
                    policies={editPolicies}
                  />
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-border p-4 text-sm text-text-secondary">
                No marketplace add-ons are configured yet.
              </p>
            )}
          </div>

          <CurrentAddOns
            orderId={workspace.orderId}
            addOns={marketplace.currentAddOns}
            handlers={handlers}
            removePolicy={editPolicies.removeAddOn}
            standaloneAlbumByBackingLineId={standaloneAlbumByBackingLineId}
            updateAlbumFinishingAction={updateAlbumFinishingAction}
          />
          <button
            type="button"
            onClick={focusAddFlow}
            className="flex w-full items-center justify-center gap-2 rounded-[14px] border border-dashed border-border bg-transparent p-[18px] text-sm text-text-muted transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent-dark"
          >
            <Plus className="h-4 w-4" />
            <span>Add another package, add-on, or product</span>
          </button>
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
  policy,
}: {
  label: string;
  category: string;
  options: POSAddOnCatalogItem[];
  handlers: POSAddOnHandlers;
  policy: OrderEditModePolicy;
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
  const disabled = categoryOptions.length === 0 || !policy.isInteractive;

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
            <Select
              value={selectedProductId}
              onValueChange={setSelectedProductId}
              disabled={disabled}
            >
              <SelectTrigger id={`productId-${category}`}>
                <SelectValue placeholder="Select product..." />
              </SelectTrigger>
              <SelectContent>
                {categoryOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name} · {option.priceLabel}
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
  item,
  productState,
  handlers,
  policies,
}: {
  item: POSAddOnCatalogItem;
  productState: POSAddOnMarketplaceProductStateProjection | null;
  handlers: POSAddOnHandlers;
  policies: POSAddOnEditPolicies;
}) {
  const added = Boolean(productState);
  const removalOrderAddOnId = productState?.removalOrderAddOnId ?? null;
  const removalOrderAddOnQuantity = productState?.removalOrderAddOnQuantity ?? null;
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
      currentQuantity: optionalFormDataInteger(formData, "currentQuantity"),
    })
  );

  return (
    <div className="min-w-44 rounded-md border border-border bg-surface-soft p-4">
      <div className="min-h-20 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-text-primary">{item.name}</p>
          {added ? (
            <Badge variant="outline" className="rounded-md">
              Added x{productState?.count ?? 0}
            </Badge>
          ) : null}
        </div>
        <p className="text-xs uppercase text-text-muted">{item.category}</p>
        <p className="text-sm font-semibold text-text-primary">+{item.priceLabel}</p>
      </div>
      <div className="mt-4 space-y-2">
        <form action={addAction} className="space-y-2">
          <input type="hidden" name="productId" value={item.id} />
          <SubmitButton
            label={added ? "Add Another" : "Add"}
            disabled={!policies.addAddOn.isInteractive}
          />
          <GlobalError messages={addState.errors?._global} />
        </form>
        {added && removalOrderAddOnId ? (
          <>
            <form action={removeAction} className="space-y-2">
              <input type="hidden" name="addOnId" value={removalOrderAddOnId} />
              {removalOrderAddOnQuantity !== null ? (
                <input
                  type="hidden"
                  name="currentQuantity"
                  value={removalOrderAddOnQuantity}
                />
              ) : null}
              <SubmitButton
                label="Remove One"
                variant="ghost"
                icon="trash"
                disabled={!policies.removeAddOn.isInteractive}
              />
              <GlobalError messages={removeState.errors?._global} />
            </form>
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
  removePolicy,
  standaloneAlbumByBackingLineId,
  updateAlbumFinishingAction,
}: {
  orderId: string;
  addOns: POSAddOnMarketplaceCurrentAddOnProjection[];
  handlers: POSAddOnHandlers;
  removePolicy: OrderEditModePolicy;
  standaloneAlbumByBackingLineId: Map<string, SalesAlbumView>;
  updateAlbumFinishingAction?: UpdateSalesAlbumFinishingAction;
}) {
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <h3 className="text-sm font-medium text-text-primary">Current add-ons</h3>
      {addOns.length > 0 ? (
        <div className="space-y-3">
          {addOns.map((addOn) => (
            <CurrentAddOnRow
              key={addOn.id}
              orderId={orderId}
              addOn={addOn}
              handlers={handlers}
              removePolicy={removePolicy}
              album={
                addOn.orderAddOnId
                  ? standaloneAlbumByBackingLineId.get(addOn.orderAddOnId) ?? null
                  : null
              }
              updateAlbumFinishingAction={updateAlbumFinishingAction}
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
  removePolicy,
  album,
  updateAlbumFinishingAction,
}: {
  orderId: string;
  addOn: POSAddOnMarketplaceCurrentAddOnProjection;
  handlers: POSAddOnHandlers;
  removePolicy: OrderEditModePolicy;
  album: SalesAlbumView | null;
  updateAlbumFinishingAction?: UpdateSalesAlbumFinishingAction;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useHandlerAction(
    handlers.removeAddOn,
    (formData) => ({
      addOnId: formDataString(formData, "addOnId"),
      currentQuantity: optionalFormDataInteger(formData, "currentQuantity"),
    })
  );

  return (
    <article className="overflow-hidden rounded-[14px] border border-border bg-surface">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-border bg-surface-soft text-accent">
            <PackagePlus className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-text-primary">
              {addOn.name}
            </span>
            <span className="mt-1 block text-xs text-text-muted">
              {addOn.currentQuantity}x · {formatMoney(addOn.unitAmount)} each
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-sm font-semibold tabular-nums text-text-primary">
              {formatMoney(addOn.unitAmount)}
            </span>
            <span className="mt-1 block text-[11px] font-semibold uppercase text-text-muted">
              ADD-ON
            </span>
          </span>
          <span className="shrink-0 text-text-muted" aria-hidden="true">
            {open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </span>
        </button>
        {album && updateAlbumFinishingAction ? (
          <SalesAlbumConfigureDialog
            orderId={orderId}
            album={album}
            updateFinishingAction={updateAlbumFinishingAction}
          />
        ) : null}
        {addOn.orderAddOnId ? (
          <form action={formAction} className="shrink-0">
            <input type="hidden" name="addOnId" value={addOn.orderAddOnId} />
            <input
              type="hidden"
              name="currentQuantity"
              value={addOn.currentQuantity}
            />
            <SubmitIconButton disabled={!removePolicy.isInteractive} />
          </form>
        ) : null}
      </div>
      {open ? (
        <div className="space-y-3 border-t border-border bg-surface-soft px-4 py-3 text-sm">
          {album ? (
            <div className="rounded-[10px] border border-border bg-surface px-3 py-2">
              <p className="text-[11px] font-semibold uppercase text-text-muted">
                Album
              </p>
              <p className="mt-1 font-medium text-text-primary">
                {album.productLabel}
              </p>
              <p className="mt-1 text-xs text-text-secondary">
                {album.pageCount} {album.pageCount === 1 ? "page" : "pages"} ·
                finishing saves immediately
              </p>
            </div>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-3">
            <AddOnSummaryCell label="Quantity" value={`${addOn.currentQuantity}x`} />
            <AddOnSummaryCell
              label="Unit"
              value={formatMoney(addOn.unitAmount)}
            />
            <AddOnSummaryCell
              label="Current row"
              value="Ordinary add-on"
            />
          </div>
          <GlobalError messages={state.errors?._global} />
        </div>
      ) : (
        <GlobalError messages={state.errors?._global} />
      )}
    </article>
  );
}

function AddOnSummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-border bg-surface px-3 py-2">
      <p className="text-[11px] font-semibold uppercase text-text-muted">
        {label}
      </p>
      <p className="mt-1 font-medium tabular-nums text-text-primary">{value}</p>
    </div>
  );
}

function useHandlerAction<TInput>(
  handler: (input: TInput) => Promise<HandlerResult>,
  readInput: (formData: FormData) => TInput
) {
  return useActionState<POSMutationActionState, FormData>(
    async (_previousState, formData) => {
      try {
        return actionStateFromHandlerResult(await handler(readInput(formData)));
      } catch (error) {
        return actionStateFromHandlerResult(handlerErrorResult(error));
      }
    },
    {}
  );
}

function actionStateFromHandlerResult(
  result: HandlerResult
): POSMutationActionState {
  if (result.ok) {
    return { kind: "success" };
  }

  return { kind: "error", errors: result.errors };
}

function handlerErrorResult(error: unknown): HandlerResult {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : "Unable to save POS changes";
  return { ok: false, errors: { _global: [message] } };
}

function formDataString(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

function optionalFormDataInteger(
  formData: FormData,
  field: string
): number | undefined {
  const value = formDataString(formData, field);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return undefined;
  return parsed;
}

function PolicyNotice({ policy }: { policy: OrderEditModePolicy }) {
  if (!policy.blockedReason) return null;

  return (
    <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
      <Lock className="mt-0.5 h-4 w-4 shrink-0" />
      {policy.userFacingMessage}
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
