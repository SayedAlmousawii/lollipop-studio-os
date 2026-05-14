import { Prisma } from "@prisma/client";

export type DualReadResult<T> = {
  oldValue: T;
  newValue: T;
  matched: boolean;
};

const discrepancyMetricCounts = new Map<string, number>();

type DualReadOptions<T> = {
  phase: string;
  path: string;
  entityId: string;
  flagKey: string;
  oldFn: () => Promise<T>;
  newFn: () => Promise<T>;
  compare?: (a: T, b: T) => boolean;
  authoritative?: "old" | "new";
};

function isFlagEnabled(flagKey: string): boolean {
  const rawValue = process.env[flagKey];
  if (!rawValue) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(rawValue.toLowerCase());
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function compareNumbers(a: number, b: number): boolean {
  return Math.abs(a - b) <= Number.EPSILON;
}

function compareUnknown(a: unknown, b: unknown): boolean {
  if (a instanceof Prisma.Decimal && b instanceof Prisma.Decimal) {
    return a.equals(b);
  }

  if (typeof a === "number" && typeof b === "number") {
    return compareNumbers(a, b);
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => compareUnknown(value, b[index]));
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();

    return compareUnknown(aKeys, bKeys) && aKeys.every((key) => compareUnknown(a[key], b[key]));
  }

  return Object.is(a, b);
}

function incrementDiscrepancyMetric(phase: string, path: string) {
  const metricKey = `${phase}:${path}`;
  discrepancyMetricCounts.set(metricKey, (discrepancyMetricCounts.get(metricKey) ?? 0) + 1);
}

function logDiscrepancy<T>(
  opts: Pick<DualReadOptions<T>, "phase" | "path" | "entityId">,
  result: DualReadResult<T>
) {
  incrementDiscrepancyMetric(opts.phase, opts.path);

  console.warn(
    JSON.stringify({
      level: "warn",
      event: "financial.dual_read.discrepancy",
      metric: "financial.rearch.dual_read.discrepancy",
      phase: opts.phase,
      path: opts.path,
      entityId: opts.entityId,
      oldValue: result.oldValue,
      newValue: result.newValue,
    })
  );
}

export async function dualRead<T>(opts: DualReadOptions<T>): Promise<T> {
  const oldValue = await opts.oldFn();

  if (!isFlagEnabled(opts.flagKey)) {
    return oldValue;
  }

  const newValue = await opts.newFn();
  const matched = opts.compare ? opts.compare(oldValue, newValue) : compareUnknown(oldValue, newValue);
  const result = { oldValue, newValue, matched };

  if (!matched) {
    logDiscrepancy(opts, result);
  }

  return (opts.authoritative ?? "old") === "new" ? newValue : oldValue;
}
