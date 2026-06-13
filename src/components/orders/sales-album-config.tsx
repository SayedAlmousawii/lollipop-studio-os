"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { BookOpen, Image as ImageIcon, Palette } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";

export type SalesAlbumView = {
  id: string;
  orderPackageId: string | null;
  backingLineId: string;
  productLabel: string;
  pageCount: number;
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

export type UpdateSalesAlbumFinishingAction = (
  orderId: string,
  input: SalesAlbumFinishingInput
) => Promise<SalesAlbumFinishingActionState>;

export function SalesAlbumCard({
  orderId,
  album,
  updateFinishingAction,
}: {
  orderId: string;
  album: SalesAlbumView;
  updateFinishingAction: UpdateSalesAlbumFinishingAction;
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
              {album.pageCount} {album.pageCount === 1 ? "page" : "pages"} ·{" "}
              {finishingSummary(album)}
            </p>
            <p className="text-[11px] text-text-muted">
              Size and pages are read-only here.
            </p>
          </div>
        </div>
        <SalesAlbumConfigureDialog
          orderId={orderId}
          album={album}
          updateFinishingAction={updateFinishingAction}
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
  triggerLabel = "Configure",
}: {
  orderId: string;
  album: SalesAlbumView;
  updateFinishingAction: UpdateSalesAlbumFinishingAction;
  triggerLabel?: string;
}) {
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
            Finishing saves immediately. Size and pages stage for commit, and
            editing them is coming next.
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
                {album.pageCount} {album.pageCount === 1 ? "page" : "pages"}
              </p>
              <p className="mt-3 text-xs text-text-muted">
                Size and pages stage for commit. Editing them is coming next.
              </p>
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

function finishingSummary(album: SalesAlbumView): string {
  const parts = [album.coverMaterial, album.threadColor, album.layout]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : "finishing not set";
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
