import type { LinkedFinancialDocument } from "@/modules/orders/order.types";
import { formatKD } from "@/components/orders/financial-sidebar-primitives";

export function formatSignedDocumentAmount(
  document: LinkedFinancialDocument
): string {
  const amount =
    document.invoiceType === "REFUND" || document.invoiceType === "CREDIT_NOTE"
      ? -document.invoiceTotal
      : document.invoiceTotal;
  return formatSignedKD(amount);
}

export function formatSignedKD(value: number): string {
  if (value > 0) return `+${formatKD(value)}`;
  if (value < 0) return `-${formatKD(Math.abs(value))}`;
  return formatKD(value);
}

export function formatEnumLabel(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
