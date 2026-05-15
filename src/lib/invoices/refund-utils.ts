export function moneyInputValue(value: string): string {
  const match = value.match(/-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/);
  const parsedValue = Number(match?.[0].replace(/,/g, "") ?? 0);
  return Number.isFinite(parsedValue) ? parsedValue.toFixed(3) : "0.000";
}

export function shouldShowRefundForm(
  overpaymentCapacity: string | null
): boolean {
  if (overpaymentCapacity === null) return false;
  return parseFloat(moneyInputValue(overpaymentCapacity)) > 0;
}
