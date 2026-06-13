"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { BookOpen, Image as ImageIcon, Palette, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import type { POSMutationActionState } from "@/modules/orders/pos-handlers.types";
import type { OrderEditModePolicy } from "@/modules/orders/policies/edit-mode-policy";

export type SalesAlbumView = {
  id: string;
  orderPackageId: string | null;
  sourceType: "PACKAGE" | "ADDON";
  backingLineKind: "PACKAGE_ITEM" | "ORDER_PACKAGE_ITEM_UPGRADE" | "ORDER_ADD_ON";
  backingLineId: string;
  packageItemId: string | null;
  currentProductId: string | null;
  productLabel: string;
  extraPages: number;
  quantity: number;
  coverMaterial: string | null;
  threadColor: string | null;
  layout: string | null;
  coverText: string | null;
  coverImageRef: string | null;
  instructions: string | null;
};

export type SalesAlbumFinishingInput = {
  id: string;
  coverMaterial?: string | null;
  threadColor?: string | null;
  layout?: string | null;
  coverText?: string | null;
  coverImageRef?: string | null;
  instructions?: string | null;
};

export type SalesAlbumFinishingActionState = {
  errors?: Partial<Record<keyof SalesAlbumFinishingInput | "_global", string[]>>;
  success?: string;
};

export type SalesAlbumStagingActionState = POSMutationActionState & {
  version?: number;
};

export type UpdateSalesAlbumFinishingAction = (
  orderId: string,
  input: SalesAlbumFinishingInput
) => Promise<SalesAlbumFinishingActionState>;

export type SalesAlbumProductOption = {
  id: string;
  name: string;
  priceLabel: string;
};

export type StageAlbumExtraPagesAction = (
  orderId: string,
  expectedVersion: number,
  input: {
    albumId: string;
    orderPackageId: string | null;
    sourceType: SalesAlbumView["sourceType"];
    requestedExtraPages: number;
  }
) => Promise<SalesAlbumStagingActionState>;

export type StageAlbumSizeSwapAction = (
  orderId: string,
  expectedVersion: number,
  input: {
    albumId: string;
    orderPackageId: string | null;
    sourceType: SalesAlbumView["sourceType"];
    backingLineKind: SalesAlbumView["backingLineKind"];
    backingLineId: string;
    packageItemId: string | null;
    currentProductId: string | null;
    toProductId: string;
    quantity: number;
  }
) => Promise<SalesAlbumStagingActionState>;

export type AddStandaloneAlbumAction = (
  orderId: string,
  expectedVersion: number,
  input: { productId: string }
) => Promise<SalesAlbumStagingActionState>;

export function SalesAlbumCard({
  orderId,
  album,
  updateFinishingAction,
  expectedVersion,
  albumProductOptions = [],
  extraPagesPolicy,
  sizePolicy,
  stageExtraPagesAction,
  stageSizeSwapAction,
}: {
  orderId: string;
  album: SalesAlbumView;
  updateFinishingAction: UpdateSalesAlbumFinishingAction;
  expectedVersion: number;
  albumProductOptions?: SalesAlbumProductOption[];
  extraPagesPolicy?: OrderEditModePolicy;
  sizePolicy?: OrderEditModePolicy;
  stageExtraPagesAction?: StageAlbumExtraPagesAction;
  stageSizeSwapAction?: StageAlbumSizeSwapAction;
}) {
  return (
    <div className="rounded-[10px] border border-border bg-surface-soft p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 gap-3">
          <AlbumCover album={album} />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold text-text-primary">
              {album.productLabel}
            </p>
            <p className="text-xs text-text-secondary">
              {album.extraPages} extra{" "}
              {album.extraPages === 1 ? "page" : "pages"} ·{" "}
              {finishingSummary(album)}
            </p>
            <p className="text-[11px] text-text-muted">
              Size and pages stage for commit.
            </p>
          </div>
        </div>
        <SalesAlbumConfigureDialog
          orderId={orderId}
          album={album}
          updateFinishingAction={updateFinishingAction}
          expectedVersion={expectedVersion}
          albumProductOptions={albumProductOptions}
          extraPagesPolicy={extraPagesPolicy}
          sizePolicy={sizePolicy}
          stageExtraPagesAction={stageExtraPagesAction}
          stageSizeSwapAction={stageSizeSwapAction}
          triggerLabel="Configure album"
        />
      </div>
    </div>
  );
}

