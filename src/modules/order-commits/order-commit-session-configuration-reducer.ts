import { Prisma } from "@prisma/client";
import {
  priceSelections,
  type PricedSelection,
} from "@/modules/session-configurations/session-configuration-pricing";
import {
  ORDER_COMMIT_DRAFT_STAGING_DOMAIN,
} from "./order-commit-draft.constants";
import {
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
} from "./order-commit.constants";
import { normalizeOrderCommitSnapshot } from "./order-commit-snapshot-normalizer";
import type {
  OrderCommitDraftLineTarget,
  OrderCommitDraftStagingChange,
} from "./order-commit-draft.types";
import type {
  OrderCommitSnapshotLineV1,
  OrderCommitSnapshotV1,
} from "./order-commit.types";

type SessionConfigurationStagingChange = Extract<
  OrderCommitDraftStagingChange,
  { domain: typeof ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION }
>;

type LinkedProductIdentity = {
  addOnRef: string;
  orderAddOnId: string | null;
  draftOrderAddOnId: string | null;
};

export type ResolvedOrderCommitDraftSessionConfigurationSelection = {
  configurationId: string;
  optionId: string | null;
  numericValue: string | null;
  textValue: string | null;
  snapshotOptionLabel: string | null;
  snapshotConfigurationCode: string;
  snapshotLabel: string;
  snapshotPriceDelta: number;
  snapshotFinancialBehavior: PricedSelection["snapshotPricingMode"] extends never
    ? never
    : "FINANCIAL" | "OPERATIONAL";
  snapshotInputType: PricedSelection["snapshotInputType"];
  snapshotPricingMode: PricedSelection["snapshotPricingMode"];
  snapshotLinkedProductId: string | null;
};

export type ResolvedOrderCommitDraftLinkedProduct = {
  productId: string;
  label: string;
  unitPrice: number;
  quantity?: number;
  notes?: string | null;
};

export type ReduceOrderCommitDraftSessionConfigurationInput = {
  change: SessionConfigurationStagingChange;
  resolvedSelection?: ResolvedOrderCommitDraftSessionConfigurationSelection;
  resolvedLinkedProduct?: ResolvedOrderCommitDraftLinkedProduct;
};

export function reduceOrderCommitDraftSessionConfiguration(
  snapshot: OrderCommitSnapshotV1,
  input: ReduceOrderCommitDraftSessionConfigurationInput
): OrderCommitSnapshotV1 {
  const parentPackage = resolveParentPackageLine(
    snapshot,
    input.change.parentPackageTarget
  );

  switch (input.change.action) {
    case "UPSERT":
      return upsertSessionConfiguration(snapshot, input, parentPackage);
    case "REMOVE":
      return removeSessionConfiguration(snapshot, input.change, parentPackage);
  }
}

function upsertSessionConfiguration(
  snapshot: OrderCommitSnapshotV1,
  input: ReduceOrderCommitDraftSessionConfigurationInput,
  parentPackage: OrderCommitSnapshotLineV1
): OrderCommitSnapshotV1 {
  const resolvedSelection = input.resolvedSelection;
  const change = input.change;
  if (!resolvedSelection) {
    throw new Error(
      "OrderCommit session configuration reducer failed: UPSERT requires resolved selection data."
    );
  }
  if (resolvedSelection.configurationId !== change.configurationId) {
    throw new Error(
      `OrderCommit session configuration reducer failed: resolved configuration ${resolvedSelection.configurationId} does not match requested configuration ${change.configurationId}.`
    );
  }

  const existingSelection = resolveExistingSessionConfigurationLine(
    snapshot,
    change,
    parentPackage
  );
  const selectionId = existingSelection?.orderEntityId ?? change.draftSelectionId;
  if (!selectionId) {
    throw new Error(
      "OrderCommit session configuration reducer failed: new selections require draftSelectionId."
    );
  }

  const linkedIdentity = linkedProductIdentityForUpsert(input);
  const selectionLine = sessionConfigurationLine({
    parentPackage,
    selectionId,
    resolvedSelection,
    linkedIdentity,
  });
  const linkedLine = linkedIdentity
    ? linkedProductAddOnLine({
        parentPackage,
        selectionId,
        resolvedSelection,
        linkedIdentity,
        resolvedLinkedProduct: requiredResolvedLinkedProduct(input),
      })
    : null;

  const nextLines = snapshot.lines
    .filter(
      (line) =>
        !isSameSessionConfigurationSelection(line, existingSelection) &&
        !isLinkedAddOnOwnedBySelection(line, existingSelection?.orderEntityId) &&
        !isTargetConfigurationOrphanedLinkedAddOn(
          line,
          parentPackage,
          change.configurationId
        )
    )
    .map(cloneSnapshotLine);

  const lines = [...nextLines, selectionLine, ...(linkedLine ? [linkedLine] : [])];
  assertLinkedProductOwnership(lines);
  return normalizeOrderCommitSnapshot({ ...snapshot, lines });
}

