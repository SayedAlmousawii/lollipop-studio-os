const DEFAULT_TOLERANCE = 0.0005;

export type ProjectionDiscrepancy = {
  field: string;
  legacyValue: unknown;
  projectorValue: unknown;
  delta?: number;
};

type CompareContext = {
  metric?: string;
  context: {
    financialCaseId?: string | null;
    orderId?: string | null;
    projector: string;
    [key: string]: string | number | boolean | null | undefined;
  };
  tolerance?: number;
};

export function compareSummaryWithLegacy(
  legacyDerivation: Record<string, unknown> | null,
  projectorOutput: Record<string, unknown> | null,
  options: CompareContext
): ProjectionDiscrepancy[] {
  const metric =
    options.metric ?? "centralization.financial_case_summary.discrepancy";
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const discrepancies = collectDiscrepancies(
    legacyDerivation,
    projectorOutput,
    tolerance
  );

  for (const discrepancy of discrepancies) {
    console.error(
      JSON.stringify({
        metric,
        ...options.context,
        field: discrepancy.field,
        legacyValue: discrepancy.legacyValue,
        projectorValue: discrepancy.projectorValue,
        ...(discrepancy.delta === undefined
          ? {}
          : { delta: discrepancy.delta }),
      })
    );
  }

  return discrepancies;
}
export const compareWithLegacy = compareSummaryWithLegacy;

function collectDiscrepancies(
  legacyDerivation: Record<string, unknown> | null,
  projectorOutput: Record<string, unknown> | null,
  tolerance: number
): ProjectionDiscrepancy[] {
  if (legacyDerivation === null || projectorOutput === null) {
    if (legacyDerivation === projectorOutput) return [];
    return [
      {
        field: "projection",
        legacyValue: legacyDerivation,
        projectorValue: projectorOutput,
      },
    ];
  }

  const fields = new Set([
    ...Object.keys(legacyDerivation),
    ...Object.keys(projectorOutput),
  ]);
  const discrepancies: ProjectionDiscrepancy[] = [];

  for (const field of fields) {
    const legacyValue = legacyDerivation[field];
    const projectorValue = projectorOutput[field];

    if (typeof legacyValue === "number" && typeof projectorValue === "number") {
      const delta = Math.abs(legacyValue - projectorValue);
      if (delta > tolerance) {
        discrepancies.push({ field, legacyValue, projectorValue, delta });
      }
      continue;
    }

    if (legacyValue !== projectorValue) {
      discrepancies.push({ field, legacyValue, projectorValue });
    }
  }

  return discrepancies;
}