export function SalesAlbumConfigureDialog({
  orderId,
  album,
  updateFinishingAction,
  expectedVersion,
  albumProductOptions = [],
  extraPagesPolicy,
  sizePolicy,
  stageExtraPagesAction,
  stageSizeSwapAction,
  triggerLabel = "Configure",
}: {
  orderId: string;
  album: SalesAlbumView;
  updateFinishingAction: UpdateSalesAlbumFinishingAction;
  expectedVersion: number;
  albumProductOptions?: SalesAlbumProductOption[];
  extraPagesPolicy?: OrderEditModePolicy;
  sizePolicy?: OrderEditModePolicy;
  stageExtraPagesAction?: StageAlbumExtraPagesAction;
  stageSizeSwapAction?: StageAlbumSizeSwapAction;
  triggerLabel?: string;
}) {
  const [draftVersion, setDraftVersion] = useState(expectedVersion);
  const [state, formAction] = useActionState<SalesAlbumFinishingActionState, FormData>(
    async (_previousState, formData) =>
      updateFinishingAction(orderId, {
        id: album.id,
        coverMaterial: nullableFormText(formData, "coverMaterial"),
        threadColor: nullableFormText(formData, "threadColor"),
        layout: nullableFormText(formData, "layout"),
        coverText: nullableFormText(formData, "coverText"),
        coverImageRef: nullableFormText(formData, "coverImageRef"),
        instructions: nullableFormText(formData, "instructions"),
      }),
    {}
  );
  const [pagesState, pagesAction] = useActionState<
    SalesAlbumStagingActionState,
    FormData
  >(
    async (_previousState, formData) => {
      if (!stageExtraPagesAction) {
        return { kind: "error", errors: { _global: ["Page staging is unavailable."] } };
      }
      const result = await stageExtraPagesAction(orderId, draftVersion, {
        albumId: album.id,
        orderPackageId: album.orderPackageId,
        sourceType: album.sourceType,
        requestedExtraPages: formDataNumber(formData, "extraPages"),
      });
      if (result.version !== undefined) setDraftVersion(result.version);
      return result;
    },
    {}
  );
  const [selectedProductId, setSelectedProductId] = useState(
    album.currentProductId ?? ""
  );
  const [sizeState, sizeAction] = useActionState<
    SalesAlbumStagingActionState,
    FormData
  >(
    async (_previousState, formData) => {
      if (!stageSizeSwapAction) {
        return { kind: "error", errors: { _global: ["Size staging is unavailable."] } };
      }
      const result = await stageSizeSwapAction(orderId, draftVersion, {
        albumId: album.id,
        orderPackageId: album.orderPackageId,
        sourceType: album.sourceType,
        backingLineKind: album.backingLineKind,
        backingLineId: album.backingLineId,
        packageItemId: album.packageItemId,
        currentProductId: album.currentProductId,
        toProductId: formDataString(formData, "productId"),
        quantity: album.quantity,
      });
      if (result.version !== undefined) setDraftVersion(result.version);
      return result;
    },
    {}
  );
  const canEditPages = Boolean(stageExtraPagesAction && extraPagesPolicy?.isInteractive);
  const canEditSize = Boolean(
    stageSizeSwapAction &&
      sizePolicy?.isInteractive &&
      albumProductOptions.length > 0
  );

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="shrink-0">
          <Palette className="h-4 w-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Configure album</DialogTitle>
          <DialogDescription>
            Size and pages stage for commit. Finishing saves immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
          <div className="space-y-3">
            <AlbumCover album={album} large />
            <div className="rounded-[10px] border border-border bg-surface-soft p-3">
              <p className="text-[11px] font-semibold uppercase text-text-muted">
                Specifications
              </p>
              <p className="mt-2 text-sm font-medium text-text-primary">
                {album.productLabel}
              </p>
              <p className="mt-1 text-sm text-text-secondary">
                {album.extraPages} extra{" "}
                {album.extraPages === 1 ? "page" : "pages"}
              </p>
              <p className="mt-3 text-xs text-text-muted">
                Size and pages stage for commit.
              </p>
              <div className="mt-4 space-y-4 border-t border-border pt-4">
                <form action={pagesAction} className="space-y-2">
                  <Label htmlFor={`extraPages-${album.id}`}>Extra pages</Label>
                  <Input
                    id={`extraPages-${album.id}`}
                    name="extraPages"
                    type="number"
                    min={0}
                    step={1}
                    defaultValue={album.extraPages}
                    disabled={!canEditPages}
                  />
                  <PolicyNotice policy={extraPagesPolicy} />
                  <GlobalError messages={pagesState.errors?._global} />
                  <AlbumStagingSubmitButton
                    label="Stage pages"
                    disabled={!canEditPages}
                  />
                </form>

                <form action={sizeAction} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Ruler className="h-4 w-4 text-accent" />
                    <Label htmlFor={`productId-${album.id}`}>
                      Change album product / size
                    </Label>
                  </div>
                  <input type="hidden" name="productId" value={selectedProductId} />
                  <Select
                    value={selectedProductId}
                    onValueChange={setSelectedProductId}
                    disabled={!canEditSize}
                  >
                    <SelectTrigger id={`productId-${album.id}`}>
                      <SelectValue placeholder="Select album product..." />
                    </SelectTrigger>
                    <SelectContent>
                      {albumProductOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.name} · {option.priceLabel}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <PolicyNotice policy={sizePolicy} />
                  <GlobalError messages={sizeState.errors?._global} />
                  <AlbumStagingSubmitButton
                    label="Stage size"
                    disabled={!canEditSize || !selectedProductId}
                  />
                </form>
              </div>
            </div>
          </div>

          <form action={formAction} className="space-y-4">
            <div className="rounded-[10px] border border-border bg-surface p-4">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-accent" />
                <div>
                  <p className="text-sm font-semibold text-text-primary">
                    Finishing
                  </p>
                  <p className="text-xs text-text-secondary">
                    These operational details save immediately.
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <AlbumTextField
                  id={`coverMaterial-${album.id}`}
                  name="coverMaterial"
                  label="Cover material"
                  defaultValue={album.coverMaterial}
                  error={state.errors?.coverMaterial}
                />
                <AlbumTextField
                  id={`threadColor-${album.id}`}
                  name="threadColor"
                  label="Thread color"
                  defaultValue={album.threadColor}
                  error={state.errors?.threadColor}
                />
                <AlbumTextField
                  id={`layout-${album.id}`}
                  name="layout"
                  label="Layout"
                  defaultValue={album.layout}
                  error={state.errors?.layout}
                />
                <AlbumTextField
                  id={`coverText-${album.id}`}
                  name="coverText"
                  label="Cover text"
                  defaultValue={album.coverText}
                  error={state.errors?.coverText}
                />
                <AlbumTextField
                  id={`coverImageRef-${album.id}`}
                  name="coverImageRef"
                  label="Cover image ref"
                  defaultValue={album.coverImageRef}
                  error={state.errors?.coverImageRef}
                />
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor={`instructions-${album.id}`}>Instructions</Label>
                  <Textarea
                    id={`instructions-${album.id}`}
                    name="instructions"
                    defaultValue={album.instructions ?? ""}
                    rows={4}
                  />
                  <FieldError messages={state.errors?.instructions} />
                </div>
              </div>
            </div>

            <GlobalError messages={state.errors?._global} />
            {state.success ? (
              <p className="text-sm text-success">{state.success}</p>
            ) : null}
            <DialogFooter>
              <AlbumSubmitButton />
            </DialogFooter>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AlbumCover({
  album,
  large = false,
}: {
  album: SalesAlbumView;
  large?: boolean;
}) {
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-[10px] border border-border bg-gradient-to-br from-accent-soft via-surface to-info-soft ${
        large ? "h-[180px] w-full" : "h-[88px] w-[88px]"
      }`}
    >
      <div className="absolute inset-0 flex items-center justify-center px-3 text-center">
        <span className="line-clamp-3 text-sm font-semibold text-text-primary">
          {album.coverText || "Album"}
        </span>
      </div>
      <div className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-md bg-surface/80 text-accent-dark">
        <ImageIcon className="h-3.5 w-3.5" />
      </div>
      {album.coverImageRef ? (
        <span className="absolute bottom-2 right-2 max-w-[80%] truncate rounded-sm bg-surface/85 px-2 py-1 text-[10px] font-medium text-text-secondary">
          {album.coverImageRef}
        </span>
      ) : null}
    </div>
  );
}

function AlbumTextField({
  id,
  name,
  label,
  defaultValue,
  error,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue: string | null;
  error?: string[];
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} defaultValue={defaultValue ?? ""} />
      <FieldError messages={error} />
    </div>
  );
}

function AlbumSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving..." : "Save finishing"}
    </Button>
  );
}

function AlbumStagingSubmitButton({
  label,
  disabled,
}: {
  label: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={disabled || pending}>
      {pending ? "Staging..." : label}
    </Button>
  );
}

function finishingSummary(album: SalesAlbumView): string {
  const parts = [album.coverMaterial, album.threadColor, album.layout]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : "finishing not set";
}

function formDataString(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

function formDataNumber(formData: FormData, field: string): number {
  const value = Number(formDataString(formData, field));
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function nullableFormText(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-sm text-danger">{messages[0]}</p>;
}

function GlobalError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-sm text-danger">{messages[0]}</p>;
}

function PolicyNotice({ policy }: { policy?: OrderEditModePolicy }) {
  if (!policy?.blockedReason) return null;

  return (
    <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
      {policy.userFacingMessage}
    </p>
  );
}
