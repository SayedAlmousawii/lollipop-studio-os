"use client";

import { useActionState } from "react";
import { useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  ArrowRightLeft,
  CircleCheck,
  Lock,
  Monitor,
  Package2,
  PackageOpen,
  Printer,
  Tags,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReductiveEditApprovalModal } from "@/components/orders/reductive-edit-approval-modal";
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
import type {
  HandlerResult,
  POSCompositionHandlers,
  POSMutationActionState,
} from "@/modules/orders/pos-handlers.types";

interface POSPackageCompositionProps {
  workspace: POSWorkspace;
  handlers: POSCompositionHandlers;
}

export function POSPackageComposition({
  workspace,
  handlers,
}: POSPackageCompositionProps) {
  const locked = workspace.invoice?.isLocked ?? false;
  const packagePriceTotal =
    workspace.packageLines.reduce(
      (sum, line) => sum + line.currentPackage.price,
      0
    );

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
            Invoice is locked. Additions issue adjustments; reductions require manager confirmation for a credit note.
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
                  handlers={handlers}
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
                    handlers={handlers}
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

export function POSPhotoCountCard({
  workspace,
  handlers,
}: POSPackageCompositionProps) {
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
            Invoice is locked. Added extras issue adjustments; reductions require manager confirmation for a credit note.
          </div>
        ) : null}
        <div className="space-y-4">
          {workspace.packageLines.map((line) => (
            <POSPhotoLineForm
              key={`${line.id}:${line.selectedPhotoCount}:${line.extraDigitalCount}:${line.extraPrintCount}`}
              orderId={workspace.orderId}
              line={line}
              handlers={handlers}
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
  handlers,
}: {
  orderId: string;
  line: POSPackageLine;
  handlers: POSCompositionHandlers;
}) {
  const [state, formAction, pending] = useHandlerAction(
    handlers.changeSelectedPhotoCount,
    (formData) => ({
      orderPackageId: formDataString(formData, "orderPackageId"),
      selectedPhotoCount: formDataNumber(formData, "selectedPhotoCount"),
      extraDigitalCount: formDataNumber(formData, "extraDigitalCount"),
      extraPrintCount: formDataNumber(formData, "extraPrintCount"),
    })
  );
  const [draft, setDraft] = useState(() => buildPhotoLineDraft(line));
  const [clientErrors, setClientErrors] = useState<POSMutationActionState["errors"]>({});
  const [approvalPayload, setApprovalPayload] =
    useState<PhotoPayload | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const selectedHiddenInputRef = useRef<HTMLInputElement>(null);
  const digitalHiddenInputRef = useRef<HTMLInputElement>(null);
  const printHiddenInputRef = useRef<HTMLInputElement>(null);
  const lastSubmittedPayloadRef = useRef<string | null>(null);
  const currentPayloadKey = createPhotoPayloadKey({
    selectedPhotoCount: line.selectedPhotoCount,
    extraDigitalCount: line.extraDigitalCount,
    extraPrintCount: line.extraPrintCount,
  });
  const preview = getPhotoLinePreview(draft, line);
  function commitDraft(nextDraft: PhotoLineDraft) {
    const resolved = resolvePhotoPayload(nextDraft, line.includedPhotoCount);
    if (resolved.errors) {
      setClientErrors(resolved.errors);
      return;
    }
    const payload = resolved.payload;
    if (!payload) {
      return;
    }

    const payloadKey = createPhotoPayloadKey(payload);
    if (payloadKey === currentPayloadKey) {
      setClientErrors({});
      return;
    }
    if (pending && payloadKey === lastSubmittedPayloadRef.current) {
      return;
    }

    setClientErrors({});
    lastSubmittedPayloadRef.current = payloadKey;
    setApprovalPayload(payload);

    if (
      !formRef.current ||
      !selectedHiddenInputRef.current ||
      !digitalHiddenInputRef.current ||
      !printHiddenInputRef.current
    ) {
      return;
    }

    selectedHiddenInputRef.current.value = String(payload.selectedPhotoCount);
    digitalHiddenInputRef.current.value = String(payload.extraDigitalCount);
    printHiddenInputRef.current.value = String(payload.extraPrintCount);
    formRef.current.requestSubmit();
  }

  return (
    <>
      <form
        ref={formRef}
        action={formAction}
        className="space-y-4 rounded-md border border-border bg-surface-soft p-4"
      >
      <input type="hidden" name="orderPackageId" value={line.id} />
      <input
        ref={selectedHiddenInputRef}
        type="hidden"
        name="selectedPhotoCount"
        defaultValue={line.selectedPhotoCount}
      />
      <input
        ref={digitalHiddenInputRef}
        type="hidden"
        name="extraDigitalCount"
        defaultValue={line.extraDigitalCount}
      />
      <input
        ref={printHiddenInputRef}
        type="hidden"
        name="extraPrintCount"
        defaultValue={line.extraPrintCount}
      />
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-text-muted">
          <Package2 className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-base font-semibold leading-none text-text-primary">
              {line.currentPackage.name}
            </p>
            <Badge
              variant="secondary"
              className="rounded-md px-2 py-0.5 text-[10px] uppercase tracking-wide"
            >
              {line.sessionTypeName}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            {line.includedPhotoCount} included
          </p>
        </div>
      </div>

      <div className="border-t border-border/80 pt-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-[1.2] space-y-2.5">
            <Label htmlFor={`selectedPhotoCount-${line.id}`}>Selected</Label>
            <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
              <div className="w-full lg:max-w-[15rem]">
                <Input
                  id={`selectedPhotoCount-${line.id}`}
                  type="number"
                  min={line.includedPhotoCount}
                  step={1}
                  value={draft.selectedPhotoCount}
                  disabled={pending}
                  onChange={(event) => {
                    setDraft((current) =>
                      syncDraftForSelectedPhotoChange(
                        current,
                        event.target.value,
                        line.includedPhotoCount
                      )
                    );
                  }}
                  onBlur={(event) => {
                    const nextDraft = syncDraftForSelectedPhotoChange(
                      draft,
                      event.target.value,
                      line.includedPhotoCount
                    );
                    setDraft(nextDraft);
                    commitDraft(nextDraft);
                  }}
                />
              </div>
              <p className="max-w-[12rem] text-xs leading-6 text-text-secondary">
                {preview.extraCount === 0
                  ? "No billable extras above the included count."
                  : `${preview.extraCount} ${preview.extraCount === 1 ? "billable photo" : "billable photos"} above the included count.`}
              </p>
            </div>
            <FieldError
              messages={clientErrors?.selectedPhotoCount || state.errors?.selectedPhotoCount}
            />
          </div>

          <div className="hidden xl:block xl:h-28 xl:w-px xl:bg-border/70" />

          <div className="flex-[0.95] space-y-2">
            <Label>Billing mode</Label>
            {preview.extraCount > 0 ? (
              <div className="flex max-w-[20rem] flex-wrap gap-2">
                {PHOTO_BILLING_MODE_OPTIONS.map((option) => {
                  const checked = draft.billingMode === option.value;
                  return (
                    <label
                      key={option.value}
                      className={`cursor-pointer rounded-md border px-4 py-2 text-xs transition ${
                        checked
                          ? "border-accent bg-accent/10 text-text-primary"
                          : "border-border bg-background text-text-secondary"
                      }`}
                    >
                      <input
                        checked={checked}
                        className="sr-only"
                        disabled={pending}
                        name={`billingMode-${line.id}`}
                        type="radio"
                        value={option.value}
                        onChange={() => {
                          const nextDraft = applyBillingModeChange(
                            draft,
                            option.value,
                            preview.extraCount
                          );
                          setDraft(nextDraft);
                          commitDraft(nextDraft);
                        }}
                      />
                      {option.label}
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-10 items-center rounded-md border border-dashed border-border px-3 text-sm text-text-secondary">
                No extra-photo billing needed.
              </div>
            )}
          </div>

          {preview.extraCount > 0 && draft.billingMode === "SPLIT" ? (
            <>
              <div className="hidden xl:block xl:h-28 xl:w-px xl:bg-border/70" />
              <div className="flex-[0.9] space-y-2">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={`splitDigitalCount-${line.id}`}>Digital allocation</Label>
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-info/10 text-info">
                        <Monitor className="h-4 w-4" />
                      </div>
                      <div className="w-full max-w-[7rem]">
                        <Input
                          id={`splitDigitalCount-${line.id}`}
                          type="number"
                          min={0}
                          max={preview.extraCount}
                          step={1}
                          value={draft.splitDigitalCount}
                          disabled={pending}
                          onChange={(event) => {
                            setDraft((current) =>
                              applySplitAllocationChange(
                                current,
                                "DIGITAL",
                                event.target.value,
                                preview.extraCount
                              )
                            );
                          }}
                          onBlur={(event) => {
                            const nextDraft = applySplitAllocationChange(
                              draft,
                              "DIGITAL",
                              event.target.value,
                              preview.extraCount
                            );
                            setDraft(nextDraft);
                            commitDraft(nextDraft);
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`splitPrintCount-${line.id}`}>Print allocation</Label>
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
                        <Printer className="h-4 w-4" />
                      </div>
                      <div className="w-full max-w-[7rem]">
                        <Input
                          id={`splitPrintCount-${line.id}`}
                          type="number"
                          min={0}
                          max={preview.extraCount}
                          step={1}
                          value={draft.splitPrintCount}
                          disabled={pending}
                          onChange={(event) => {
                            setDraft((current) =>
                              applySplitAllocationChange(
                                current,
                                "PRINT",
                                event.target.value,
                                preview.extraCount
                              )
                            );
                          }}
                          onBlur={(event) => {
                            const nextDraft = applySplitAllocationChange(
                              draft,
                              "PRINT",
                              event.target.value,
                              preview.extraCount
                            );
                            setDraft(nextDraft);
                            commitDraft(nextDraft);
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-[11px] text-text-secondary">
                      {preview.allocationStatus}
                    </p>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="border-t border-border/80 pt-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-warning-soft text-warning">
              <Tags className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-primary">{preview.compactSummary}</p>
              <p className="mt-1 text-xs text-text-secondary">
                {preview.detailSummary}
              </p>
            </div>
          </div>
          <div className="xl:border-l xl:border-border/70 xl:pl-4">
            <PhotoLineSaveStatus pending={pending} />
          </div>
        </div>
      </div>
        <GlobalError messages={state.errors?._global} />
      </form>
      {handlers.shouldPromptInlineApproval ? (
        <ReductiveEditApprovalModal
          orderId={orderId}
          action="update-selected-photo-count"
          approval={state.payload}
          hiddenFields={[
            { name: "orderPackageId", value: line.id },
            {
              name: "selectedPhotoCount",
              value: approvalPayload?.selectedPhotoCount ?? line.selectedPhotoCount,
            },
            {
              name: "extraDigitalCount",
              value: approvalPayload?.extraDigitalCount ?? line.extraDigitalCount,
            },
            {
              name: "extraPrintCount",
              value: approvalPayload?.extraPrintCount ?? line.extraPrintCount,
            },
          ]}
        />
      ) : null}
    </>
  );
}

const PHOTO_BILLING_MODE_OPTIONS = [
  { value: "DIGITAL", label: "Digital" },
  { value: "PRINT", label: "Print" },
  { value: "SPLIT", label: "Split" },
] as const;

type PhotoBillingMode = (typeof PHOTO_BILLING_MODE_OPTIONS)[number]["value"];

interface PhotoLineDraft {
  selectedPhotoCount: string;
  billingMode: PhotoBillingMode;
  splitDigitalCount: string;
  splitPrintCount: string;
}

type PhotoPayload = {
  selectedPhotoCount: number;
  extraDigitalCount: number;
  extraPrintCount: number;
};

function buildPhotoLineDraft(line: POSPackageLine): PhotoLineDraft {
  return {
    selectedPhotoCount: String(line.selectedPhotoCount),
    billingMode: resolveBillingMode(line),
    splitDigitalCount: String(line.extraDigitalCount),
    splitPrintCount: String(line.extraPrintCount),
  };
}

function resolveBillingMode(line: POSPackageLine): PhotoBillingMode {
  if (line.extraDigitalCount > 0 && line.extraPrintCount > 0) {
    return "SPLIT";
  }
  if (line.extraPrintCount > 0) {
    return "PRINT";
  }
  return "DIGITAL";
}

function applyBillingModeChange(
  draft: PhotoLineDraft,
  billingMode: PhotoBillingMode,
  extraCount: number
): PhotoLineDraft {
  if (billingMode === "DIGITAL") {
    return {
      ...draft,
      billingMode,
      splitDigitalCount: String(extraCount),
      splitPrintCount: "0",
    };
  }

  if (billingMode === "PRINT") {
    return {
      ...draft,
      billingMode,
      splitDigitalCount: "0",
      splitPrintCount: String(extraCount),
    };
  }

  return {
    ...draft,
    billingMode,
    splitDigitalCount: "0",
    splitPrintCount: String(extraCount),
  };
}

function getPhotoLinePreview(draft: PhotoLineDraft, line: POSPackageLine) {
  const selectedPhotoCount = parseDraftCount(draft.selectedPhotoCount) ?? 0;
  const extraCount = Math.max(selectedPhotoCount - line.includedPhotoCount, 0);
  const resolved = resolvePhotoPayload(draft, line.includedPhotoCount);
  const extraDigitalCount = resolved.payload?.extraDigitalCount ?? 0;
  const extraPrintCount = resolved.payload?.extraPrintCount ?? 0;
  const extraPhotoTotal =
    extraDigitalCount * line.extraDigitalUnitPrice +
    extraPrintCount * line.extraPrintUnitPrice;
  const activeModeLabel =
    extraCount === 0
      ? "No extras"
      : draft.billingMode === "DIGITAL"
        ? "Digital"
        : draft.billingMode === "PRINT"
          ? "Print"
          : "Split";
  const allocationStatus =
    draft.billingMode !== "SPLIT" || extraCount === 0
      ? ""
      : `Split keeps ${extraCount} extras allocated across digital and print.`;

  return {
    extraCount,
    allocationStatus,
    compactSummary:
      extraCount === 0
        ? "No extra-photo charges"
        : `${extraCount} ${extraCount === 1 ? "extra" : "extras"} · ${activeModeLabel} · ${formatKD(extraPhotoTotal)}`,
    detailSummary:
      extraCount === 0
        ? "No digital or print extras are saved for this line."
        : `Digital ${extraDigitalCount} x ${formatKD(line.extraDigitalUnitPrice)} · Print ${extraPrintCount} x ${formatKD(line.extraPrintUnitPrice)} · Total ${formatKD(extraPhotoTotal)}`,
  };
}

function syncDraftForSelectedPhotoChange(
  draft: PhotoLineDraft,
  selectedPhotoCount: string,
  includedPhotoCount: number
): PhotoLineDraft {
  const previousSelectedPhotoCount = parseDraftCount(draft.selectedPhotoCount) ?? includedPhotoCount;
  const previousExtraCount = Math.max(previousSelectedPhotoCount - includedPhotoCount, 0);
  const nextSelectedPhotoCount = parseDraftCount(selectedPhotoCount) ?? includedPhotoCount;
  const nextExtraCount = Math.max(nextSelectedPhotoCount - includedPhotoCount, 0);

  if (nextExtraCount === previousExtraCount) {
    return {
      ...draft,
      selectedPhotoCount,
    };
  }

  return {
    selectedPhotoCount,
    billingMode: nextExtraCount > 0 ? "PRINT" : draft.billingMode,
    splitDigitalCount: "0",
    splitPrintCount: String(nextExtraCount),
  };
}

function applySplitAllocationChange(
  draft: PhotoLineDraft,
  driver: "DIGITAL" | "PRINT",
  nextValue: string,
  extraCount: number
): PhotoLineDraft {
  const normalizedValue = normalizeAllocationInput(nextValue, extraCount);
  const driverCount = parseDraftCount(normalizedValue) ?? 0;
  const remainder = Math.max(extraCount - driverCount, 0);

  if (driver === "DIGITAL") {
    return {
      ...draft,
      splitDigitalCount: normalizedValue,
      splitPrintCount: String(remainder),
    };
  }

  return {
    ...draft,
    splitDigitalCount: String(remainder),
    splitPrintCount: normalizedValue,
  };
}

function normalizeAllocationInput(value: string, extraCount: number): string {
  const parsed = parseDraftCount(value);
  if (parsed === null) {
    return "0";
  }

  return String(Math.min(parsed, extraCount));
}

function resolvePhotoPayload(
  draft: PhotoLineDraft,
  includedPhotoCount: number
): {
  payload?: {
    selectedPhotoCount: number;
    extraDigitalCount: number;
    extraPrintCount: number;
  };
  errors?: POSMutationActionState["errors"];
} {
  const selectedPhotoCount = parseDraftCount(draft.selectedPhotoCount);
  if (selectedPhotoCount === null) {
    return {
      errors: { selectedPhotoCount: ["Selected photos are required"] },
    };
  }
  if (selectedPhotoCount < includedPhotoCount) {
    return {
      errors: {
        selectedPhotoCount: [
          `Selected photos cannot be below the ${includedPhotoCount} included photos`,
        ],
      },
    };
  }

  const extraCount = Math.max(selectedPhotoCount - includedPhotoCount, 0);
  if (extraCount === 0) {
    return {
      payload: {
        selectedPhotoCount,
        extraDigitalCount: 0,
        extraPrintCount: 0,
      },
    };
  }

  if (draft.billingMode === "DIGITAL") {
    return {
      payload: {
        selectedPhotoCount,
        extraDigitalCount: extraCount,
        extraPrintCount: 0,
      },
    };
  }

  if (draft.billingMode === "PRINT") {
    return {
      payload: {
        selectedPhotoCount,
        extraDigitalCount: 0,
        extraPrintCount: extraCount,
      },
    };
  }

  const extraDigitalCount = parseDraftCount(draft.splitDigitalCount);
  const extraPrintCount = parseDraftCount(draft.splitPrintCount);
  if (extraDigitalCount === null || extraPrintCount === null) {
    return {
      errors: {
        extraDigitalCount: ["Split allocations are required for both media types"],
      },
    };
  }
  if (extraDigitalCount + extraPrintCount !== extraCount) {
    return {
      errors: {
        extraDigitalCount: [
          `Split allocations must total ${extraCount} derived extra photos`,
        ],
      },
    };
  }

  return {
    payload: {
      selectedPhotoCount,
      extraDigitalCount,
      extraPrintCount,
    },
  };
}

function parseDraftCount(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function createPhotoPayloadKey(payload: {
  selectedPhotoCount: number;
  extraDigitalCount: number;
  extraPrintCount: number;
}): string {
  return `${payload.selectedPhotoCount}:${payload.extraDigitalCount}:${payload.extraPrintCount}`;
}

function PhotoLineSaveStatus({ pending }: { pending: boolean }) {
  return (
    <div aria-live="polite" className="flex items-center gap-3 text-xs text-text-secondary">
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-success/30 bg-success/10 text-success">
        <CircleCheck className="h-5 w-5" />
      </div>
      <span>{pending ? "Saving..." : "Autosaves on blur or mode change"}</span>
    </div>
  );
}

function PackageUpgradeDialog({
  orderId,
  line,
  handlers,
}: {
  orderId: string;
  line: POSPackageLine;
  handlers: POSCompositionHandlers;
}) {
  const [selectedPackageId, setSelectedPackageId] = useState(
    line.currentPackage.id ?? line.packageOptions[0]?.id ?? ""
  );
  const [state, formAction] = useHandlerAction(
    handlers.changePackageTier,
    (formData) => ({
      orderPackageId: formDataString(formData, "orderPackageId"),
      toPackageRefId: formDataString(formData, "packageId"),
    })
  );
  const packageSelectId = `packageId-${line.id}`;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={line.packageOptions.length === 0}>
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
            <SubmitButton label="Update Package" disabled={!selectedPackageId} />
          </DialogFooter>
        </form>
        {handlers.shouldPromptInlineApproval ? (
          <ReductiveEditApprovalModal
            orderId={orderId}
            action="update-package"
            approval={state.payload}
            hiddenFields={[
              { name: "orderPackageId", value: line.id },
              { name: "packageId", value: selectedPackageId },
            ]}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DeliverableCard({
  item,
  orderId,
  orderPackageId,
  productOptions,
  handlers,
}: {
  item: POSPackageItem;
  orderId: string;
  orderPackageId: string;
  productOptions: POSProductOption[];
  handlers: POSCompositionHandlers;
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
        handlers={handlers}
      />
    </div>
  );
}

function ItemUpgradeDialog({
  orderId,
  orderPackageId,
  item,
  options,
  handlers,
}: {
  orderId: string;
  orderPackageId: string;
  item: POSPackageItem;
  options: POSProductOption[];
  handlers: POSCompositionHandlers;
}) {
  const [selectedProductId, setSelectedProductId] = useState(options[0]?.id ?? "");
  const [state, formAction] = useHandlerAction(
    handlers.upgradePackageItem,
    (formData) => ({
      orderPackageId: formDataString(formData, "orderPackageId"),
      packageItemId: formDataString(formData, "packageItemId"),
      toProductId: formDataString(formData, "newProductId"),
      quantity: item.quantity,
    })
  );
  const disabled = options.length === 0;

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
        {handlers.shouldPromptInlineApproval ? (
          <ReductiveEditApprovalModal
            orderId={orderId}
            action="upgrade-package-item"
            approval={state.payload}
            hiddenFields={[
              { name: "orderPackageId", value: orderPackageId },
              { name: "packageItemId", value: item.id },
              { name: "newProductId", value: selectedProductId },
            ]}
          />
        ) : null}
      </DialogContent>
    </Dialog>
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

function formDataNumber(formData: FormData, field: string): number {
  const value = formDataString(formData, field);
  return Number(value);
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
