import {
  ORDER_COMMIT_DRAFT_STAGING_DOMAIN,
} from "./order-commit-draft.constants";
import type {
  OrderCommitDraftLineTarget,
  OrderCommitDraftStagingChange,
} from "./order-commit-draft.types";
import type { SelectionInput } from "@/modules/session-configurations/session-configuration-selection.schema";

type SessionConfigurationStagingChange = Extract<
  OrderCommitDraftStagingChange,
  { domain: typeof ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION }
>;

export type SalesSessionConfigurationExistingSelection = {
  selectionId: string;
  snapshotLinkedProductId?: string | null;
  orderAddOnId?: string | null;
};

export type SalesSessionConfigurationSelectionStagingInput = {
  orderPackageId: string;
  configurationId: string;
  desired: SelectionInput | null;
  existingSelection?: SalesSessionConfigurationExistingSelection | null;
};

export function buildSalesSessionConfigurationStagingChange(
  input: SalesSessionConfigurationSelectionStagingInput
): SessionConfigurationStagingChange {
  const base = {
    domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION,
    parentPackageTarget: packageTarget(input.orderPackageId),
    configurationId: input.configurationId,
    ...existingSelectionFields(input.existingSelection),
  };

  if (!input.desired || !isSubmittableSelection(input.desired)) {
    return {
      ...base,
      action: "REMOVE",
    };
  }

  return {
    ...base,
    action: "UPSERT",
    ...selectionValueFields(input.desired),
  };
}

function packageTarget(orderPackageId: string): OrderCommitDraftLineTarget {
  return {
    stableKey: `order-package:${orderPackageId}`,
    orderEntityId: orderPackageId,
  };
}

function existingSelectionFields(
  selection: SalesSessionConfigurationExistingSelection | null | undefined
): Pick<SessionConfigurationStagingChange, "target" | "linkedProduct"> {
  if (!selection) return {};

  const linkedProduct =
    selection.snapshotLinkedProductId && selection.orderAddOnId
      ? {
          productId: selection.snapshotLinkedProductId,
          orderAddOnId: selection.orderAddOnId,
        }
      : undefined;

  return {
    target: {
      stableKey: `session-configuration-selection:${selection.selectionId}`,
      orderEntityId: selection.selectionId,
    },
    ...(linkedProduct ? { linkedProduct } : {}),
  };
}

function selectionValueFields(
  selection: SelectionInput
): Pick<SessionConfigurationStagingChange, "optionId" | "numericValue" | "textValue"> {
  switch (selection.kind) {
    case "toggle":
      return {};
    case "select":
      return { optionId: selection.optionId };
    case "number":
      return { numericValue: String(selection.numericValue) };
    case "text":
      return { textValue: selection.textValue };
    case "counter":
      return {
        numericValue: String(selection.numericValue),
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
