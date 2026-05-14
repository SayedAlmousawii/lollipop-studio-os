export const FINANCIAL_REARCH_PHASE_2_AUTO_ADJUSTMENT =
  "FINANCIAL_REARCH_PHASE_2_AUTO_ADJUSTMENT";

const FINANCIAL_FEATURE_FLAG_KEYS = new Set([
  FINANCIAL_REARCH_PHASE_2_AUTO_ADJUSTMENT,
]);

export function isFinancialFeatureEnabled(flagKey: string): boolean {
  const normalizedFlagKey = flagKey.trim().toUpperCase();
  if (!FINANCIAL_FEATURE_FLAG_KEYS.has(normalizedFlagKey)) return false;

  const configuredValue = process.env[normalizedFlagKey];
  if (configuredValue === undefined) return true;

  return !["0", "false", "off", "no"].includes(configuredValue.toLowerCase());
}
