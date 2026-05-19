import assert from "node:assert/strict";
import test from "node:test";
import { InvoiceType, Prisma } from "@prisma/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderSettlementSummary } from "@/components/orders/order-settlement-summary";
import {
  computeOrderSettlementSummary,
  deriveLockedFinancialSidebarSummary,
  derivePaymentSummary,
} from "@/modules/orders/order-settlement";

test("computeOrderSettlementSummary uses canonical remaining balances", async (t) => {
  await t.test("FINAL 230 with 130 remaining displays paid 100", () => {
    assert.deepEqual(
      computeOrderSettlementSummary({
        invoices: [
          invoice(InvoiceType.FINAL, {
            totalAmount: 230,
            remainingAmount: 130,
          }),
        ],
      }),
      {
        totalOrderValue: 230,
        paidAmount: 100,
        outstandingAmount: 130,
        refundedAmount: 0,
        hasOverpayment: false,
      }
    );
  });

  await t.test("REFUND invoices stay out of the paid bucket", () => {
    assert.deepEqual(
      computeOrderSettlementSummary({
        invoices: [
          invoice(InvoiceType.FINAL, {
            totalAmount: 230,
            remainingAmount: 130,
          }),
          invoice(InvoiceType.REFUND, {
            totalAmount: 50,
            remainingAmount: 0,
          }),
        ],
      }),
      {
        totalOrderValue: 230,
        paidAmount: 100,
        outstandingAmount: 130,
        refundedAmount: 50,
        hasOverpayment: false,
      }
    );
  });

  await t.test("CREDIT_NOTE reduces collectible order value", () => {
    assert.deepEqual(
      computeOrderSettlementSummary({
        invoices: [
          invoice(InvoiceType.FINAL, {
            totalAmount: 230,
            remainingAmount: 0,
          }),
          invoice(InvoiceType.CREDIT_NOTE, {
            totalAmount: 50,
            remainingAmount: 0,
          }),
        ],
      }),
      {
        totalOrderValue: 180,
        paidAmount: 180,
        outstandingAmount: 0,
        refundedAmount: 0,
        hasOverpayment: false,
      }
    );
  });

  await t.test("negative outstanding clamps and logs", () => {
    const errors: unknown[] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    try {
      assert.deepEqual(
        computeOrderSettlementSummary({
          invoices: [
            invoice(InvoiceType.FINAL, {
              totalAmount: 230,
              remainingAmount: -25,
            }),
          ],
        }),
        {
          totalOrderValue: 230,
          paidAmount: 230,
          outstandingAmount: 0,
          refundedAmount: 0,
          hasOverpayment: true,
        }
      );
      assert.equal(errors.length, 1);
      assert.match(String((errors[0] as unknown[])[0]), /negative_outstanding/);
    } finally {
      console.error = originalConsoleError;
    }
  });
});

test("OrderSettlementSummary renders labels and formatted amounts", () => {
  const markup = renderToStaticMarkup(
    createElement(OrderSettlementSummary, {
      summary: {
        totalOrderValue: 230,
        paidAmount: 100,
        outstandingAmount: 130,
        refundedAmount: 50,
        hasOverpayment: false,
        paymentStatusEnum: "PARTIAL",
      },
    })
  );

  assert.match(markup, /Financials/);
  assert.match(markup, /130\.000 KD outstanding/);
  assert.match(markup, /Paid 100\.000 KD/);
  assert.match(markup, /Total 230\.000 KD/);
  assert.match(markup, /Refunded 50\.000 KD/);
  assert.match(markup, /Partially paid/);
});

test("OrderSettlementSummary renders explicit empty state without fallback totals", () => {
  const markup = renderToStaticMarkup(
    createElement(OrderSettlementSummary, {
      summary: null,
    })
  );

  assert.match(markup, /No active financial case/);
  assert.match(markup, /Paid —/);
  assert.doesNotMatch(markup, /230\.000 KD/);
  assert.doesNotMatch(markup, /100\.000 KD/);
  assert.doesNotMatch(markup, /130\.000 KD/);
});

test("derivePaymentSummary aggregates final and finalized adjustment settlement amounts", async (t) => {
  await t.test("deposit plus final only, fully paid", () => {
    assert.deepEqual(
      derivePaymentSummary({
        invoice: amounts(230, 0),
        finalizedAdjustments: [],
      }),
      {
        effectiveTotal: 230,
        paid: 230,
        remaining: 0,
      }
    );
  });

  await t.test("deposit plus finalized adjustment unpaid", () => {
    assert.deepEqual(
      derivePaymentSummary({
        invoice: amounts(230, 0),
        finalizedAdjustments: [amounts(40, 40)],
      }),
      {
        effectiveTotal: 270,
        paid: 230,
        remaining: 40,
      }
    );
  });

  await t.test("deposit plus finalized adjustment fully paid", () => {
    assert.deepEqual(
      derivePaymentSummary({
        invoice: amounts(230, 0),
        finalizedAdjustments: [amounts(40, 0)],
      }),
      {
        effectiveTotal: 270,
        paid: 270,
        remaining: 0,
      }
    );
  });

  await t.test("multiple finalized adjustments with partial payments", () => {
    assert.deepEqual(
      derivePaymentSummary({
        invoice: amounts(230, 0),
        finalizedAdjustments: [amounts(40, 10), amounts(30, 15)],
      }),
      {
        effectiveTotal: 300,
        paid: 275,
        remaining: 25,
      }
    );
  });
});

test("deriveLockedFinancialSidebarSummary prepares locked sidebar display totals", () => {
  assert.deepEqual(
    deriveLockedFinancialSidebarSummary({
      finalInvoice: {
        totalAmount: 201,
        remainingAmount: 0,
        depositPaidAmount: 20,
      },
      finalizedAdjustments: [amounts(45, 0), amounts(65, 65)],
    }),
    {
      customerTotal: 311,
      paidSoFar: 246,
      includesDeposit: 20,
      remaining: 65,
      finalInvoiceTotal: 201,
      totalAdjustments: 110,
      finalTotal: 311,
    }
  );
});

function invoice(
  invoiceType: InvoiceType,
  amounts: { totalAmount: number; remainingAmount: number }
) {
  return {
    invoiceType,
    totalAmount: new Prisma.Decimal(amounts.totalAmount),
    remainingAmount: new Prisma.Decimal(amounts.remainingAmount),
  };
}

function amounts(totalAmount: number, remainingAmount: number) {
  return {
    totalAmount: new Prisma.Decimal(totalAmount),
    remainingAmount: new Prisma.Decimal(remainingAmount),
  };
}
