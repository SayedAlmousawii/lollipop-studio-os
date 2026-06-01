import { z } from "zod";
import { ORDER_COMMIT_SNAPSHOT_CURRENCY } from "./order-commit.constants";
import { orderCommitSnapshotV1Schema } from "./order-commit.schema";
import type {
  OrderCommitSnapshotLineV1,
  OrderCommitSnapshotV1,
} from "./order-commit.types";

export function normalizeOrderCommitSnapshot(
  snapshot: OrderCommitSnapshotV1
): OrderCommitSnapshotV1 {
  const parsed = orderCommitSnapshotV1Schema.parse(snapshot);
  if (parsed.currency !== ORDER_COMMIT_SNAPSHOT_CURRENCY) {
    throw new Error(
      `OrderCommit snapshot normalization failed: unsupported currency ${parsed.currency}.`
    );
  }

  guardUniqueLineIdentity(parsed.lines, "lineId");
  guardUniqueLineIdentity(parsed.lines, "stableKey");

  const lines = parsed.lines
    .map((line) => ({
      ...line,
      metadata: normalizeMetadataObject(line.metadata),
    }))
    .sort((left, right) =>
      left.stableKey.localeCompare(right.stableKey) ||
      left.lineId.localeCompare(right.lineId)
    );
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.lineTotal, 0));

  return orderCommitSnapshotV1Schema.parse({
    ...parsed,
    lines,
    totals: {
      subtotal,
      discountTotal: 0,
      netTotal: subtotal,
    },
  });
}

function guardUniqueLineIdentity(
  lines: OrderCommitSnapshotLineV1[],
  field: "lineId" | "stableKey"
): void {
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line[field])) {
      throw new Error(
        `OrderCommit snapshot normalization failed: duplicate ${field} ${line[field]}.`
      );
    }
    seen.add(line[field]);
  }
}

function normalizeMetadataObject(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, normalizeMetadataValue(value)])
  );
}

function normalizeMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeMetadataValue);
  }
  if (isPlainMetadataObject(value)) {
    return normalizeMetadataObject(value);
  }
  return value;
}

function isPlainMetadataObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function roundMoney(value: number): number {
  const rounded = Number(value.toFixed(3));
  return z.number().finite().parse(rounded);
}
