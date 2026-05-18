"use client";

import Link from "next/link";
import { Prisma } from "@prisma/client";
import { ExternalLink, Settings2 } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { configureSessionAction } from "@/app/orders/[orderId]/actions";
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
  mode: "draft" | "locked";
  availableConfigurations: POSAvailableSessionConfiguration[];
  currentSelections: POSSessionConfigurationSelection[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    configureSessionAction.bind(null, orderId),
    {}
  );
  const [draftSelections, setDraftSelections] = useState<
    Record<string, SelectionInput | null>
  >(() =>
    Object.fromEntries(
      currentSelections.map((selection) => [
        selection.configurationId,
        stripSelectionMetadata(selection),
      ])
    )
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
      .filter(
        (configuration) =>
          mode === "draft" || configuration.financialBehavior === "OPERATIONAL"
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
      .map((configuration) =>
        currentSelectionByConfigurationId.get(configuration.id) ?? null
      )
      .filter((selection): selection is POSSessionConfigurationSelection => selection !== null)
      .map(stripSelectionMetadata)
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
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="orderPackageId" value={orderPackageId} />
          <input type="hidden" name="selections" value={serializedSelections} />
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {sortedConfigurations.map((configuration) => {
              const value = draftSelections[configuration.id] ?? null;
              const feeHint = previewFee(configuration, value);
              const isMissing = missingCodes.has(configuration.code);
              const isFinancialLocked =
                mode === "locked" &&
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
          <GlobalErrors messages={state.errors?._global} />
          {mode === "locked" && hasFinancialConfigurations ? (
            <Button asChild variant="outline">
              <Link href={adjustmentWorkspaceHref}>
                <ExternalLink className="h-4 w-4" />
                Edit in Adjustment Workspace
              </Link>
            </Button>
          ) : null}
          <DialogFooter>
            <SubmitButton disabled={mode === "locked" && !hasEditableChanges} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
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
