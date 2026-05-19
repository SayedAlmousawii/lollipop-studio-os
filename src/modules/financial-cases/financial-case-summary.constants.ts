import type { FinancialCasePaymentStatus } from "./financial-case-summary.types";

export const FINANCIAL_CASE_PAYMENT_STATUS_LABELS = {
  UNPAID: "Unpaid",
  PARTIAL: "Partially paid",
  PAID: "Paid",
  OVERPAID: "Overpaid",
  REFUNDED: "Refunded",
} satisfies Record<FinancialCasePaymentStatus, string>;
