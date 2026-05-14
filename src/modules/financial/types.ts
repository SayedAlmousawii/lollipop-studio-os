import type { Prisma } from "@prisma/client";

export type Money = Prisma.Decimal;
export type FinancialInvoiceType =
  | "DEPOSIT"
  | "FINAL"
  | "ADJUSTMENT"
  | "REFUND"
  | "CREDIT_NOTE"
  | "SALE";
export type FinancialPaymentDirection = "IN" | "OUT";

type FinancialInvoiceBase = {
  financialCaseId: string;
  customerId: string;
  totalAmount: Money;
  paidAmount?: Money;
  remainingAmount?: Money;
};

export type DepositInvoiceShape = FinancialInvoiceBase & {
  invoiceType: "DEPOSIT";
  bookingId?: string | null;
  orderId?: never;
  parentInvoiceId?: never;
};

export type FinalInvoiceShape = FinancialInvoiceBase & {
  invoiceType: "FINAL";
  bookingId?: string | null;
  orderId?: string | null;
  parentInvoiceId?: never;
};

export type AdjustmentInvoiceShape = FinancialInvoiceBase & {
  invoiceType: "ADJUSTMENT";
  orderId?: string | null;
  parentInvoiceId?: string | null;
};

export type RefundInvoiceShape = FinancialInvoiceBase & {
  invoiceType: "REFUND";
  parentInvoiceId?: string | null;
};

export type CreditNoteInvoiceShape = FinancialInvoiceBase & {
  invoiceType: "CREDIT_NOTE";
  parentInvoiceId?: string | null;
};

export type SaleInvoiceShape = FinancialInvoiceBase & {
  invoiceType: "SALE";
};

export type FinancialInvoiceShape =
  | DepositInvoiceShape
  | FinalInvoiceShape
  | AdjustmentInvoiceShape
  | RefundInvoiceShape
  | CreditNoteInvoiceShape
  | SaleInvoiceShape;
