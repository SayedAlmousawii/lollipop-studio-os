import {
  ORDER_COMMIT_DRAFT_STAGING_DOMAIN,
} from "./order-commit-draft.constants";
import {
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
} from "./order-commit.constants";
import type {
  OrderCommitDraftLineTarget,
  OrderCommitDraftStagingChange,
} from "./order-commit-draft.types";
import type { OrderCommitSnapshotV1 } from "./order-commit.types";
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
  existingSnapshotTarget?: OrderCommitDraftLineTarget | null;
};

export function buildSalesSessionConfigurationStagingChange(
  input: SalesSessionConfigurationSelectionStagingInput
): SessionConfigurationStagingChange {
  const base = {
    domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION,
    parentPackageTarget: packageTarget(input.orderPackageId),
    configurationId: input.configurationId,
    ...existingSelectionFields(
      input.existingSelection,
      input.existingSnapshotTarget
    ),
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

export function withSalesSessionConfigurationSnapshotTarget(
  input: SalesSessionConfigurationSelectionStagingInput,
  snapshot: OrderCommitSnapshotV1
): SalesSessionConfigurationSelectionStagingInput {
  return {
    ...input,
    existingSnapshotTarget: findSalesSessionConfigurationSnapshotTarget(
      input,
      snapshot
    ),
  };
}

export function findSalesSessionConfigurationSnapshotTarget(
  input: Pick<
    SalesSessionConfigurationSelectionStagingInput,
    "orderPackageId" | "configurationId"
  >,
  snapshot: OrderCommitSnapshotV1
): OrderCommitDraftLineTarget | null {
  const matches = snapshot.lines.filter(
    (line) =>
      line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION &&
      line.parentOrderPackageId === input.orderPackageId &&
      line.catalogEntityId === input.configurationId
  );
  if (matches.length > 1) {
    throw new Error(
      `OrderCommitDraft staging failed: package ${input.orderPackageId} has multiple session configuration selections for configuration ${input.configurationId}.`
    );
  }
  const line = matches[0];
  if (!line) return null;
  return {
    stableKey: line.stableKey,
    lineId: line.lineId,
  };
}

function packageTarget(orderPackageId: string): OrderCommitDraftLineTarget {
  return {
    stableKey: `order-package:${orderPackageId}`,
    orderEntityId: orderPackageId,
  };
}

function existingSelectionFields(
  selection: SalesSessionConfigurationExistingSelection | null | undefined,
  snapshotTarget: OrderCommitDraftLineTarget | null | undefined
): Pick<SessionConfigurationStagingChange, "target" | "linkedProduct"> {
  if (!selection && !snapshotTarget) return {};

  const linkedProduct =
    selection?.snapshotLinkedProductId && selection.orderAddOnId
      ? {
          productId: selection.snapshotLinkedProductId,
          orderAddOnId: selection.orderAddOnId,
        }
      : undefined;

  return {
    ...(snapshotTarget ? { target: snapshotTarget } : {}),
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
