export const FINANCIAL_REARCH_PHASE_2_AUTO_ADJUSTMENT =
  "FINANCIAL_REARCH_PHASE_2_AUTO_ADJUSTMENT";

export function isFinancialFeatureEnabled(flagKey: string): boolean {
  const configuredValue = process.env[flagKey];
  if (configuredValue === undefined) return true;

  return !["0", "false", "off", "no"].includes(configuredValue.toLowerCase());
}
