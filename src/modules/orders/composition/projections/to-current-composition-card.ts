import type {
  CompositionLine,
  CompositionSnapshot,
  OrderCompositionViewModel,
} from "../order-composition.types";
import type {
  CompositionView,
  CompositionViewMode,
  CompositionViewRow,
} from "@/modules/composition-view/composition-view.model";

export type CurrentCompositionCardProjection = CompositionView;

export function toCurrentCompositionCard(
  model: OrderCompositionViewModel,
  options: {
    mode?: CompositionViewMode;
    source?: "base" | "effective" | "pending" | "pendingDeltas";
  } = {}
): CurrentCompositionCardProjection {
  const snapshot = selectSnapshot(model, options.source);
  const lines =
    options.source === "pendingDeltas" ||
    (!options.source &&
      model.state === "adjustment" &&
      snapshot.adjustmentLines.length > 0)
      ? snapshot.adjustmentLines
      : snapshot.lines.filter(
          (line) => line.metadata.sourceKind !== "adjustmentDelta"
        );

  return {
    mode: options.mode ?? (model.state === "adjustment" ? "adjustment" : "locked"),
    rows: projectCompositionRows(lines),
    total:
      options.source === "pendingDeltas"
        ? sumMoney(lines.map((line) => line.totalAmount))
        : snapshot.totals.netCompositionTotal,
  };
}

function selectSnapshot(
  model: OrderCompositionViewModel,
  source: "base" | "effective" | "pending" | "pendingDeltas" | undefined
): CompositionSnapshot {
  if (source === "base" && model.baseComposition) return model.baseComposition;
  if (
    (source === "pending" || source === "pendingDeltas") &&
    model.pendingAdjustmentComposition
  ) {
    return model.pendingAdjustmentComposition;
  }
  return model.effectiveComposition;
}

function projectCompositionRows(lines: CompositionLine[]): CompositionViewRow[] {
  const rows: CompositionViewRow[] = [];
  const usedLineIds = new Set<string>();

  for (const line of lines) {
    if (usedLineIds.has(line.id)) continue;
    if (line.metadata.fromLabel && line.metadata.fromLabel === line.metadata.toLabel) {
      usedLineIds.add(line.id);
      continue;
    }

    if (line.metadata.displayKind === "swap") {
      const pairedLines = findLinesForEdit(lines, line);
      for (const pairedLine of pairedLines) usedLineIds.add(pairedLine.id);
      const amount = sumMoney(pairedLines.map((pairedLine) => pairedLine.totalAmount));
      rows.push({
        id: pairedLines.map((pairedLine) => pairedLine.id).join(":"),
        kind: "swap",
        label: `${line.metadata.categoryLabel ?? "Composition"} Change`,
        lineTotal: amount,
        delta: {
          from: line.metadata.fromLabel ?? line.label,
          to: line.metadata.toLabel ?? line.label,
          amount,
        },
      });
      continue;
    }

    if (line.metadata.displayKind === "upgrade") {
      usedLineIds.add(line.id);
      rows.push({
        id: line.id,
        kind: "upgrade",
        label: `${line.metadata.categoryLabel ?? "Composition"} Change`,
        quantity: line.quantity,
        unitPrice: line.unitAmount,
        lineTotal: line.totalAmount,
        delta: {
          from: line.metadata.fromLabel ?? line.label,
          to: line.metadata.toLabel ?? line.label,
          amount: line.totalAmount,
        },
      });
      continue;
    }

    usedLineIds.add(line.id);
    rows.push({
      id: line.id,
      kind:
        line.metadata.displayKind === "sessionConfiguration"
          ? "line"
          : line.metadata.displayKind,
      label: line.label,
      quantity: line.quantity,
      unitPrice: line.unitAmount,
      lineTotal: line.totalAmount,
    });
  }

  return rows;
}

function findLinesForEdit(
  lines: CompositionLine[],
  sourceLine: CompositionLine
): CompositionLine[] {
  const editId = sourceLine.metadata.adjustmentEditId;
  if (!editId) return [sourceLine];
  const matches = lines.filter(
    (line) =>
      line.metadata.displayKind === "swap" &&
      line.metadata.adjustmentEditId === editId
  );
  return matches.length > 0 ? matches : [sourceLine];
}

function sumMoney(values: number[]): number {
  return Number(values.reduce((sum, value) => sum + value, 0).toFixed(3));
}
