import type { OrderCommitDraftLineTarget } from "./order-commit-draft.types";
import type {
  OrderCommitSnapshotLineV1,
  OrderCommitSnapshotV1,
} from "./order-commit.types";

type TargetField = keyof Pick<
  OrderCommitDraftLineTarget,
  "stableKey" | "lineId" | "orderEntityId" | "draftEntityId"
>;

const TARGET_FIELDS: TargetField[] = [
  "stableKey",
  "lineId",
  "orderEntityId",
  "draftEntityId",
];

export function resolveOrderCommitDraftTargetLine(
  snapshot: OrderCommitSnapshotV1,
  target: OrderCommitDraftLineTarget,
  options: {
    errorPrefix: string;
    targetDescription: string;
  }
): OrderCommitSnapshotLineV1 {
  const resolved = TARGET_FIELDS.flatMap((field) => {
    const value = target[field];
    if (!value) return [];

    const matches = snapshot.lines.filter((line) =>
      targetFieldMatchesLine(line, field, value)
    );
    if (matches.length === 0) {
      throw new Error(
        `${options.errorPrefix}: ${options.targetDescription} not found.`
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `${options.errorPrefix}: ${options.targetDescription} matched multiple lines for ${field}.`
      );
    }
    return matches;
  });

  const first = resolved[0];
  if (!first) {
    throw new Error(
      `${options.errorPrefix}: ${options.targetDescription} not found.`
    );
  }

  if (resolved.some((line) => line.lineId !== first.lineId)) {
    throw new Error(
      `${options.errorPrefix}: ${options.targetDescription} matched multiple lines from contradictory target identity fields.`
    );
  }

  return first;
}

function targetFieldMatchesLine(
  line: OrderCommitSnapshotLineV1,
  field: TargetField,
  value: string
): boolean {
  if (field === "draftEntityId") {
    return line.orderEntityId === value;
  }
  return line[field] === value;
}
