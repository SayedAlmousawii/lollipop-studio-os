import { parseMoneyInput } from "@/lib/formatting/money";

export function shouldShowRefundForm(
  overpaymentCapacity: string | null
): boolean {
  if (overpaymentCapacity === null) return false;
  return parseMoneyInput(overpaymentCapacity) > 0;
}
