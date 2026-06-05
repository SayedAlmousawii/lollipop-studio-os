"use client";

import { Prisma } from "@prisma/client";
import { Settings2 } from "lucide-react";
import {
  useMemo,
  useState,
  useTransition,
} from "react";
import {
  stageSessionConfigurationSelectionAction,
  type POSSessionConfigurationStagingActionState,
} from "@/app/orders/[orderId]/sales/actions";
import { formatSignedMoney } from "@/lib/formatting/money";
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
import type { OrderEditModePolicy } from "@/modules/orders/policies/edit-mode-policy";

type ActionState = {
  errors?: Partial<Record<string, string[]>>;
};

export type ConfigureSessionPanelMode =
  | { kind: "draft" }
  | { kind: "commit-staging"; expectedVersion: number }
  | { kind: "locked"; workspaceIsOpen: boolean };

export function ConfigureSessionPanel({
  orderId,
  orderPackageId,
  packageName,
  sessionTypeName,
  mode,
  editPolicies,
  availableConfigurations,
  currentSelections,
}: {
  orderId: string;
  orderPackageId: string;
  packageName: string;
  sessionTypeName: string;
  mode: ConfigureSessionPanelMode;
  editPolicies: {
    operational: OrderEditModePolicy;
    financial: OrderEditModePolicy;
  };
  availableConfigurations: POSAvailableSessionConfiguration[];
  currentSelections: POSSessionConfigurationSelection[];
}) {
  const [commitStagingState, setCommitStagingState] = useState<ActionState>({});
  const [isCommitStagingPending, startCommitStagingTransition] = useTransition();
  const [draftSelections, setDraftSelections] = useState<
    Record<string, SelectionInput | null>
  >(() => buildInitialDraftSelections(currentSelections, mode));
  const [commitDraftVersion, setCommitDraftVersion] = useState(
    mode.kind === "commit-staging" ? mode.expectedVersion : 0
  );
  const sortedConfigurations = useMemo(
    () =>
      [...availableConfigurations].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
      ),
    [availableConfigurations]
  );
  const editableConfigurationIds = new Set(
    sortedConfigurations
      .filter(() => mode.kind === "commit-staging")
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
    ...(commitStagingState.errors?._global ?? []),
  ];

  if (mode.kind === "locked" && mode.workspaceIsOpen) {
    return (
      <div className="rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
        {editPolicies.financial.userFacingMessage}
      </div>
    );
  }

  function submitCommitStagingEdits() {
    if (mode.kind !== "commit-staging") return;
    setCommitStagingState({});
    startCommitStagingTransition(async () => {
      let currentVersion = commitDraftVersion;
      for (const configuration of sortedConfigurations) {
        const desired = draftSelections[configuration.id] ?? null;
        const baseline = baselineSelection(
          configuration.id,
          currentSelections,
          mode
        );
        if (selectionKey(desired) === selectionKey(baseline)) continue;

        const currentSelection =
          currentSelectionByConfigurationId.get(configuration.id) ?? null;
        const result = await stageSessionConfigurationSelectionAction(
          orderId,
          currentVersion,
          {
            orderPackageId,
            configurationId: configuration.id,
            desired: isSubmittableSelection(desired) ? desired : null,
            existingSelection: currentSelection
              ? {
                  selectionId: currentSelection.selectionId,
                  snapshotLinkedProductId:
                    currentSelection.snapshotLinkedProductId,
                  orderAddOnId: currentSelection.orderAddOnId,
                }
              : null,
          }
        );
        if (result.errors) {
          setCommitStagingState({
            errors: {
              _global: [commitStagingErrorMessage(result)],
            },
          });
          return;
        }
        if (typeof result.version !== "number") {
          setCommitStagingState({
            errors: { _global: ["Draft changed since you opened it. Refresh to see the latest."] },
          });
          return;
        }
        currentVersion = result.version;
        setCommitDraftVersion(result.version);
      }
      console.info(
        JSON.stringify({
          metric: "order_commit.session_configuration_edit_staged_from_sales",
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
        <form className="space-y-4">
          <input type="hidden" name="orderPackageId" value={orderPackageId} />
          <input type="hidden" name="selections" value={serializedSelections} />
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {sortedConfigurations.map((configuration) => {
              const value = draftSelections[configuration.id] ?? null;
              const feeHint = shouldShowFeeHint(mode, configuration)
                ? previewFee(configuration, value)
                : null;
              const isMissing = missingCodes.has(configuration.code);
              const isReadOnly = mode.kind !== "commit-staging";
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
                  </div>
                  {isReadOnly ? (
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
            <p className="text-sm text-text-secondary">
              {editPolicies.financial.userFacingMessage}
            </p>
          ) : null}
          <DialogFooter>
            {mode.kind === "commit-staging" ? (
              <Button
                type="button"
                disabled={isCommitStagingPending || !hasEditableChanges}
                onClick={submitCommitStagingEdits}
              >
                {isCommitStagingPending ? "Staging..." : "Stage Configuration"}
              </Button>
            ) : (
              <Button type="button" variant="outline" disabled>
                Read only
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function shouldShowFeeHint(
  mode: ConfigureSessionPanelMode,
  configuration: POSAvailableSessionConfiguration
): boolean {
  return !(
    mode.kind === "commit-staging" &&
    configuration.financialBehavior === "FINANCIAL"
  );
}

function commitStagingErrorMessage(
  result: POSSessionConfigurationStagingActionState
): string {
  const message = (result.errors?._global ?? []).join(" ");
  if (message.includes("draft.stale") || message.includes("version")) {
    return "Draft changed since you opened it. Refresh to see the latest.";
  }
  if (message.includes("draft.permission")) {
    return "Another user owns this draft. Refresh or coordinate before editing.";
  }
  return message || "Unable to stage session configuration.";
}

function buildInitialDraftSelections(
  currentSelections: POSSessionConfigurationSelection[],
  mode: ConfigureSessionPanelMode
): Record<string, SelectionInput | null> {
  void mode;
  return Object.fromEntries(
    currentSelections.map((selection) => [
      selection.configurationId,
      stripSelectionMetadata(selection),
    ])
  );
}

function baselineSelection(
  configurationId: string,
  currentSelections: POSSessionConfigurationSelection[],
  mode: ConfigureSessionPanelMode
): SelectionInput | null {
  void mode;
  const selection = currentSelections.find(
    (candidate) => candidate.configurationId === configurationId
  );
  return selection ? stripSelectionMetadata(selection) : null;
}

function selectionKey(selection: SelectionInput | null): string {
  return JSON.stringify(selection && isSubmittableSelection(selection) ? selection : null);
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
  if (configuration.pricingMode === "LINKED_PRODUCT") {
    const total = configuration.linkedProductPrice ?? 0;
    return total === 0 ? null : formatSignedMoney(total);
  }
  const result = priceSingleSelection({
    id: configuration.id,
    snapshotConfigurationCode: configuration.code,
    snapshotLabel: configuration.name,
    snapshotPriceDelta:
      configuration.pricingMode === "NONE"
        ? new Prisma.Decimal(0)
        : configuration.pricingMode === "TIERED"
          ? new Prisma.Decimal(option?.priceDelta ?? 0)
          : configuration.inputType === "COUNTER"
            ? new Prisma.Decimal(configuration.counterUnitPrice ?? configuration.fixedPriceDelta ?? 0).mul(
                numericValue ?? new Prisma.Decimal(0)
              )
            : new Prisma.Decimal(configuration.fixedPriceDelta ?? 0),
    snapshotPricingMode: configuration.pricingMode,
    snapshotInputType: configuration.inputType,
    snapshotOptionLabel: option?.label ?? null,
    snapshotLinkedProductId: configuration.linkedProductId,
    numericValue,
  });
  const total = (result.lineDelta ?? new Prisma.Decimal(0)).toNumber();

  if (total === 0) return null;
  return formatSignedMoney(total);
}

function GlobalErrors({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return (
    <div className="rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
      {messages.join(" ")}
    </div>
  );
}
