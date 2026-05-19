import type {
  FinancialCaseDepositInvoiceSummary,
  FinancialCaseFinalInvoiceSummary,
  FinancialCasePaymentStatus,
  FinancialCaseSummary,
} from "../financial-case-summary.types";

export type BookingPageFinancialProjection =
  | {
      stage: "booking";
      depositInvoice: FinancialCaseDepositInvoiceSummary | null;
      depositPaid: boolean;
      awaitingFinalInvoiceAfterCheckIn: boolean;
      finalInvoicePending: boolean;
    }
  | {
      stage: "active";
      depositInvoice: FinancialCaseDepositInvoiceSummary | null;
      finalInvoice: Pick<
        FinancialCaseFinalInvoiceSummary,
        "id" | "invoiceNumber" | "total" | "remaining" | "status" | "isLocked"
      >;
      remaining: number;
      paymentStatusEnum: FinancialCasePaymentStatus;
    };

export function toBookingPageFinancial(
  summary: FinancialCaseSummary
): BookingPageFinancialProjection {
  if (summary.stage === "booking") {
    return {
      stage: "booking",
      depositInvoice: summary.depositInvoice,
      depositPaid: summary.depositPaid,
      awaitingFinalInvoiceAfterCheckIn: summary.awaitingFinalInvoiceAfterCheckIn,
      finalInvoicePending: summary.finalInvoicePending,
    };
  }

  return {
    stage: "active",
    depositInvoice: summary.depositInvoice,
    finalInvoice: {
      id: summary.finalInvoice.id,
      invoiceNumber: summary.finalInvoice.invoiceNumber,
      total: summary.finalInvoice.total,
      remaining: summary.finalInvoice.remaining,
      status: summary.finalInvoice.status,
      isLocked: summary.finalInvoice.isLocked,
    },
    remaining: summary.remaining,
    paymentStatusEnum: summary.paymentStatusEnum,
  };
}