function removeSessionConfiguration(
  snapshot: OrderCommitSnapshotV1,
  change: SessionConfigurationStagingChange,
  parentPackage: OrderCommitSnapshotLineV1
): OrderCommitSnapshotV1 {
  if (!change.target) {
    throw new Error(
      "OrderCommit session configuration reducer failed: REMOVE requires a target."
    );
  }
  const target = resolveSessionConfigurationLine(
    snapshot,
    change.target,
    parentPackage
  );
  if (target.catalogEntityId !== change.configurationId) {
    throw new Error(
      `OrderCommit session configuration reducer failed: target ${target.lineId} is not configuration ${change.configurationId}.`
    );
  }

  const lines = snapshot.lines
    .filter(
      (line) =>
        line.lineId !== target.lineId &&
        !isLinkedAddOnOwnedBySelection(line, target.orderEntityId)
    )
    .map(cloneSnapshotLine);

  assertLinkedProductOwnership(lines);
  return normalizeOrderCommitSnapshot({ ...snapshot, lines });
}

function sessionConfigurationLine(input: {
  parentPackage: OrderCommitSnapshotLineV1;
  selectionId: string;
  resolvedSelection: ResolvedOrderCommitDraftSessionConfigurationSelection;
  linkedIdentity: LinkedProductIdentity | null;
}): OrderCommitSnapshotLineV1 {
  const pricedSelection = toPricedSelection(
    input.selectionId,
    input.resolvedSelection,
    input.linkedIdentity
  );
  const priced = priceSelections([pricedSelection]);
  if (priced.lineItems.length > 1) {
    throw new Error(
      "OrderCommit session configuration reducer failed: selection pricing produced multiple lines."
    );
  }
  const lineItem = priced.lineItems[0] ?? null;
  const metadata = selectionMetadata(
    input.resolvedSelection,
    input.linkedIdentity
  );

  return {
    lineId: `session-config:${input.selectionId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND
        .ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
    orderEntityId: input.selectionId,
    parentOrderPackageId: input.parentPackage.orderEntityId,
    catalogEntityId: input.resolvedSelection.configurationId,
    stableKey: `session-configuration-selection:${input.selectionId}`,
    label:
      lineItem?.description ??
      formatSelectionOwnershipLabel(input.resolvedSelection),
    quantity: lineItem?.quantity ?? 1,
    unitPrice: lineItem ? money(lineItem.unitPrice) : 0,
    lineTotal: lineItem ? money(lineItem.lineTotal) : 0,
    priceSource:
      ORDER_COMMIT_PRICE_SOURCE.SESSION_CONFIGURATION_SELECTION_SNAPSHOT,
    metadata,
  };
}

function linkedProductAddOnLine(input: {
  parentPackage: OrderCommitSnapshotLineV1;
  selectionId: string;
  resolvedSelection: ResolvedOrderCommitDraftSessionConfigurationSelection;
  linkedIdentity: LinkedProductIdentity;
  resolvedLinkedProduct: ResolvedOrderCommitDraftLinkedProduct;
}): OrderCommitSnapshotLineV1 {
  const quantity = input.resolvedLinkedProduct.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error(
      "OrderCommit session configuration reducer failed: linked-product quantity must be a nonnegative integer."
    );
  }

  return {
    lineId: `session-config:${input.selectionId}:addon:${input.linkedIdentity.addOnRef}`,
    lineKind:
      ORDER_COMMIT_SNAPSHOT_LINE_KIND
        .LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND
        .ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
    orderEntityId: input.selectionId,
    parentOrderPackageId: input.parentPackage.orderEntityId,
    catalogEntityId: input.resolvedLinkedProduct.productId,
    stableKey: `session-configuration-selection:${input.selectionId}:add-on:${input.linkedIdentity.addOnRef}`,
    label: input.resolvedLinkedProduct.label,
    quantity,
    unitPrice: input.resolvedLinkedProduct.unitPrice,
    lineTotal: multiplyMoney(input.resolvedLinkedProduct.unitPrice, quantity),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      ...selectionMetadata(input.resolvedSelection, input.linkedIdentity),
      addOnNotes: input.resolvedLinkedProduct.notes ?? null,
      productId: input.resolvedLinkedProduct.productId,
    },
  };
}

function linkedProductIdentityForUpsert(
  input: ReduceOrderCommitDraftSessionConfigurationInput
): LinkedProductIdentity | null {
  const resolvedSelection = input.resolvedSelection;
  if (!resolvedSelection) return null;

  const isLinkedProduct =
    resolvedSelection.snapshotPricingMode === "LINKED_PRODUCT" ||
    resolvedSelection.snapshotLinkedProductId !== null ||
    input.change.linkedProduct !== undefined ||
    input.resolvedLinkedProduct !== undefined;

  if (!isLinkedProduct) return null;
  if (resolvedSelection.snapshotPricingMode !== "LINKED_PRODUCT") {
    throw new Error(
      "OrderCommit session configuration reducer failed: linked-product data requires LINKED_PRODUCT pricing mode."
    );
  }
  if (!input.change.linkedProduct) {
    throw new Error(
      "OrderCommit session configuration reducer failed: linked products require linkedProduct input."
    );
  }
  if (!input.resolvedLinkedProduct) {
    throw new Error(
      "OrderCommit session configuration reducer failed: linked products require resolved linked-product data."
    );
  }
  if (input.change.linkedProduct.productId !== input.resolvedLinkedProduct.productId) {
    throw new Error(
      `OrderCommit session configuration reducer failed: resolved linked product ${input.resolvedLinkedProduct.productId} does not match requested product ${input.change.linkedProduct.productId}.`
    );
  }
  if (
    resolvedSelection.snapshotLinkedProductId &&
    resolvedSelection.snapshotLinkedProductId !== input.change.linkedProduct.productId
  ) {
    throw new Error(
      `OrderCommit session configuration reducer failed: selection linked product ${resolvedSelection.snapshotLinkedProductId} does not match requested product ${input.change.linkedProduct.productId}.`
    );
  }

  const orderAddOnId = input.change.linkedProduct.orderAddOnId ?? null;
  const draftOrderAddOnId = input.change.linkedProduct.draftOrderAddOnId ?? null;
  if (Boolean(orderAddOnId) === Boolean(draftOrderAddOnId)) {
    throw new Error(
      "OrderCommit session configuration reducer failed: linked products require exactly one of orderAddOnId or draftOrderAddOnId."
    );
  }

  return {
    addOnRef: orderAddOnId ?? requiredDraftOrderAddOnId(draftOrderAddOnId),
    orderAddOnId,
    draftOrderAddOnId,
  };
}

function requiredResolvedLinkedProduct(
  input: ReduceOrderCommitDraftSessionConfigurationInput
): ResolvedOrderCommitDraftLinkedProduct {
  if (!input.resolvedLinkedProduct) {
    throw new Error(
      "OrderCommit session configuration reducer failed: linked products require resolved linked-product data."
    );
  }
  return input.resolvedLinkedProduct;
}

function requiredDraftOrderAddOnId(value: string | null): string {
  if (!value) {
    throw new Error(
      "OrderCommit session configuration reducer failed: linked products require draftOrderAddOnId for newly staged add-ons."
    );
  }
  return value;
}

function toPricedSelection(
  selectionId: string,
  selection: ResolvedOrderCommitDraftSessionConfigurationSelection,
  linkedIdentity: LinkedProductIdentity | null
): PricedSelection {
  return {
    id: selectionId,
    snapshotConfigurationCode: selection.snapshotConfigurationCode,
    snapshotLabel: selection.snapshotLabel,
    snapshotPriceDelta: new Prisma.Decimal(selection.snapshotPriceDelta),
    snapshotPricingMode: selection.snapshotPricingMode,
    snapshotInputType: selection.snapshotInputType,
    snapshotOptionLabel: selection.snapshotOptionLabel,
    snapshotLinkedProductId: selection.snapshotLinkedProductId,
    orderAddOnId: linkedIdentity?.orderAddOnId ?? null,
    numericValue: selection.numericValue
      ? new Prisma.Decimal(selection.numericValue)
      : null,
  };
}

function selectionMetadata(
  selection: ResolvedOrderCommitDraftSessionConfigurationSelection,
  linkedIdentity: LinkedProductIdentity | null
): Record<string, unknown> {
  return {
    configurationId: selection.configurationId,
    optionId: selection.optionId,
    numericValue: selection.numericValue,
    orderAddOnId: linkedIdentity?.orderAddOnId ?? null,
    ...(linkedIdentity?.draftOrderAddOnId
      ? { draftOrderAddOnId: linkedIdentity.draftOrderAddOnId }
      : {}),
    snapshotConfigurationCode: selection.snapshotConfigurationCode,
    snapshotFinancialBehavior: selection.snapshotFinancialBehavior,
    snapshotInputType: selection.snapshotInputType,
    snapshotLabel: selection.snapshotLabel,
    snapshotLinkedProductId: selection.snapshotLinkedProductId,
    snapshotOptionLabel: selection.snapshotOptionLabel,
    snapshotPriceDelta: roundMoney(selection.snapshotPriceDelta),
    snapshotPricingMode: selection.snapshotPricingMode,
    textValue: selection.textValue,
  };
}

function resolveExistingSessionConfigurationLine(
  snapshot: OrderCommitSnapshotV1,
  change: SessionConfigurationStagingChange,
  parentPackage: OrderCommitSnapshotLineV1
): OrderCommitSnapshotLineV1 | null {
  if (change.target) {
    const line = resolveSessionConfigurationLine(
      snapshot,
      change.target,
      parentPackage
    );
    if (line.catalogEntityId !== change.configurationId) {
      throw new Error(
        `OrderCommit session configuration reducer failed: target ${line.lineId} is not configuration ${change.configurationId}.`
      );
    }
    return line;
  }

  const matches = snapshot.lines.filter(
    (line) =>
      line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION &&
      line.parentOrderPackageId === parentPackage.orderEntityId &&
      line.catalogEntityId === change.configurationId
  );
  if (matches.length > 1) {
    throw new Error(
      `OrderCommit session configuration reducer failed: package ${parentPackage.orderEntityId} has multiple selections for configuration ${change.configurationId}.`
    );
  }
  return matches[0] ?? null;
}

function resolveParentPackageLine(
  snapshot: OrderCommitSnapshotV1,
  target: OrderCommitDraftLineTarget
): OrderCommitSnapshotLineV1 {
  const line = resolveLine(snapshot, target);
  if (!line) {
    throw new Error(
      "OrderCommit session configuration reducer failed: parent package not found."
    );
  }
  if (line.lineKind !== ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE) {
    throw new Error(
      `OrderCommit session configuration reducer failed: parent target ${line.lineId} is not a package line.`
    );
  }
  return line;
}

function resolveSessionConfigurationLine(
  snapshot: OrderCommitSnapshotV1,
  target: OrderCommitDraftLineTarget,
  parentPackage: OrderCommitSnapshotLineV1
): OrderCommitSnapshotLineV1 {
  const line = resolveLine(snapshot, target);
  if (!line) {
    throw new Error(
      "OrderCommit session configuration reducer failed: selection target not found."
    );
  }
  if (line.lineKind !== ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION) {
    throw new Error(
      `OrderCommit session configuration reducer failed: target ${line.lineId} is not a session configuration line.`
    );
  }
  if (line.parentOrderPackageId !== parentPackage.orderEntityId) {
    throw new Error(
      `OrderCommit session configuration reducer failed: target ${line.lineId} is not scoped to package ${parentPackage.orderEntityId}.`
    );
  }
  return line;
}

function resolveLine(
  snapshot: OrderCommitSnapshotV1,
  target: OrderCommitDraftLineTarget
): OrderCommitSnapshotLineV1 | null {
  return (
    snapshot.lines.find(
      (line) =>
        line.stableKey === target.stableKey ||
        line.lineId === target.lineId ||
        line.orderEntityId === target.orderEntityId ||
        line.orderEntityId === target.draftEntityId
    ) ?? null
  );
}

function assertLinkedProductOwnership(
  lines: OrderCommitSnapshotLineV1[]
): void {
  const selectionLines = lines.filter(
    (line) => line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION
  );
  const linkedLines = lines.filter(
    (line) =>
      line.lineKind ===
      ORDER_COMMIT_SNAPSHOT_LINE_KIND.LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON
  );
  const selectionById = new Map(
    selectionLines.map((line) => [line.orderEntityId, line])
  );

  for (const linkedLine of linkedLines) {
    const selectionLine = selectionById.get(linkedLine.orderEntityId);
    if (!selectionLine) {
      throw new Error(
        `OrderCommit session configuration reducer failed: orphaned linked-product add-on ${linkedLine.lineId} has no owning selection line.`
      );
    }
    const linkedIdentity = metadataLinkedIdentity(linkedLine);
    if (!linkedIdentity) {
      throw new Error(
        `OrderCommit session configuration reducer failed: linked-product add-on ${linkedLine.lineId} must reference orderAddOnId or draftOrderAddOnId.`
      );
    }
    const selectionIdentity = metadataLinkedIdentity(selectionLine);
    if (!selectionIdentity || selectionIdentity.addOnRef !== linkedIdentity.addOnRef) {
      throw new Error(
        `OrderCommit session configuration reducer failed: linked-product add-on ${linkedLine.lineId} does not match its owning selection metadata.`
      );
    }
  }

  for (const selectionLine of selectionLines) {
    const identity = metadataLinkedIdentity(selectionLine);
    if (!identity) continue;
    const matches = linkedLines.filter(
      (line) =>
        line.orderEntityId === selectionLine.orderEntityId &&
        metadataLinkedIdentity(line)?.addOnRef === identity.addOnRef
    );
    if (matches.length !== 1) {
      throw new Error(
        `OrderCommit session configuration reducer failed: linked-product selection ${selectionLine.lineId} must own exactly one linked add-on line.`
      );
    }
  }
}

function metadataLinkedIdentity(
  line: OrderCommitSnapshotLineV1
): LinkedProductIdentity | null {
  const orderAddOnId = optionalStringMetadata(line, "orderAddOnId");
  const draftOrderAddOnId = optionalStringMetadata(line, "draftOrderAddOnId");
  if (!orderAddOnId && !draftOrderAddOnId) return null;
  if (orderAddOnId && draftOrderAddOnId) {
    throw new Error(
      `OrderCommit session configuration reducer failed: line ${line.lineId} cannot reference both orderAddOnId and draftOrderAddOnId.`
    );
  }
  return {
    addOnRef: orderAddOnId ?? draftOrderAddOnId ?? "",
    orderAddOnId,
    draftOrderAddOnId,
  };
}

function isSameSessionConfigurationSelection(
  line: OrderCommitSnapshotLineV1,
  existingSelection: OrderCommitSnapshotLineV1 | null
): boolean {
  return Boolean(existingSelection && line.lineId === existingSelection.lineId);
}

function isLinkedAddOnOwnedBySelection(
  line: OrderCommitSnapshotLineV1,
  selectionId: string | undefined
): boolean {
  return Boolean(
    selectionId &&
      line.lineKind ===
        ORDER_COMMIT_SNAPSHOT_LINE_KIND
          .LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON &&
      line.orderEntityId === selectionId
  );
}

function isTargetConfigurationOrphanedLinkedAddOn(
  line: OrderCommitSnapshotLineV1,
  parentPackage: OrderCommitSnapshotLineV1,
  configurationId: string
): boolean {
  return (
    line.lineKind ===
      ORDER_COMMIT_SNAPSHOT_LINE_KIND
        .LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON &&
    line.parentOrderPackageId === parentPackage.orderEntityId &&
    line.metadata.configurationId === configurationId
  );
}

function formatSelectionOwnershipLabel(
  selection: ResolvedOrderCommitDraftSessionConfigurationSelection
): string {
  if (
    (selection.snapshotInputType === "SELECT" ||
      selection.snapshotInputType === "COUNTER") &&
    selection.snapshotOptionLabel
  ) {
    return `${selection.snapshotLabel} - ${selection.snapshotOptionLabel}`;
  }

  if (selection.snapshotInputType === "COUNTER" && selection.numericValue) {
    return `${selection.snapshotLabel} (${selection.numericValue})`;
  }

  return selection.snapshotLabel;
}

function optionalStringMetadata(
  line: OrderCommitSnapshotLineV1,
  key: string
): string | null {
  const value = line.metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function cloneSnapshotLine(
  line: OrderCommitSnapshotLineV1
): OrderCommitSnapshotLineV1 {
  return { ...line, metadata: { ...line.metadata } };
}

function multiplyMoney(unitPrice: number, quantity: number): number {
  return roundMoney(unitPrice * quantity);
}

function money(value: Prisma.Decimal): number {
  return roundMoney(value.toNumber());
}

function roundMoney(value: number): number {
  return Number(value.toFixed(3));
}
