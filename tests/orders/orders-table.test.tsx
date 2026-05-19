import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OrdersTable } from "@/components/orders/orders-table";
import type { Order } from "@/modules/orders/order.types";

test("OrdersTable renders canonical financial projection amounts and status", () => {
  const markup = renderToStaticMarkup(
    createElement(OrdersTable, {
      orders: [
        orderFixture({
          financial: {
            totalAmount: 230,
            paidAmount: 100,
            remainingAmount: 130,
            paymentStatusEnum: "PARTIAL",
          },
        }),
      ],
    })
  );

  assert.match(markup, /230\.000 KD/);
  assert.match(markup, /100\.000 KD/);
  assert.match(markup, /130\.000 KD/);
  assert.match(markup, /Partially paid/);
});

test("OrdersTable renders explicit missing financial case state", () => {
  const markup = renderToStaticMarkup(
    createElement(OrdersTable, {
      orders: [orderFixture({ financial: null })],
    })
  );

  assert.match(markup, /No active financial case/);
});

function orderFixture(overrides: Pick<Order, "financial">): Order {
  return {
    id: "order-1",
    jobNumber: "JOB-1",
    customerPhone: "55500000",
    bookingDate: "2026-05-17",
    originalPackageName: "Classic",
    finalPackageName: "Classic",
    orderStatus: "Selection Completed",
    invoiceStatus: "Partial",
    paymentStatus: "Partially paid",
    totalAmount: "999.000 KD",
    paidAmount: "999.000 KD",
    remainingAmount: "999.000 KD",
    financial: overrides.financial,
    createdAt: "2026-05-17",
    primaryInvoiceId: "invoice-1",
    primaryInvoiceNumber: "INV-1",
    hasOpenAdjustmentWorkspace: false,
  };
}
