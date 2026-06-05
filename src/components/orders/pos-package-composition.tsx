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
import { ConfigurationMissingRequiredBadge } from "@/components/session-configurations/configuration-missing-required-badge";
import { ConfigurationSummaryChip } from "@/components/session-configurations/configuration-summary-chip";
import { ConfigureSessionPanel } from "@/components/session-configurations/configure-session-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  POSPackageLine,
  POSProductOption,
  POSWorkspace,
} from "@/modules/orders/order.types";
import {
  createProjectedPhotoDraft,
  PHOTO_BILLING_MODE_OPTIONS,
  readProjectedPhotoPayload,
  readProjectedPhotoPreview,
  type DraftPOSCompositionProjection,
  type PhotoLineDraft,
  type PhotoPayload,
  type POSCompositionPackageItemProjection,
  type POSCompositionPackageLineProjection,
} from "@/modules/orders/composition/projections";
import type {
  HandlerResult,
  POSCompositionHandlers,
  POSMutationActionState,
} from "@/modules/orders/pos-handlers.types";
import type {
  OrderEditModePolicy,
  POSPackageCompositionEditPolicies,
} from "@/modules/orders/policies/edit-mode-policy";
import { formatMoney } from "@/lib/formatting/money";

type POSPackageCompositionBaseProps = {
  workspace: POSWorkspace;
  composition: DraftPOSCompositionProjection;
  handlers: POSCompositionHandlers;
  editPolicies: POSPackageCompositionEditPolicies;
};

type POSPackageCompositionProps =
  | (POSPackageCompositionBaseProps & {
      configurePanelMode?: "auto";
      expectedVersion?: never;
    })
  | (POSPackageCompositionBaseProps & {
      configurePanelMode: "commit-staging";
      expectedVersion: number;
    });

export function POSPackageComposition(props: POSPackageCompositionProps) {
  const { workspace, composition, handlers, editPolicies } = props;
  const configurePanelMode = props.configurePanelMode ?? "auto";
  const commitStagingVersion =
    props.configurePanelMode === "commit-staging" ? props.expectedVersion : null;
  const workspaceLineById = new Map(
    workspace.packageLines.map((line) => [line.id, line])
  );
  const packagePriceTotal = composition.totals.packageBaseTotal;

  return (
    <Card id="package-composition">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PackageOpen className="h-4 w-4 text-accent" />
          Package Composition
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <PolicyNotice policy={editPolicies.packageTierChange} />

        <div className="space-y-4">
          {composition.packageLines.map((line) => {
            const workspaceLine = workspaceLineById.get(line.orderPackageId);
            if (process.env.NODE_ENV !== "production" && !workspaceLine) {
              console.error(
                `[POSPackageComposition] projected line ${line.orderPackageId} has no matching workspace line`
              );
            }
            return (
            <div key={line.id} className="space-y-4 rounded-md border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-text-primary">
                    {line.packageName}
                  </p>
                  <p className="text-sm text-text-secondary">
                    {line.sessionTypeName} · {line.includedPhotoCount} included photos · {formatMoney(line.packagePrice)}
                  </p>
                </div>
                {workspaceLine ? (
                  <>
                    <PackageUpgradeDialog
                      orderId={workspace.orderId}
                      line={workspaceLine}
                      handlers={handlers}
                      policy={editPolicies.packageTierChange}
                    />
                    <ConfigureSessionPanel
                      key={configureSessionPanelKey({
                        mode: configurePanelMode,
                        line: workspaceLine,
                        expectedVersion:
                          commitStagingVersion ?? undefined,
                      })}
                      orderId={workspace.orderId}
                      orderPackageId={workspaceLine.id}
                      packageName={line.packageName}
                      sessionTypeName={line.sessionTypeName ?? workspaceLine.sessionTypeName}
                      mode={
                        commitStagingVersion !== null
                            ? {
                                kind: "commit-staging",
                                expectedVersion: commitStagingVersion,
                              }
                          : editPolicies.sessionConfigurationFinancialEdit
                                .shouldOpenAdjustmentWorkspace
                            ? {
                                kind: "locked",
                                workspaceIsOpen:
                                  editPolicies.sessionConfigurationFinancialEdit
                                    .openWorkspaceIsActive,
                              }
                            : { kind: "draft" }
                      }
                      editPolicies={{
                        operational:
                          editPolicies.sessionConfigurationOperationalEdit,
                        financial: editPolicies.sessionConfigurationFinancialEdit,
                      }}
                      availableConfigurations={workspaceLine.availableConfigurations}
                      currentSelections={workspaceLine.currentSelections}
                    />
                  </>
                ) : null}
              </div>
              {workspaceLine &&
              (workspaceLine.sessionConfigurationSummary.length > 0 ||
                workspaceLine.missingRequiredConfigurationCodes.length > 0) ? (
                <div className="space-y-2">
                  <ConfigurationSummaryChip
                    summary={workspaceLine.sessionConfigurationSummary}
                    subtotal={workspaceLine.sessionConfigurationSubtotal}
                  />
                  <ConfigurationMissingRequiredBadge
                    missingRequiredConfigurationCodes={
                      workspaceLine.missingRequiredConfigurationCodes
                    }
                    availableConfigurations={workspaceLine.availableConfigurations}
                  />
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-2">
                {line.packageItems.map((item) => (
                  <DeliverableCard
                    key={item.id}
                    item={item}
                    orderId={workspace.orderId}
                    orderPackageId={line.orderPackageId}
                    productOptions={workspace.productOptions}
                    handlers={handlers}
                    policy={editPolicies.packageItemUpgrade}
                  />
                ))}
                {line.packageItems.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border p-4 text-sm text-text-secondary">
                    Structured package deliverables will appear here when available.
                  </div>
                ) : null}
              </div>
            </div>
          );
          })}
          {composition.packageLines.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-4 text-sm text-text-secondary">
              Structured package deliverables will appear here when available.
            </div>
          ) : null}
        </div>

        <div className="space-y-2 border-t border-border pt-4 text-sm">
          <MoneyLine
            label="Package price"
            value={formatMoney(packagePriceTotal)}
            strong
          />
        </div>
      </CardContent>
    </Card>
  );
}

