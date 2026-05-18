import assert from "node:assert/strict";
import test from "node:test";
import {
  InvoiceLineType,
  OrderEntityKind,
  Prisma,
  SessionConfigurationInputType,
  SessionConfigurationPricingMode,
} from "@prisma/client";
import {
  priceSelections,
  priceSingleSelection,
  type PricedSelection,
} from "@/modules/session-configurations/session-configuration-pricing";

test("session configuration pricing maps snapshot selections to totals and invoice drafts", () => {
  const fixed = selection({
    id: "fixed-selection",
    label: "Twins",
    priceDelta: "25.000",
    pricingMode: SessionConfigurationPricingMode.FIXED,
    inputType: SessionConfigurationInputType.TOGGLE,
  });
  const fixedResult = priceSingleSelection(fixed);
  assert.equal(fixedResult.lineDelta?.toFixed(3), "25.000");
  assert.equal(fixedResult.lineItem?.lineType, InvoiceLineType.SESSION_CONFIGURATION);
  assert.equal(
    fixedResult.lineItem?.causeOrderEntityKind,
    OrderEntityKind.SESSION_CONFIGURATION_SELECTION
  );

  const tieredSelect = selection({
    id: "tiered-select-selection",
    label: "Age Range",
    optionLabel: "30-45 Days",
    priceDelta: "10.000",
    pricingMode: SessionConfigurationPricingMode.TIERED,
    inputType: SessionConfigurationInputType.SELECT,
  });
  assert.equal(
    priceSingleSelection(tieredSelect).lineItem?.description,
    "Age Range — 30-45 Days"
  );

  const tieredCounter = selection({
    id: "tiered-counter-selection",
    label: "Sibling Count",
    optionLabel: "Tier 3+",
    priceDelta: "15.000",
    pricingMode: SessionConfigurationPricingMode.TIERED,
    inputType: SessionConfigurationInputType.COUNTER,
    numericValue: "3.000",
  });
  assert.equal(
    priceSingleSelection(tieredCounter).lineItem?.description,
    "Sibling Count — Tier 3+"
  );

  const linkedProduct = selection({
    id: "linked-line-selection",
    label: "Cake",
    priceDelta: "0.000",
    pricingMode: SessionConfigurationPricingMode.LINKED_PRODUCT,
    inputType: SessionConfigurationInputType.TOGGLE,
  });
  const linkedProductResult = priceSingleSelection(linkedProduct);
  assert.equal(linkedProductResult.lineItem, null);
  assert.equal(linkedProductResult.lineDelta?.toFixed(3), "0.000");

  const operational = selection({
    id: "operational-selection",
    label: "Cake Theme",
    priceDelta: "99.000",
    pricingMode: SessionConfigurationPricingMode.NONE,
    inputType: SessionConfigurationInputType.TEXT,
  });
  const operationalResult = priceSingleSelection(operational);
  assert.equal(operationalResult.lineItem, null);
  assert.equal(operationalResult.lineDelta?.toFixed(3), "0.000");

  const mixed = priceSelections([
    fixed,
    tieredSelect,
    tieredCounter,
    linkedProduct,
    operational,
  ]);
  assert.equal(mixed.lineItems.length, 3);
  assert.equal(mixed.totalDelta.toFixed(3), "50.000");
});

function selection(input: {
  id: string;
  label: string;
  priceDelta: string;
  pricingMode: SessionConfigurationPricingMode;
  inputType: SessionConfigurationInputType;
  optionLabel?: string | null;
  numericValue?: string | null;
}): PricedSelection {
  return {
    id: input.id,
    snapshotConfigurationCode: input.id.toUpperCase().replace(/-/g, "_"),
    snapshotLabel: input.label,
    snapshotPriceDelta: new Prisma.Decimal(input.priceDelta),
    snapshotPricingMode: input.pricingMode,
    snapshotInputType: input.inputType,
    snapshotOptionLabel: input.optionLabel ?? null,
    snapshotLinkedProductId: null,
    orderAddOnId: null,
    numericValue: input.numericValue ? new Prisma.Decimal(input.numericValue) : null,
  };
}
