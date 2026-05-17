import assert from "node:assert/strict";
import test from "node:test";
import {
  SessionConfigurationCounterPricingMode,
  SessionConfigurationFinancialBehavior,
  SessionConfigurationInputType,
  SessionConfigurationPricingMode,
} from "@prisma/client";
import { createSessionConfigurationSchema } from "@/modules/session-configurations/session-configuration.schema";

test("session configuration schema enforces cross-field invariants", () => {
  assertInvalid(
    {
      pricingMode: SessionConfigurationPricingMode.FIXED,
      fixedPriceDelta: undefined,
    },
    /Fixed price delta/
  );
  assertInvalid(
    {
      pricingMode: SessionConfigurationPricingMode.LINKED_PRODUCT,
      linkedProductId: "",
      linkProductDisplay: undefined,
    },
    /Linked product/
  );
  assertInvalid(
    {
      inputType: SessionConfigurationInputType.COUNTER,
      pricingMode: SessionConfigurationPricingMode.FIXED,
      fixedPriceDelta: 10,
      counterPricingMode: SessionConfigurationCounterPricingMode.PER_UNIT,
      counterUnitPrice: undefined,
    },
    /Counter unit price/
  );
  assertInvalid(
    {
      inputType: SessionConfigurationInputType.SELECT,
      pricingMode: SessionConfigurationPricingMode.NONE,
      options: [],
    },
    /Select configurations/
  );
  assertInvalid(
    {
      inputType: SessionConfigurationInputType.TEXT,
      pricingMode: SessionConfigurationPricingMode.TIERED,
    },
    /Tiered pricing/
  );
});

function assertInvalid(
  patch: Partial<Parameters<typeof createSessionConfigurationSchema.safeParse>[0]>,
  message: RegExp
) {
  const parsed = createSessionConfigurationSchema.safeParse({
    sessionTypeId: "session-type-1",
    name: "Twins",
    inputType: SessionConfigurationInputType.TOGGLE,
    pricingMode: SessionConfigurationPricingMode.NONE,
    financialBehavior: SessionConfigurationFinancialBehavior.OPERATIONAL,
    required: false,
    sortOrder: 0,
    fixedPriceDelta: undefined,
    linkedProductId: undefined,
    linkProductDisplay: undefined,
    counterPricingMode: undefined,
    counterUnitPrice: undefined,
    options: [],
    ...patch,
  });

  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.match(parsed.error.message, message);
  }
}
