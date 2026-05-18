import type {
  AdjustmentBaseSnapshot,
  AdjustmentCompositionLine,
  AdjustmentWorkspaceEdit,
} from "./adjustment-workspace.types";

export type PendingChangeKind =
  | "addition"
  | "removal"
  | "quantity"
  | "change"
  | "upgrade";

export type PendingChangeRow = {
  id: string;
  kind: PendingChangeKind;
  label: string;
  description: string;
  amount: number;
};

export function buildPendingChangesView(
  edits: AdjustmentWorkspaceEdit[],
  context?: {
    base?: AdjustmentBaseSnapshot;
    proposed?: AdjustmentBaseSnapshot;
    deltas?: AdjustmentCompositionLine[];
  }
): PendingChangeRow[] {
  return edits.map((edit) => buildPendingChangeRow(edit, context));
}

function buildPendingChangeRow(
  edit: AdjustmentWorkspaceEdit,
  context:
    | {
        base?: AdjustmentBaseSnapshot;
        proposed?: AdjustmentBaseSnapshot;
        deltas?: AdjustmentCompositionLine[];
      }
    | undefined
): PendingChangeRow {
  if (edit.op === "add_line") {
    const line = findLine(context?.proposed?.lines, `edit:${edit.id}`);
    return {
      id: edit.id,
      kind: "addition",
      label: `Add ${line?.label ?? formatKind(edit.kind)}`,
      description: `${edit.quantity} staged`,
      amount: money(line?.lineTotalNet),
    };
  }

  if (edit.op === "remove_line") {
    const line = findLine(context?.base?.lines, edit.targetLineId);
    return {
      id: edit.id,
      kind: "removal",
      label: `Remove ${line?.label ?? "line"}`,
      description: line ? `${line.quantity} currently included` : edit.targetLineId,
      amount: -money(line?.lineTotalNet),
    };
  }

  if (edit.op === "modify_quantity") {
    const baseLine = findLine(context?.base?.lines, edit.targetLineId);
    const proposedLine = findLine(context?.proposed?.lines, edit.targetLineId);
    return {
      id: edit.id,
      kind: "quantity",
      label: `${baseLine?.label ?? proposedLine?.label ?? "Line"} Quantity`,
      description: `${baseLine?.quantity ?? "current"} → ${edit.newQuantity}`,
      amount: money(proposedLine?.lineTotalNet) - money(baseLine?.lineTotalNet),
    };
  }

  if (edit.op === "swap_package") {
    return {
      id: edit.id,
      kind: "change",
      label: "Package Change",
      description: `${formatRef(edit.fromPackageRefId)} → ${formatRef(edit.toPackageRefId)}`,
      amount: amountForRefs(context?.deltas, [
        edit.fromPackageRefId,
        edit.toPackageRefId,
      ]),
    };
  }

  if (edit.op === "swap_addon") {
    const baseLine = findLine(context?.base?.lines, edit.targetLineId);
    const proposedLine = findLine(context?.proposed?.lines, edit.targetLineId);
    return {
      id: edit.id,
      kind: "change",
      label: "Add-on Change",
      description: `${baseLine?.label ?? "Current add-on"} → ${proposedLine?.label ?? formatRef(edit.toAddonRefId)}`,
      amount: money(proposedLine?.lineTotalNet) - money(baseLine?.lineTotalNet),
    };
  }

  if (edit.op === "upgrade_package_item") {
    const upgradeLine = findLine(
      context?.proposed?.lines,
      `item:${edit.orderPackageId}:${edit.packageItemId}`
    );
    const change = parseChangeLabel(upgradeLine?.label);
    return {
      id: edit.id,
      kind: "upgrade",
      label: `${categoryLabel(change?.from ?? upgradeLine?.label ?? formatRef(edit.packageItemId))} Change`,
      description: change
        ? `${change.from} → ${change.to}`
        : `${formatRef(edit.packageItemId)} → ${formatRef(edit.toProductId)}`,
      amount: money(upgradeLine?.lineTotalNet),
    };
  }

  if (edit.op === "change_selected_photo_count") {
    return {
      id: edit.id,
      kind: "quantity",
      label: "Selected Photos",
      description: `Selected count → ${edit.selectedPhotoCount}`,
      amount: selectedPhotoAmount(context?.deltas, edit.orderPackageId),
    };
  }

  if (edit.op === "change_session_configuration_selection") {
    const proposedSelection = context?.proposed?.sessionConfigurationSelections?.find(
      (selection) =>
        selection.orderPackageId === edit.orderPackageId &&
        selection.configurationId === edit.configurationId
    );
    const baseSelection = context?.base?.sessionConfigurationSelections?.find(
      (selection) =>
        selection.orderPackageId === edit.orderPackageId &&
        selection.configurationId === edit.configurationId
    );
    const label =
      proposedSelection?.snapshotLabel ??
      baseSelection?.snapshotLabel ??
      "Session Configuration";
    const selectionIds = [
      proposedSelection?.id,
      proposedSelection?.orderAddOnId,
      baseSelection?.id,
      baseSelection?.orderAddOnId,
      `pending:${edit.configurationId}`,
      `pending:addon:${edit.configurationId}`,
    ].filter((value): value is string => Boolean(value));
    const displayValue = sessionConfigurationDesiredDisplay(
      edit.desired,
      proposedSelection
    );
    return {
      id: edit.id,
      kind: edit.desired === null ? "removal" : "change",
      label: `Session Configuration: ${label}`,
      description: edit.desired === null ? "Removed" : `Updated -> ${displayValue}`,
      amount: sessionConfigurationAmount(
        context?.deltas,
        selectionIds
      ),
    };
  }

  const baseLine = findLine(context?.base?.lines, `package:${edit.orderPackageId}`);
  const proposedLine = findLine(context?.proposed?.lines, `package:${edit.orderPackageId}`);
  return {
    id: edit.id,
    kind: "change",
    label: "Package Change",
    description: `${baseLine?.label ?? "Current package"} → ${proposedLine?.label ?? formatRef(edit.toPackageRefId)}`,
    amount: money(proposedLine?.lineTotalNet) - money(baseLine?.lineTotalNet),
  };
}

