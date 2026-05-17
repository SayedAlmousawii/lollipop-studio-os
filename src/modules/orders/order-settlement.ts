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

export function deriveSettlementPaidAmount(invoice: {
  totalAmount: Prisma.Decimal.Value;
  remainingAmount: Prisma.Decimal.Value;
}): Prisma.Decimal {
  return Prisma.Decimal.max(
    new Prisma.Decimal(invoice.totalAmount).minus(invoice.remainingAmount),
    0
  );
}

export function derivePaymentSummary(input: {
  invoice: {
    totalAmount: Prisma.Decimal.Value;
    remainingAmount: Prisma.Decimal.Value;
  };
  finalizedAdjustments: Array<{
    totalAmount: Prisma.Decimal.Value;
    remainingAmount: Prisma.Decimal.Value;
  }>;
  orderId?: string;
}): {
  effectiveTotal: number;
  paid: number;
  remaining: number;
} {
  const effectiveTotalDecimal = input.finalizedAdjustments.reduce(
    (sum, adjustment) => sum.plus(adjustment.totalAmount),
    new Prisma.Decimal(input.invoice.totalAmount)
  );
  const paidDecimal = [input.invoice, ...input.finalizedAdjustments].reduce(
    (sum, invoice) => sum.plus(deriveSettlementPaidAmount(invoice)),
    zeroMoney()
  );
  const rawRemaining = effectiveTotalDecimal.minus(paidDecimal);
  if (rawRemaining.lt(0)) {
    console.error(
      JSON.stringify({
        metric: "sales_page.locked.payment_summary.negative_remaining",
        orderId: input.orderId ?? null,
        effectiveTotal: effectiveTotalDecimal.toFixed(3),
        paid: paidDecimal.toFixed(3),
        remaining: rawRemaining.toFixed(3),
      })
    );
  }

  return {
    effectiveTotal: effectiveTotalDecimal.toNumber(),
    paid: paidDecimal.toNumber(),
    remaining: Prisma.Decimal.max(rawRemaining, 0).toNumber(),
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
