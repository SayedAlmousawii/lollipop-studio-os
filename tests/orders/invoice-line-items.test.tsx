import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InvoiceLineItems } from "@/components/financial/invoice-line-items";

test("InvoiceLineItems groups session configuration lines under one subheading", () => {
  const markup = renderToStaticMarkup(
    createElement(InvoiceLineItems, {
      lineItems: [
        line("package", "PACKAGE_BASE", "Classic Package"),
        line("config-1", "SESSION_CONFIGURATION", "Age Range — 30-45 Days"),
        line("addon", "ADD_ON", "Cake"),
        line("config-2", "SESSION_CONFIGURATION", "Sibling count — Tier 3+"),
        line("photos", "EXTRA_PHOTOS", "Extra Photos"),
      ],
    })
  );

  assert.equal(markup.match(/Session Configuration/g)?.length, 1);
  assertInOrder(markup, [
    "Classic Package",
    "Cake",
    "Extra Photos",
    "Session Configuration",
    "Age Range",
    "Sibling count",
  ]);
});

test("InvoiceLineItems omits session configuration subheading when absent", () => {
  const markup = renderToStaticMarkup(
    createElement(InvoiceLineItems, {
      lineItems: [line("package", "PACKAGE_BASE", "Classic Package")],
    })
  );

  assert.doesNotMatch(markup, /Session Configuration/);
});

function line(id: string, lineType: string, description: string) {
  return {
    id,
    lineType,
    description,
    quantity: 1,
    unitPrice: "10.000 KD",
    lineTotal: "10.000 KD",
  };
}

function assertInOrder(markup: string, labels: string[]) {
  let previousIndex = -1;
  for (const label of labels) {
    const index = markup.indexOf(label);
    assert.ok(index > previousIndex, `${label} should follow the previous label`);
    previousIndex = index;
  }
}
