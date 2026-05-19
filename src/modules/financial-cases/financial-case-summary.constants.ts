import type { FinancialCasePaymentStatus } from "./financial-case-summary.types";
import type { OrderPaymentStatusLabel } from "@/modules/orders/order.types";

export const FINANCIAL_CASE_PAYMENT_STATUS_LABELS = {
  UNPAID: "Unpaid",
  PARTIAL: "Partially paid",
  PAID: "Paid",
  OVERRIDDEN: "Overridden",
  OVERPAID: "Overpaid",
  REFUNDED: "Refunded",
} satisfies Record<FinancialCasePaymentStatus, string>;

export function mapFinancialCasePaymentStatusToLabel(
  status: FinancialCasePaymentStatus
): OrderPaymentStatusLabel {
  switch (status) {
    case "UNPAID":
      return "Pending";
    case "PARTIAL":
      return "Partially paid";
    case "PAID":
    case "OVERPAID":
    case "REFUNDED":
      return "Paid";
    case "OVERRIDDEN":
      return "Overridden";
  }
}
