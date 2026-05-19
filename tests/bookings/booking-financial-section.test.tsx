import assert from "node:assert/strict";
import test from "node:test";
import { InvoiceStatus } from "@prisma/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BookingFinancialSection } from "@/components/bookings/booking-financial-section";
import type { BookingPageFinancialProjection } from "@/modules/financial-cases";

test("BookingFinancialSection renders booking-stage deposit projection", () => {
  const markup = renderToStaticMarkup(
    createElement(BookingFinancialSection, {
      bookingReference: "BK-2026-00001",
      financial: bookingStageProjection(),
    })
  );

  assert.match(markup, /Financial Summary/);
  assert.match(markup, /INV-DEP-1/);
  assert.match(markup, /20\.000 KD/);
  assert.match(markup, /Deposit paid/);
  assert.match(markup, /Pending after check-in/);
  assert.match(markup, /Awaiting final invoice after check-in/);
  assert.match(markup, /Locked/);
  assert.doesNotMatch(markup, /Remaining at session/);
});

test("BookingFinancialSection renders active-stage final invoice projection", () => {
  const markup = renderToStaticMarkup(
    createElement(BookingFinancialSection, {
      bookingReference: "BK-2026-00002",
      financial: activeStageProjection(),
    })
  );

  assert.match(markup, /INV-DEP-2/);
  assert.match(markup, /INV-FINAL-2/);
  assert.match(markup, /Final invoice total/);
  assert.match(markup, /150\.000 KD/);
  assert.match(markup, /Remaining/);
  assert.match(markup, /30\.000 KD/);
  assert.match(markup, /Partially paid/);
  assert.doesNotMatch(markup, /Remaining at session/);
});

test("BookingFinancialSection renders no synthetic financial values for pending bookings", () => {
  const markup = renderToStaticMarkup(
    createElement(BookingFinancialSection, {
      bookingReference: "Pending",
      financial: null,
    })
  );

  assert.equal(markup, "");
});

function bookingStageProjection(): BookingPageFinancialProjection {
  return {
    stage: "booking",
    depositInvoice: {
      id: "invoice-deposit-1",
      invoiceNumber: "INV-DEP-1",
      total: 20,
      paidAmount: 20,
      status: InvoiceStatus.CLOSED,
      isLocked: true,
    },
    depositPaid: true,
    awaitingFinalInvoiceAfterCheckIn: true,
    finalInvoicePending: true,
  };
}

function activeStageProjection(): BookingPageFinancialProjection {
  return {
    stage: "active",
    depositInvoice: {
      id: "invoice-deposit-2",
      invoiceNumber: "INV-DEP-2",
      total: 20,
      paidAmount: 20,
      status: InvoiceStatus.CLOSED,
      isLocked: true,
    },
    finalInvoice: {
      id: "invoice-final-2",
      invoiceNumber: "INV-FINAL-2",
      total: 150,
      remaining: 30,
      status: InvoiceStatus.ISSUED,
      isLocked: false,
    },
    remaining: 30,
    paymentStatusEnum: "PARTIAL",
  };
}
