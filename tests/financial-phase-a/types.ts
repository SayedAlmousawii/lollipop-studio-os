export type PhaseAViolation = {
  layer: "L0" | "L1" | "L2";
  invariant: string;
  entityType: string;
  entityId: string;
  expected: string;
  actual: string;
};

export type PhaseACheck = {
  code: string;
  description: string;
  run: () => Promise<PhaseAViolation[]>;
};

export function violation(input: PhaseAViolation): PhaseAViolation {
  return input;
}
