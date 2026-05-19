import type { LinkedFinancialDocument } from "@/modules/orders/order.types";
import { formatSignedMoney } from "@/lib/formatting/money";

export function formatSignedDocumentAmount(
  document: LinkedFinancialDocument
): string {
  const amount =
    document.invoiceType === "REFUND" || document.invoiceType === "CREDIT_NOTE"
      ? -document.invoiceTotal
      : document.invoiceTotal;
  return formatSignedMoney(amount);
}

export function formatEnumLabel(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