function findLine(lines: AdjustmentCompositionLine[] | undefined, lineId: string) {
  return lines?.find((line) => line.lineId === lineId);
}

function amountForRefs(
  lines: AdjustmentCompositionLine[] | undefined,
  refs: string[]
): number {
  const refSet = new Set(refs);
  return sumAmounts(lines?.filter((line) => refSet.has(line.refId)) ?? []);
}

function selectedPhotoAmount(
  lines: AdjustmentCompositionLine[] | undefined,
  orderPackageId: string
): number {
  return sumAmounts(
    lines?.filter((line) => line.lineId.includes(`extra-photo:${orderPackageId}:`)) ??
      []
  );
}

function sessionConfigurationAmount(
  lines: AdjustmentCompositionLine[] | undefined,
  selectionIds: string[]
): number {
  const selectionIdSet = new Set(selectionIds);
  return sumAmounts(
    lines?.filter(
      (line) =>
        (line.kind === "session_configuration" || line.kind === "addon") &&
        selectionIdSet.has(line.refId)
    ) ?? []
  );
}

function sessionConfigurationDesiredDisplay(
  desired: Extract<
    AdjustmentWorkspaceEdit,
    { op: "change_session_configuration_selection" }
  >["desired"],
  proposedSelection?: {
    snapshotLabel: string;
    optionId: string | null;
    numericValue: string | null;
    textValue: string | null;
  }
): string {
  if (desired === null) return "Removed";
  switch (desired.kind) {
    case "toggle":
      return "Selected";
    case "select":
      return proposedSelection?.snapshotLabel ?? desired.optionId;
    case "number":
      return String(desired.numericValue);
    case "text":
      return desired.textValue;
    case "counter":
      return proposedSelection?.snapshotLabel
        ? `${desired.numericValue} · ${proposedSelection.snapshotLabel}`
        : String(desired.numericValue);
  }
}

function sumAmounts(lines: AdjustmentCompositionLine[]): number {
  return Number(
    lines.reduce((sum, line) => sum + money(line.lineTotalNet), 0).toFixed(3)
  );
}

function money(value: string | undefined): number {
  return Number(Number(value ?? 0).toFixed(3));
}

function parseChangeLabel(
  label: string | undefined
): { from: string; to: string } | undefined {
  const match = label?.trim().match(/^(.+?)\s+to\s+(.+)$/i);
  const from = match?.[1]?.trim();
  const to = match?.[2]?.trim();
  return from && to ? { from, to } : undefined;
}

function categoryLabel(label: string): string {
  return toTitleCase(label.trim().split(/\s+/)[0] ?? "Composition");
}

function formatKind(kind: "item" | "addon"): string {
  return kind === "addon" ? "add-on" : "item";
}

function formatRef(refId: string): string {
  return toTitleCase(refId.replace(/[-_:]+/g, " "));
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
