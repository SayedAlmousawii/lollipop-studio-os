"use client";

import Link from "next/link";
import { Prisma } from "@prisma/client";
import { ExternalLink, Settings2 } from "lucide-react";
import { useActionState, useMemo, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import {
  applySessionConfigurationWorkspaceEditAction,
  configureSessionAction,
} from "@/app/orders/[orderId]/actions";
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
import { SessionConfigurationInputRenderer } from "@/components/session-configurations/session-configuration-input-renderer";
import { priceSingleSelection } from "@/modules/session-configurations/session-configuration-pricing";
import type { SelectionInput } from "@/modules/session-configurations/session-configuration-selection.schema";
import type {
  POSAvailableSessionConfiguration,
  POSSessionConfigurationSelection,
} from "@/modules/orders/order.types";

type ActionState = {
  errors?: Partial<Record<string, string[]>>;
  adjustmentWorkspaceHref?: string;
};

export type PendingSessionConfigurationOverlay = Record<
  string,
  SelectionInput | null
>;

export type ConfigureSessionPanelMode =
  | { kind: "draft" }
  | { kind: "locked"; workspaceIsOpen: boolean }
  | {
      kind: "adjustment";
      workspaceId: string;
      workspaceVersion: number;
      pendingOverlay: PendingSessionConfigurationOverlay;
    };

export function ConfigureSessionPanel({
  orderId,
  orderPackageId,
  packageName,
  sessionTypeName,
  mode,
  availableConfigurations,
  currentSelections,
}: {
  orderId: string;
  orderPackageId: string;
  packageName: string;
  sessionTypeName: string;
  mode: ConfigureSessionPanelMode;
  availableConfigurations: POSAvailableSessionConfiguration[];
  currentSelections: POSSessionConfigurationSelection[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    configureSessionAction.bind(null, orderId),
    {}
  );
  const [adjustmentState, setAdjustmentState] = useState<ActionState>({});
  const [isAdjustmentPending, startAdjustmentTransition] = useTransition();
  const [draftSelections, setDraftSelections] = useState<
    Record<string, SelectionInput | null>
  >(() => buildInitialDraftSelections(currentSelections, mode));
  const sortedConfigurations = useMemo(
    () =>
      [...availableConfigurations].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
      ),
    [availableConfigurations]
  );
  const editableConfigurationIds = new Set(
    sortedConfigurations
      .filter(
        (configuration) =>
          mode.kind === "draft" ||
          mode.kind === "adjustment" ||
          configuration.financialBehavior === "OPERATIONAL"
      )
      .map((configuration) => configuration.id)
  );
  const currentSelectionByConfigurationId = new Map(
    currentSelections.map((selection) => [selection.configurationId, selection])
  );
  const serializedSelections = JSON.stringify(
    sortedConfigurations
      .filter((configuration) => editableConfigurationIds.has(configuration.id))
      .map((configuration) => draftSelections[configuration.id] ?? null)
      .filter((selection): selection is SelectionInput => selection !== null)
      .filter(isSubmittableSelection)
  );
  const initialEditableSelections = JSON.stringify(
    sortedConfigurations
      .filter((configuration) => editableConfigurationIds.has(configuration.id))
      .map((configuration) => baselineSelection(configuration.id, currentSelections, mode))
      .filter((selection): selection is SelectionInput => selection !== null)
      .filter(isSubmittableSelection)
  );
  const hasEditableChanges = serializedSelections !== initialEditableSelections;
  const hasFinancialConfigurations = sortedConfigurations.some(
    (configuration) => configuration.financialBehavior === "FINANCIAL"
  );
  const adjustmentWorkspaceHref =
    state.adjustmentWorkspaceHref ?? `/orders/${orderId}/adjustment-workspace`;
  const missingCodes = new Set(
    sortedConfigurations
      .filter(
        (configuration) =>
          configuration.required &&
          !isSubmittableSelection(draftSelections[configuration.id] ?? null)
      )
      .map((configuration) => configuration.code)
  );
  const globalErrors = [
    ...(state.errors?._global ?? []),
    ...(adjustmentState.errors?._global ?? []),
  ];

  if (mode.kind === "locked" && mode.workspaceIsOpen) {
    return (
      <div className="rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
        An Adjustment Workspace is open — edit configurations there.
      </div>
    );
  }

  function submitAdjustmentEdits() {
    if (mode.kind !== "adjustment") return;
    setAdjustmentState({});
    startAdjustmentTransition(async () => {
      let currentVersion = mode.workspaceVersion;
      for (const configuration of sortedConfigurations) {
        const desired = draftSelections[configuration.id] ?? null;
        const baseline = baselineSelection(
          configuration.id,
          currentSelections,
          mode
        );
        if (selectionKey(desired) === selectionKey(baseline)) continue;

        const result = await applySessionConfigurationWorkspaceEditAction(
          mode.workspaceId,
          currentVersion,
          {
            op: "change_session_configuration_selection",
            orderPackageId,
            configurationId: configuration.id,
            desired: toWorkspaceDesired(desired),
          }
        );
        if (result.errors) {
          const message = (result.errors._global ?? []).join(" ");
          setAdjustmentState({
            errors: {
              _global: [
                message.includes("version")
                  ? "Workspace was updated — refresh and try again."
                  : message || "Unable to stage session configuration.",
              ],
            },
          });
          return;
        }
        if (typeof result.version !== "number") {
          setAdjustmentState({
            errors: { _global: ["Workspace was updated — refresh and try again."] },
          });
          return;
        }
        currentVersion = result.version;
      }
      console.info(
        JSON.stringify({
          metric: "adjustment_workspace.session_configuration_edit_staged_from_ui",
          orderId,
          orderPackageId,
        })
      );
      globalThis.location?.reload();
    });
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={availableConfigurations.length === 0}>
          <Settings2 className="h-4 w-4" />
          Configure Session
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Configure Session</DialogTitle>
          <DialogDescription>
            {packageName} · {sessionTypeName}
          </DialogDescription>
        </DialogHeader>
        <form action={mode.kind === "adjustment" ? undefined : formAction} className="space-y-4">
          <input type="hidden" name="orderPackageId" value={orderPackageId} />
          <input type="hidden" name="selections" value={serializedSelections} />
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {sortedConfigurations.map((configuration) => {
              const value = draftSelections[configuration.id] ?? null;
              const feeHint = previewFee(configuration, value);
              const isMissing = missingCodes.has(configuration.code);
              const isFinancialLocked =
                mode.kind === "locked" &&
                configuration.financialBehavior === "FINANCIAL";
              const currentSelection =
                currentSelectionByConfigurationId.get(configuration.id) ?? null;

              return (
                <div
                  key={configuration.id}
                  className="rounded-md border border-border bg-surface p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <label className="text-sm font-medium text-text-primary">
                      {configuration.name}
                      {configuration.required ? (
                        <span className="ml-1 text-warning">*</span>
                      ) : null}
                    </label>
                    {feeHint ? (
                      <span className="text-xs font-medium text-accent">
                        {feeHint}
                      </span>
                    ) : null}
                    {mode.kind === "adjustment" ? (
                      <span
                        className={
                          configuration.financialBehavior === "FINANCIAL"
                            ? "rounded-md border border-accent/30 bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent"
                            : "rounded-md border border-border bg-surface-soft px-2 py-0.5 text-xs font-medium text-text-secondary"
                        }
                      >
                        {configuration.financialBehavior === "FINANCIAL"
                          ? "Financial — adjustment invoice"
                          : "Operational — no invoice change"}
                      </span>
                    ) : null}
                  </div>
                  {isFinancialLocked ? (
                    <div className="rounded-md border border-border bg-surface-soft px-3 py-2 text-sm text-text-secondary">
                      {selectionDisplay(currentSelection, configuration)}
                    </div>
                  ) : (
                    <SessionConfigurationInputRenderer
                      mode="edit"
                      inputType={configuration.inputType}
                      configurationId={configuration.id}
                      value={value}
                      onChange={(next) =>
                        setDraftSelections((current) => ({
                          ...current,
                          [configuration.id]: next,
                        }))
                      }
                      options={configuration.options.map((option) => ({
                        label: option.label,
                        value: option.id,
                      }))}
                    />
                  )}
                  {isMissing ? (
                    <p className="mt-2 text-xs text-warning">
                      This required setting must be configured before invoicing.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
          <GlobalErrors messages={globalErrors} />
          {mode.kind === "locked" && hasFinancialConfigurations ? (
            <Button asChild variant="outline">
              <Link href={adjustmentWorkspaceHref}>
                <ExternalLink className="h-4 w-4" />
                Edit in Adjustment Workspace
              </Link>
            </Button>
          ) : null}
          <DialogFooter>
            {mode.kind === "adjustment" ? (
              <Button
                type="button"
                disabled={isAdjustmentPending || !hasEditableChanges}
                onClick={submitAdjustmentEdits}
              >
                {isAdjustmentPending ? "Staging..." : "Stage Configuration"}
              </Button>
            ) : (
              <SubmitButton disabled={mode.kind === "locked" && !hasEditableChanges} />
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function buildInitialDraftSelections(
  currentSelections: POSSessionConfigurationSelection[],
  mode: ConfigureSessionPanelMode
): Record<string, SelectionInput | null> {
  const baseline = Object.fromEntries(
    currentSelections.map((selection) => [
      selection.configurationId,
      stripSelectionMetadata(selection),
    ])
  );
  if (mode.kind !== "adjustment") return baseline;
  return { ...baseline, ...mode.pendingOverlay };
}

function baselineSelection(
  configurationId: string,
  currentSelections: POSSessionConfigurationSelection[],
  mode: ConfigureSessionPanelMode
): SelectionInput | null {
  if (mode.kind === "adjustment" && configurationId in mode.pendingOverlay) {
    return mode.pendingOverlay[configurationId] ?? null;
  }
  const selection = currentSelections.find(
    (candidate) => candidate.configurationId === configurationId
  );
  return selection ? stripSelectionMetadata(selection) : null;
}

function selectionKey(selection: SelectionInput | null): string {
  return JSON.stringify(selection && isSubmittableSelection(selection) ? selection : null);
}

function toWorkspaceDesired(
  selection: SelectionInput | null
):
  | null
  | { kind: "toggle" }
  | { kind: "select"; optionId: string }
  | { kind: "number"; numericValue: number }
  | { kind: "text"; textValue: string }
  | { kind: "counter"; numericValue: number; optionId?: string } {
  if (!selection || !isSubmittableSelection(selection)) return null;
  switch (selection.kind) {
    case "toggle":
      return { kind: "toggle" };
    case "select":
      return { kind: "select", optionId: selection.optionId };
    case "number":
      return { kind: "number", numericValue: selection.numericValue };
    case "text":
      return { kind: "text", textValue: selection.textValue };
    case "counter":
      return {
        kind: "counter",
        numericValue: selection.numericValue,
        ...(selection.optionId ? { optionId: selection.optionId } : {}),
      };
  }
}

function selectionDisplay(
  selection: POSSessionConfigurationSelection | null,
  configuration: POSAvailableSessionConfiguration
): string {
  if (!selection) return "Not selected";
  switch (selection.kind) {
    case "toggle":
      return "Selected";
    case "select":
      return (
        selection.snapshotLabel ||
        configuration.options.find((option) => option.id === selection.optionId)
          ?.label ||
        "Selected"
      );
    case "number":
      return String(selection.numericValue);
    case "text":
      return selection.textValue;
    case "counter": {
      if (!selection.optionId) return String(selection.numericValue);
      const optionLabel =
        selection.snapshotLabel ||
        configuration.options.find((option) => option.id === selection.optionId)
          ?.label;
      return optionLabel
        ? `${selection.numericValue} · ${optionLabel}`
        : String(selection.numericValue);
    }
  }
}

function stripSelectionMetadata(
  selection: POSSessionConfigurationSelection
): SelectionInput {
  switch (selection.kind) {
    case "toggle":
      return {
        configurationId: selection.configurationId,
        kind: "toggle",
      };
    case "select":
      return {
        configurationId: selection.configurationId,
        kind: "select",
        optionId: selection.optionId,
      };
    case "number":
      return {
        configurationId: selection.configurationId,
        kind: "number",
        numericValue: selection.numericValue,
      };
    case "text":
      return {
        configurationId: selection.configurationId,
        kind: "text",
        textValue: selection.textValue,
      };
    case "counter":
      return {
        configurationId: selection.configurationId,
        kind: "counter",
        numericValue: selection.numericValue,
        ...(selection.optionId ? { optionId: selection.optionId } : {}),
      };
  }
}

function isSubmittableSelection(selection: SelectionInput | null): selection is SelectionInput {
  if (!selection) return false;
  if (selection.kind === "text") return selection.textValue.trim().length > 0;
  if (selection.kind === "number") return Number.isFinite(selection.numericValue);
  if (selection.kind === "counter") {
    return Number.isFinite(selection.numericValue) && selection.numericValue > 0;
  }
  return true;
}

function previewFee(
  configuration: POSAvailableSessionConfiguration,
  selection: SelectionInput | null
): string | null {
  if (!selection) return null;

  const option =
    "optionId" in selection && selection.optionId
      ? configuration.options.find((candidate) => candidate.id === selection.optionId)
      : null;
  const numericValue =
    "numericValue" in selection ? new Prisma.Decimal(selection.numericValue) : null;
  const result = priceSingleSelection({
    id: configuration.id,
    snapshotConfigurationCode: configuration.code,
    snapshotLabel: configuration.name,
    snapshotPriceDelta:
      configuration.pricingMode === "NONE"
        ? new Prisma.Decimal(0)
        : configuration.pricingMode === "TIERED"
          ? new Prisma.Decimal(option?.priceDelta ?? 0)
          : configuration.pricingMode === "LINKED_PRODUCT"
            ? new Prisma.Decimal(configuration.linkedProductPrice ?? 0)
            : configuration.inputType === "COUNTER"
              ? new Prisma.Decimal(configuration.counterUnitPrice ?? configuration.fixedPriceDelta ?? 0).mul(
                  numericValue ?? new Prisma.Decimal(0)
                )
              : new Prisma.Decimal(configuration.fixedPriceDelta ?? 0),
    snapshotPricingMode: configuration.pricingMode,
    snapshotInputType: configuration.inputType,
    snapshotLinkProductDisplay: configuration.linkProductDisplay,
    snapshotLinkedProductId: configuration.linkedProductId,
    numericValue,
  });
  const total = (result.lineDelta ?? result.nonLineDelta ?? new Prisma.Decimal(0))
    .toNumber();

  if (total === 0) return null;
  return `+${total.toFixed(3)} KD`;
}

function GlobalErrors({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return (
    <div className="rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
      {messages.join(" ")}
    </div>
  );
}

function SubmitButton({ disabled = false }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? "Saving..." : "Save Configuration"}
    </Button>
  );
}
