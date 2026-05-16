import { InvoiceType, Prisma } from "@prisma/client";
import type { OrderSettlementSummary } from "./order.types";

export function computeOrderSettlementSummary(input: {
  invoices: Array<{
    invoiceType: InvoiceType;
    totalAmount: Prisma.Decimal;
    remainingAmount: Prisma.Decimal;
  }>;
}): OrderSettlementSummary {
  const chargeInvoices = input.invoices.filter(isSettlementChargeInvoice);
  const chargeTotal = chargeInvoices.reduce(
    (sum, invoice) => sum.plus(invoice.totalAmount),
    zeroMoney()
  );
  const creditNoteTotal = input.invoices
    .filter((invoice) => invoice.invoiceType === InvoiceType.CREDIT_NOTE)
    .reduce((sum, invoice) => sum.plus(invoice.totalAmount), zeroMoney());
  const totalOrderValue = Prisma.Decimal.max(chargeTotal.minus(creditNoteTotal), 0);
  const rawOutstanding = chargeInvoices.reduce(
    (sum, invoice) => sum.plus(invoice.remainingAmount),
    zeroMoney()
  );
  const hasOverpayment = rawOutstanding.lt(0);
  if (hasOverpayment) {
    console.error(
      `order.settlement_summary.negative_outstanding: ${rawOutstanding.toFixed(3)}`
    );
  }
  const outstandingAmount = Prisma.Decimal.max(rawOutstanding, 0);
  const paidAmount = Prisma.Decimal.max(totalOrderValue.minus(outstandingAmount), 0);
  const refundedAmount = input.invoices
    .filter((invoice) => invoice.invoiceType === InvoiceType.REFUND)
    .reduce((sum, invoice) => sum.plus(invoice.totalAmount), zeroMoney());

  return {
    totalOrderValue: totalOrderValue.toNumber(),
    paidAmount: paidAmount.toNumber(),
    outstandingAmount: outstandingAmount.toNumber(),
    refundedAmount: refundedAmount.toNumber(),
    hasOverpayment,
  };
}

function isSettlementChargeInvoice(invoice: { invoiceType: InvoiceType }): boolean {
  return (
    invoice.invoiceType === InvoiceType.FINAL ||
    invoice.invoiceType === InvoiceType.ADJUSTMENT ||
    invoice.invoiceType === InvoiceType.SALE
  );
}

function zeroMoney(): Prisma.Decimal {
  return new Prisma.Decimal(0);
}
