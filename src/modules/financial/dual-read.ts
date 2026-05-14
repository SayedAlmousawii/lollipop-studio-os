import { isFinancialFeatureEnabled } from "./feature-flags";

type DualReadAuthoritative = "old" | "new";

type DualReadInput<T> = {
  phase: string;
  path: string;
  entityId: string;
  flagKey: string;
  oldFn: () => Promise<T>;
  newFn: () => Promise<T>;
  authoritative: DualReadAuthoritative;
};

type Settled<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

export async function dualRead<T>({
  phase,
  path,
  entityId,
  flagKey,
  oldFn,
  newFn,
  authoritative,
}: DualReadInput<T>): Promise<T> {
  const useNew = isFinancialFeatureEnabled(flagKey);
  if (!useNew) return oldFn();

  const oldResult = await settle(oldFn);
  const newResult = await settle(newFn);

  if (resultsDiffer(oldResult, newResult)) {
    console.warn(
      JSON.stringify({
        metric: "financial.rearch.dual_read.discrepancy",
        phase,
        path,
        entityId,
        old: summarizeResult(oldResult),
        next: summarizeResult(newResult),
      })
    );
  }

  if (authoritative === "new") return unwrap(newResult);
  if (!oldResult.ok && newResult.ok && isLockedEditRecalculationError(oldResult.error)) {
    return newResult.value;
  }
  if (!oldResult.ok && !newResult.ok && isLockedEditRecalculationError(oldResult.error)) {
    throw newResult.error;
  }

  return unwrap(oldResult);
}

async function settle<T>(fn: () => Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
}

function unwrap<T>(result: Settled<T>): T {
  if (result.ok) return result.value;
  throw result.error;
}

function resultsDiffer<T>(left: Settled<T>, right: Settled<T>): boolean {
  if (left.ok !== right.ok) return true;
  if (!left.ok && !right.ok) {
    return getErrorMessage(left.error) !== getErrorMessage(right.error);
  }

  return false;
}

function summarizeResult<T>(result: Settled<T>) {
  if (result.ok) return { ok: true };
  return { ok: false, error: getErrorMessage(result.error) };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isLockedEditRecalculationError(error: unknown): boolean {
  return getErrorMessage(error) === "Locked invoices cannot be recalculated from order edits";
}
