import assert from "node:assert/strict";
import test from "node:test";
import {
  InvoiceLineType,
  OrderEntityKind,
  Prisma,
  SessionConfigurationInputType,
  SessionConfigurationLinkProductDisplay,
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
  assert.equal(fixedResult.nonLineDelta, null);
  assert.equal(fixedResult.lineItem?.lineType, InvoiceLineType.SESSION_CONFIGURATION);
  assert.equal(
    fixedResult.lineItem?.causeOrderEntityKind,
    OrderEntityKind.SESSION_CONFIGURATION_SELECTION
  );

  const tieredSelect = selection({
    id: "tiered-select-selection",
    label: "Age Range",
    priceDelta: "10.000",
    pricingMode: SessionConfigurationPricingMode.TIERED,
    inputType: SessionConfigurationInputType.SELECT,
  });
  assert.equal(
    priceSingleSelection(tieredSelect).lineItem?.description,
    "Age Range"
  );

  const tieredCounter = selection({
    id: "tiered-counter-selection",
    label: "Sibling Count",
    priceDelta: "15.000",
    pricingMode: SessionConfigurationPricingMode.TIERED,
    inputType: SessionConfigurationInputType.COUNTER,
    numericValue: "3.000",
  });
  assert.equal(
    priceSingleSelection(tieredCounter).lineItem?.description,
    "Sibling Count (×3)"
  );

  const linkedLine = selection({
    id: "linked-line-selection",
    label: "Cake",
    priceDelta: "8.000",
    pricingMode: SessionConfigurationPricingMode.LINKED_PRODUCT,
    inputType: SessionConfigurationInputType.TOGGLE,
    linkProductDisplay: SessionConfigurationLinkProductDisplay.LINE_ITEM,
  });
  assert.equal(priceSingleSelection(linkedLine).lineItem?.description, "Cake");

  const linkedModifier = selection({
    id: "linked-modifier-selection",
    label: "Album Color",
    priceDelta: "4.000",
    pricingMode: SessionConfigurationPricingMode.LINKED_PRODUCT,
    inputType: SessionConfigurationInputType.SELECT,
    linkProductDisplay: SessionConfigurationLinkProductDisplay.MODIFIER_ONLY,
  });
  const linkedModifierResult = priceSingleSelection(linkedModifier);
  assert.equal(linkedModifierResult.lineItem, null);
  assert.equal(linkedModifierResult.nonLineDelta?.toFixed(3), "4.000");

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
  assert.equal(operationalResult.nonLineDelta?.toFixed(3), "0.000");

  const mixed = priceSelections([
    fixed,
    tieredSelect,
    tieredCounter,
    linkedLine,
    linkedModifier,
    operational,
  ]);
  assert.equal(mixed.lineItems.length, 4);
  assert.equal(mixed.nonLineDelta.toFixed(3), "4.000");
  assert.equal(mixed.totalDelta.toFixed(3), "62.000");
});

function selection(input: {
  id: string;
  label: string;
  priceDelta: string;
  pricingMode: SessionConfigurationPricingMode;
  inputType: SessionConfigurationInputType;
  linkProductDisplay?: SessionConfigurationLinkProductDisplay | null;
  numericValue?: string | null;
}): PricedSelection {
  return {
    id: input.id,
    snapshotConfigurationCode: input.id.toUpperCase().replace(/-/g, "_"),
    snapshotLabel: input.label,
    snapshotPriceDelta: new Prisma.Decimal(input.priceDelta),
    snapshotPricingMode: input.pricingMode,
    snapshotInputType: input.inputType,
    snapshotLinkProductDisplay: input.linkProductDisplay ?? null,
    snapshotLinkedProductId: null,
    numericValue: input.numericValue ? new Prisma.Decimal(input.numericValue) : null,
  };
}
