import type {
  AdjustmentCompositionLine,
  AdjustmentCompositionTotals,
} from "@/modules/adjustment-workspace/adjustment-workspace.types";

export type CompositionViewMode = "locked" | "adjustment";
// future: "draft"

export type CompositionViewRow = {
  id: string;
  kind: "package" | "addOn" | "extraPhotos" | "swap" | "upgrade" | "line";
  label: string;
  sublabel?: string;
  quantity?: number;
  unitPrice?: number;
  lineTotal: number;
  delta?: { from: string; to: string; amount: number };
};

export type CompositionView = {
  mode: CompositionViewMode;
  rows: CompositionViewRow[];
  total: number;
};

export function buildCompositionView(input: {
  lines: AdjustmentCompositionLine[];
  totals: AdjustmentCompositionTotals;
  mode: CompositionViewMode;
}): CompositionView {
  const visibleLines = input.lines.filter((line) => !isZeroSelfSwap(line));
  const usedLineIds = new Set<string>();
  const rows: CompositionViewRow[] = [];

  for (const line of visibleLines) {
    if (usedLineIds.has(line.lineId)) continue;

    const change = parseChangeLabel(line.label);
    const lineTotal = parseMoney(line.lineTotalNet);

    if (change && lineTotal < 0) {
      const pairedLine = findSwapPair(line, change, visibleLines, usedLineIds);
      if (pairedLine) {
        usedLineIds.add(line.lineId);
        usedLineIds.add(pairedLine.lineId);

        const amount = sumMoney(line.lineTotalNet, pairedLine.lineTotalNet);
        rows.push({
          id: `${line.lineId}:${pairedLine.lineId}`,
          kind: "swap",
          label: `${categoryLabel(change.from, change.to)} Change`,
          lineTotal: amount,
          delta: { from: change.from, to: change.to, amount },
        });
        continue;
      }
    }

    if (change && lineTotal !== 0) {
      usedLineIds.add(line.lineId);
      rows.push({
        id: line.lineId,
        kind: "upgrade",
        label: `${categoryLabel(change.from, change.to)} Change`,
        quantity: line.quantity,
        unitPrice: parseMoney(line.unitPrice),
        lineTotal,
        delta: { from: change.from, to: change.to, amount: lineTotal },
      });
      continue;
    }

    usedLineIds.add(line.lineId);
    rows.push(toPlainRow(line));
  }

  return {
    mode: input.mode,
    rows,
    total: parseMoney(input.totals.netPayable),
  };
}

function isZeroSelfSwap(line: AdjustmentCompositionLine): boolean {
  return parseMoney(line.lineTotalNet) === 0 && hasSameFromToLabel(line.label);
}

function hasSameFromToLabel(label: string): boolean {
  const change = parseChangeLabel(label);
  if (!change) return false;
  return normalizeLabel(change.from) === normalizeLabel(change.to);
}

function findSwapPair(
  removalLine: AdjustmentCompositionLine,
  change: { from: string; to: string },
  lines: AdjustmentCompositionLine[],
  usedLineIds: Set<string>
): AdjustmentCompositionLine | undefined {
  const removalIndex = lines.indexOf(removalLine);
  const candidates = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.lineId !== removalLine.lineId)
    .filter(({ line }) => !usedLineIds.has(line.lineId))
    .filter(({ line }) => parseMoney(line.lineTotalNet) >= 0);

  return (
    candidates.find(
      ({ line, index }) =>
        index === removalIndex + 1 &&
        isLikelySwapAddition(line, change, { allowCategoryMatch: true })
    )?.line ??
    candidates.find(
      ({ line }) =>
        line.refId === removalLine.refId &&
        isLikelySwapAddition(line, change, { allowCategoryMatch: true })
    )?.line ??
    candidates.find(({ line }) =>
      isLikelySwapAddition(line, change, { allowCategoryMatch: false })
    )?.line
  );
}

function isLikelySwapAddition(
  line: AdjustmentCompositionLine,
  change: { from: string; to: string },
  options: { allowCategoryMatch: boolean }
): boolean {
  const normalizedLabel = normalizeLabel(line.label);
  const normalizedTarget = normalizeLabel(change.to);
  if (normalizedLabel === normalizedTarget) return true;

  const additionChange = parseChangeLabel(line.label);
  if (additionChange && normalizeLabel(additionChange.to) === normalizedTarget) {
    return true;
  }

  return (
    options.allowCategoryMatch &&
    categoryKey(line.label) === categoryKey(change.to)
  );
}

function toPlainRow(line: AdjustmentCompositionLine): CompositionViewRow {
  const kind = classifyLineKind(line);
  return {
    id: line.lineId,
    kind,
    label: line.label,
    quantity: line.quantity,
    unitPrice: parseMoney(line.unitPrice),
    lineTotal: parseMoney(line.lineTotalNet),
  };
}

function classifyLineKind(
  line: AdjustmentCompositionLine
): CompositionViewRow["kind"] {
  if (line.kind === "package") return "package";
  if (line.kind === "addon") return "addOn";
  if (isExtraPhotoLine(line)) return "extraPhotos";
  return "line";
}

function isExtraPhotoLine(line: AdjustmentCompositionLine): boolean {
  return (
    line.lineId.startsWith("extra-photo:") ||
    line.refId.startsWith("Extra photos - ")
  );
}

function parseChangeLabel(
  label: string
): { from: string; to: string } | undefined {
  const match = label.trim().match(/^(.+?)\s+to\s+(.+)$/i);
  if (!match) return undefined;

  const from = match[1]?.trim();
  const to = match[2]?.trim();
  if (!from || !to) return undefined;
  return { from, to };
}

function categoryLabel(from: string, to: string): string {
  const fromCategory = categoryKey(from);
  const toCategory = categoryKey(to);
  const category =
    fromCategory === toCategory ? fromCategory : fromCategory || toCategory;
  return toTitleCase(category || "composition");
}

function categoryKey(label: string): string {
  const normalized = normalizeLabel(label);
  return normalized.split(/\s+/)[0] ?? "";
}

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseMoney(value: string): number {
  return Number(Number(value).toFixed(3));
}

function sumMoney(...values: string[]): number {
  return Number(
    values.reduce((sum, value) => sum + Math.round(Number(value) * 1000), 0) /
      1000
  );
}