function configureSessionPanelKey(input: {
  mode: "auto" | "commit-staging";
  line: POSPackageLine;
  expectedVersion?: number;
}): string {
  return JSON.stringify({
    id: input.line.id,
    mode: input.mode,
    expectedVersion: input.expectedVersion,
    currentSelections: input.line.currentSelections,
  });
}

export function POSPhotoCountCard({
  workspace,
  composition,
  handlers,
  editPolicies,
}: POSPackageCompositionBaseProps) {
  const policy = editPolicies.selectedPhotoCountChange;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Selected Photos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <PolicyNotice policy={policy} />
        <div className="space-y-4">
          {composition.packageLines.map((line) => (
            <POSPhotoLineForm
              key={`${line.id}:${line.selectedPhotoCount}:${line.extraDigitalCount}:${line.extraPrintCount}`}
              orderId={workspace.orderId}
              line={line}
              handlers={handlers}
              policy={policy}
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
  policy,
}: {
  orderId: string;
  line: POSCompositionPackageLineProjection;
  handlers: POSCompositionHandlers;
  policy: OrderEditModePolicy;
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
  const [draft, setDraft] = useState(() => createProjectedPhotoDraft(line));
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
  const preview = readProjectedPhotoPreview(draft, line);
  const canSubmit = policy.isInteractive;
  function commitDraft(nextDraft: PhotoLineDraft) {
    if (!canSubmit) return;
    const resolved = readProjectedPhotoPayload(nextDraft, line.includedPhotoCount);
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
      <input type="hidden" name="orderPackageId" value={line.orderPackageId} />
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
              {line.packageName}
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
            <Label htmlFor={`selectedPhotoCount-${line.orderPackageId}`}>Selected</Label>
            <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
              <div className="w-full lg:max-w-[15rem]">
                <Input
                  id={`selectedPhotoCount-${line.orderPackageId}`}
                  type="number"
                  min={line.includedPhotoCount}
                  step={1}
                  value={draft.selectedPhotoCount}
                  disabled={pending || !canSubmit}
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
                        disabled={pending || !canSubmit}
                        name={`billingMode-${line.orderPackageId}`}
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
                    <Label htmlFor={`splitDigitalCount-${line.orderPackageId}`}>Digital allocation</Label>
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-info/10 text-info">
                        <Monitor className="h-4 w-4" />
                      </div>
                      <div className="w-full max-w-[7rem]">
                        <Input
                          id={`splitDigitalCount-${line.orderPackageId}`}
                          type="number"
                          min={0}
                          max={preview.extraCount}
                          step={1}
                          value={draft.splitDigitalCount}
                          disabled={pending || !canSubmit}
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
                    <Label htmlFor={`splitPrintCount-${line.orderPackageId}`}>Print allocation</Label>
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
                        <Printer className="h-4 w-4" />
                      </div>
                      <div className="w-full max-w-[7rem]">
                        <Input
                          id={`splitPrintCount-${line.orderPackageId}`}
                          type="number"
                          min={0}
                          max={preview.extraCount}
                          step={1}
                          value={draft.splitPrintCount}
                          disabled={pending || !canSubmit}
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
            { name: "orderPackageId", value: line.orderPackageId },
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

function applyBillingModeChange(
  draft: PhotoLineDraft,
  billingMode: PhotoLineDraft["billingMode"],
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
  policy,
}: {
  orderId: string;
  line: POSPackageLine;
  handlers: POSCompositionHandlers;
  policy: OrderEditModePolicy;
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
  const canSubmit = policy.isInteractive;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          disabled={line.packageOptions.length === 0 || !canSubmit}
        >
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
            <Select
              value={selectedPackageId}
              onValueChange={setSelectedPackageId}
              disabled={!canSubmit}
            >
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
            <SubmitButton
              label="Update Package"
              disabled={!selectedPackageId || !canSubmit}
            />
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
  policy,
}: {
  item: POSCompositionPackageItemProjection;
  orderId: string;
  orderPackageId: string;
  productOptions: POSProductOption[];
  handlers: POSCompositionHandlers;
  policy: OrderEditModePolicy;
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
          <p className="mt-1 text-xs uppercase text-text-muted">
            {item.category ?? "Item"}
          </p>
        </div>
        <Badge variant="outline" className="rounded-md">
          {item.quantity}x
        </Badge>
      </div>
      <p className="mt-3 text-sm text-text-secondary">
        {item.quantity}x · {formatMoney(item.unitAmount)}
      </p>
      <ItemUpgradeDialog
        orderId={orderId}
        orderPackageId={orderPackageId}
        item={item}
        options={replacementOptions}
        handlers={handlers}
        policy={policy}
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
  policy,
}: {
  orderId: string;
  orderPackageId: string;
  item: POSCompositionPackageItemProjection;
  options: POSProductOption[];
  handlers: POSCompositionHandlers;
  policy: OrderEditModePolicy;
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
  const disabled = options.length === 0 || !policy.isInteractive;

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
            Select another {(item.category ?? "item").toLowerCase()} product. The price difference is recorded on the order.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="orderPackageId" value={orderPackageId} />
          <input type="hidden" name="packageItemId" value={item.id} />
          <input type="hidden" name="newProductId" value={selectedProductId} />
          <div className="space-y-2">
            <Label htmlFor={`newProductId-${item.id}`}>Replacement product</Label>
            <Select
              value={selectedProductId}
              onValueChange={setSelectedProductId}
              disabled={disabled}
            >
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

  if (result.approval) {
    return {
      kind: "approval-required",
      errors: result.errors,
      payload: result.approval,
    };
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

function PolicyNotice({ policy }: { policy: OrderEditModePolicy }) {
  if (!policy.blockedReason) return null;

  return (
    <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
      <Lock className="mt-0.5 h-4 w-4 shrink-0" />
      {policy.userFacingMessage}
    </div>
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
