import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  orderCommitDraftStagingChangeSchema,
  orderCommitSnapshotV1Schema,
  reduceOrderCommitDraftSessionConfiguration,
  ORDER_COMMIT_DRAFT_STAGING_DOMAIN,
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_CURRENCY,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
  ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
  type OrderCommitDraftStagingChange,
  type OrderCommitSnapshotLineV1,
  type OrderCommitSnapshotV1,
  type ResolvedOrderCommitDraftSessionConfigurationSelection,
} from "@/modules/order-commits";
import { findSalesSessionConfigurationSnapshotTarget } from "@/modules/order-commits/sales-session-configuration-staging";

type SessionConfigurationStagingChange = Extract<
  OrderCommitDraftStagingChange,
  { domain: typeof ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION }
>;

test("upserts a financial session configuration from resolved pricing input", () => {
  const snapshot = snapshotFixture({ lines: [packageLine()] });
  const before = structuredClone(snapshot);

  const reduced = reduceOrderCommitDraftSessionConfiguration(snapshot, {
    change: sessionConfigurationChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION,
      action: "UPSERT",
      parentPackageTarget: { stableKey: "order-package:order-package-1" },
      configurationId: "configuration-backdrop",
      optionId: "option-gold",
      draftSelectionId: "draft:selection-backdrop",
    }),
    resolvedSelection: resolvedSelection({
      configurationId: "configuration-backdrop",
      optionId: "option-gold",
      snapshotConfigurationCode: "BACKDROP",
      snapshotLabel: "Backdrop",
      snapshotOptionLabel: "Gold",
      snapshotPriceDelta: 12.5,
      snapshotFinancialBehavior: "FINANCIAL",
      snapshotPricingMode: "FIXED",
    }),
  });

  assert.deepEqual(snapshot, before);
  assert.doesNotThrow(() => orderCommitSnapshotV1Schema.parse(reduced));

  const line = requireLine(reduced, "session-config:draft:selection-backdrop");
  assert.equal(line.lineKind, ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION);
  assert.equal(
    line.orderEntityKind,
    ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION
  );
  assert.equal(line.orderEntityId, "draft:selection-backdrop");
  assert.equal(line.parentOrderPackageId, "order-package-1");
  assert.equal(line.catalogEntityId, "configuration-backdrop");
  assert.equal(
    line.stableKey,
    "session-configuration-selection:draft:selection-backdrop"
  );
  assert.match(line.label, /Backdrop/);
  assert.match(line.label, /Gold/);
  assert.equal(line.quantity, 1);
  assert.equal(line.unitPrice, 12.5);
  assert.equal(line.lineTotal, 12.5);
  assert.equal(
    line.priceSource,
    ORDER_COMMIT_PRICE_SOURCE.SESSION_CONFIGURATION_SELECTION_SNAPSHOT
  );
  assert.deepEqual(line.metadata, {
    configurationId: "configuration-backdrop",
    numericValue: null,
    optionId: "option-gold",
    orderAddOnId: null,
    snapshotConfigurationCode: "BACKDROP",
    snapshotFinancialBehavior: "FINANCIAL",
    snapshotInputType: "SELECT",
    snapshotLabel: "Backdrop",
    snapshotLinkedProductId: null,
    snapshotOptionLabel: "Gold",
    snapshotPriceDelta: 12.5,
    snapshotPricingMode: "FIXED",
    textValue: null,
  });
  assert.deepEqual(reduced.totals, {
    subtotal: 112.5,
    discountTotal: 0,
    netTotal: 112.5,
  });
});

test("preserves zero-value operational selections as explicit snapshot lines", () => {
  const snapshot = snapshotFixture({ lines: [packageLine()] });

  const reduced = reduceOrderCommitDraftSessionConfiguration(snapshot, {
    change: sessionConfigurationChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION,
      action: "UPSERT",
      parentPackageTarget: { stableKey: "order-package:order-package-1" },
      configurationId: "configuration-finish",
      optionId: "option-matte",
      draftSelectionId: "draft:selection-finish",
    }),
    resolvedSelection: resolvedSelection({
      configurationId: "configuration-finish",
      optionId: "option-matte",
      snapshotConfigurationCode: "FINISH",
      snapshotLabel: "Finish",
      snapshotOptionLabel: "Matte",
      snapshotFinancialBehavior: "OPERATIONAL",
      snapshotPricingMode: "NONE",
    }),
  });

  const line = requireLine(reduced, "session-config:draft:selection-finish");
  assert.equal(line.label, "Finish - Matte");
  assert.equal(line.quantity, 1);
  assert.equal(line.unitPrice, 0);
  assert.equal(line.lineTotal, 0);
  assert.deepEqual(reduced.totals, {
    subtotal: 100,
    discountTotal: 0,
    netTotal: 100,
  });
});

test("creates a linked-product selection and draft add-on as a coupled pair", () => {
  const snapshot = snapshotFixture({ lines: [packageLine()] });
  const before = structuredClone(snapshot);

  const reduced = reduceOrderCommitDraftSessionConfiguration(snapshot, {
    change: sessionConfigurationChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION,
      action: "UPSERT",
      parentPackageTarget: { stableKey: "order-package:order-package-1" },
      configurationId: "configuration-album",
      optionId: "option-album",
      draftSelectionId: "draft:selection-album",
      linkedProduct: {
        productId: "product-album",
        draftOrderAddOnId: "draft:addon-album",
      },
    }),
    resolvedSelection: resolvedSelection({
      configurationId: "configuration-album",
      optionId: "option-album",
      snapshotConfigurationCode: "ALBUM",
      snapshotLabel: "Album",
      snapshotLinkedProductId: "product-album",
      snapshotOptionLabel: "Album",
      snapshotFinancialBehavior: "FINANCIAL",
      snapshotPricingMode: "LINKED_PRODUCT",
    }),
    resolvedLinkedProduct: {
      productId: "product-album",
      label: "Premium Album",
      unitPrice: 45,
      notes: "selection-owned",
    },
  });

  assert.deepEqual(snapshot, before);
  assert.doesNotThrow(() => orderCommitSnapshotV1Schema.parse(reduced));

  const selection = requireLine(reduced, "session-config:draft:selection-album");
  assert.equal(selection.quantity, 1);
  assert.equal(selection.unitPrice, 0);
  assert.equal(selection.lineTotal, 0);
  assert.equal(selection.metadata.orderAddOnId, null);
  assert.equal(selection.metadata.draftOrderAddOnId, "draft:addon-album");
  assert.equal(selection.metadata.snapshotLinkedProductId, "product-album");

  const linkedAddOn = requireLine(
    reduced,
    "session-config:draft:selection-album:addon:draft:addon-album"
  );
  assert.equal(
    linkedAddOn.lineKind,
    ORDER_COMMIT_SNAPSHOT_LINE_KIND.LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON
  );
  assert.equal(
    linkedAddOn.orderEntityKind,
    ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION
  );
  assert.equal(linkedAddOn.orderEntityId, "draft:selection-album");
  assert.equal(linkedAddOn.parentOrderPackageId, "order-package-1");
  assert.equal(linkedAddOn.catalogEntityId, "product-album");
  assert.equal(
    linkedAddOn.stableKey,
    "session-configuration-selection:draft:selection-album:add-on:draft:addon-album"
  );
  assert.equal(linkedAddOn.label, "Premium Album");
  assert.equal(linkedAddOn.quantity, 1);
  assert.equal(linkedAddOn.unitPrice, 45);
  assert.equal(linkedAddOn.lineTotal, 45);
  assert.equal(linkedAddOn.priceSource, ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT);
  assert.equal(linkedAddOn.metadata.orderAddOnId, null);
  assert.equal(linkedAddOn.metadata.draftOrderAddOnId, "draft:addon-album");
  assert.equal(linkedAddOn.metadata.productId, "product-album");
});

test("updates a materialized linked-product pair with orderAddOnId ownership", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine(),
      sessionConfigurationLine({
        selectionId: "selection-album",
        configurationId: "configuration-album",
        linkedOrderAddOnId: "addon-album",
        snapshotLinkedProductId: "product-album",
      }),
      linkedProductAddOnLine({
        selectionId: "selection-album",
        orderAddOnId: "addon-album",
        productId: "product-album",
        label: "Original Album",
        unitPrice: 30,
      }),
    ],
  });

  const reduced = reduceOrderCommitDraftSessionConfiguration(snapshot, {
    change: sessionConfigurationChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION,
      action: "UPSERT",
      target: { stableKey: "session-configuration-selection:selection-album" },
      parentPackageTarget: { stableKey: "order-package:order-package-1" },
      configurationId: "configuration-album",
      optionId: "option-album-updated",
      linkedProduct: {
        productId: "product-album-updated",
        orderAddOnId: "addon-album",
      },
    }),
    resolvedSelection: resolvedSelection({
      configurationId: "configuration-album",
      optionId: "option-album-updated",
      snapshotConfigurationCode: "ALBUM",
      snapshotLabel: "Album",
      snapshotLinkedProductId: "product-album-updated",
      snapshotOptionLabel: "Updated Album",
      snapshotFinancialBehavior: "FINANCIAL",
      snapshotPricingMode: "LINKED_PRODUCT",
    }),
    resolvedLinkedProduct: {
      productId: "product-album-updated",
      label: "Updated Album Add-On",
      unitPrice: 42,
    },
  });

  const selection = requireLine(reduced, "session-config:selection-album");
  assert.equal(selection.metadata.orderAddOnId, "addon-album");
  assert.equal(selection.metadata.draftOrderAddOnId, undefined);
  assert.equal(selection.metadata.snapshotLinkedProductId, "product-album-updated");

  const linkedAddOn = requireLine(
    reduced,
    "session-config:selection-album:addon:addon-album"
  );
  assert.equal(linkedAddOn.catalogEntityId, "product-album-updated");
  assert.equal(linkedAddOn.label, "Updated Album Add-On");
  assert.equal(linkedAddOn.unitPrice, 42);
  assert.equal(linkedAddOn.metadata.orderAddOnId, "addon-album");
  assert.equal(linkedAddOn.metadata.draftOrderAddOnId, undefined);
  assert.equal(
    reduced.lines.filter(
      (line) =>
        line.lineKind ===
        ORDER_COMMIT_SNAPSHOT_LINE_KIND.LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON
    ).length,
    1
  );
});

test("rejects changing the identity of an existing materialized linked-product pair", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine(),
      sessionConfigurationLine({
        selectionId: "selection-album",
        configurationId: "configuration-album",
        linkedOrderAddOnId: "addon-album",
        snapshotLinkedProductId: "product-album",
      }),
      linkedProductAddOnLine({
        selectionId: "selection-album",
        orderAddOnId: "addon-album",
        productId: "product-album",
      }),
    ],
  });

  assert.throws(
    () =>
      reduceOrderCommitDraftSessionConfiguration(snapshot, {
        change: sessionConfigurationChange({
          domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION,
          action: "UPSERT",
          target: { stableKey: "session-configuration-selection:selection-album" },
          parentPackageTarget: { stableKey: "order-package:order-package-1" },
          configurationId: "configuration-album",
          optionId: "option-album-updated",
          linkedProduct: {
            productId: "product-album-updated",
            orderAddOnId: "addon-other",
          },
        }),
        resolvedSelection: resolvedSelection({
          configurationId: "configuration-album",
          optionId: "option-album-updated",
          snapshotConfigurationCode: "ALBUM",
          snapshotLabel: "Album",
          snapshotLinkedProductId: "product-album-updated",
          snapshotOptionLabel: "Updated Album",
          snapshotFinancialBehavior: "FINANCIAL",
          snapshotPricingMode: "LINKED_PRODUCT",
        }),
        resolvedLinkedProduct: {
          productId: "product-album-updated",
          label: "Updated Album Add-On",
          unitPrice: 42,
        },
      }),
    /owns addon-album, not addon-other/
  );
});

test("removes a session configuration and its linked-product add-on together", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine(),
      sessionConfigurationLine({
        selectionId: "selection-album",
        configurationId: "configuration-album",
        linkedOrderAddOnId: "addon-album",
        snapshotLinkedProductId: "product-album",
      }),
      linkedProductAddOnLine({
        selectionId: "selection-album",
        orderAddOnId: "addon-album",
        productId: "product-album",
      }),
    ],
  });

  const reduced = reduceOrderCommitDraftSessionConfiguration(snapshot, {
    change: sessionConfigurationChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION,
      action: "REMOVE",
      target: { stableKey: "session-configuration-selection:selection-album" },
      parentPackageTarget: { stableKey: "order-package:order-package-1" },
      configurationId: "configuration-album",
    }),
  });

  assert.equal(
    reduced.lines.some((line) => line.orderEntityId === "selection-album"),
    false
  );
  assert.deepEqual(reduced.totals, {
    subtotal: 100,
    discountTotal: 0,
    netTotal: 100,
  });
});

test("removes a captured linked-product selection through a Sales snapshot target", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine(),
      sessionConfigurationLine({
        selectionId: "selection-album",
        configurationId: "configuration-album",
        linkedOrderAddOnId: "addon-album",
        snapshotLinkedProductId: "product-album",
      }),
      linkedProductAddOnLine({
        selectionId: "selection-album",
        orderAddOnId: "addon-album",
        productId: "product-album",
        unitPrice: 45,
      }),
    ],
  });
  const target = findSalesSessionConfigurationSnapshotTarget(
    {
      orderPackageId: "order-package-1",
      configurationId: "configuration-album",
    },
    snapshot
  );

  const reduced = reduceOrderCommitDraftSessionConfiguration(snapshot, {
    change: sessionConfigurationChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION,
      action: "REMOVE",
      target,
      parentPackageTarget: { stableKey: "order-package:order-package-1" },
      configurationId: "configuration-album",
    }),
  });

  assert.equal(
    reduced.lines.some((line) => line.orderEntityId === "selection-album"),
    false
  );
  assert.equal(
    reduced.lines.some(
      (line) =>
        line.lineKind ===
        ORDER_COMMIT_SNAPSHOT_LINE_KIND.LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON
    ),
    false
  );
  assert.deepEqual(reduced.totals, {
    subtotal: 100,
    discountTotal: 0,
    netTotal: 100,
  });
});

test("updates a captured linked-product selection through a Sales snapshot target", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine(),
      sessionConfigurationLine({
        selectionId: "selection-album",
        configurationId: "configuration-album",
        linkedOrderAddOnId: "addon-album",
        snapshotLinkedProductId: "product-album",
      }),
      linkedProductAddOnLine({
        selectionId: "selection-album",
        orderAddOnId: "addon-album",
        productId: "product-album",
        label: "Original Album",
        unitPrice: 30,
      }),
    ],
  });
  const target = findSalesSessionConfigurationSnapshotTarget(
    {
      orderPackageId: "order-package-1",
      configurationId: "configuration-album",
    },
    snapshot
  );

  const reduced = reduceOrderCommitDraftSessionConfiguration(snapshot, {
    change: sessionConfigurationChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION,
      action: "UPSERT",
      target,
      parentPackageTarget: { stableKey: "order-package:order-package-1" },
      configurationId: "configuration-album",
      optionId: "option-album-updated",
      linkedProduct: {
        productId: "product-album",
        orderAddOnId: "addon-album",
      },
    }),
    resolvedSelection: resolvedSelection({
      configurationId: "configuration-album",
      optionId: "option-album-updated",
      snapshotConfigurationCode: "ALBUM",
      snapshotLabel: "Album",
      snapshotLinkedProductId: "product-album",
      snapshotOptionLabel: "Updated Album",
      snapshotFinancialBehavior: "FINANCIAL",
      snapshotPricingMode: "LINKED_PRODUCT",
    }),
    resolvedLinkedProduct: {
      productId: "product-album",
      label: "Updated Album Add-On",
      unitPrice: 42,
    },
  });

  const selection = requireLine(reduced, "session-config:selection-album");
  assert.equal(selection.metadata.optionId, "option-album-updated");
  assert.equal(selection.metadata.orderAddOnId, "addon-album");
  assert.equal(selection.metadata.snapshotOptionLabel, "Updated Album");

  const linkedAddOn = requireLine(
    reduced,
    "session-config:selection-album:addon:addon-album"
  );
  assert.equal(linkedAddOn.label, "Updated Album Add-On");
  assert.equal(linkedAddOn.unitPrice, 42);
  assert.equal(linkedAddOn.lineTotal, 42);
  assert.equal(linkedAddOn.metadata.orderAddOnId, "addon-album");
  assert.equal(
    reduced.lines.filter(
      (line) =>
        line.lineKind ===
        ORDER_COMMIT_SNAPSHOT_LINE_KIND.LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON
    ).length,
    1
  );
});

test("requires exactly one linked add-on identity path", () => {
  const snapshot = snapshotFixture({ lines: [packageLine()] });

  assert.throws(
    () =>
      reduceOrderCommitDraftSessionConfiguration(snapshot, {
        change: sessionConfigurationChange({
          domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION,
          action: "UPSERT",
          parentPackageTarget: { stableKey: "order-package:order-package-1" },
          configurationId: "configuration-album",
          optionId: "option-album",
          draftSelectionId: "draft:selection-album",
          linkedProduct: {
            productId: "product-album",
          },
        }),
        resolvedSelection: linkedSelection(),
        resolvedLinkedProduct: {
          productId: "product-album",
          label: "Premium Album",
          unitPrice: 45,
        },
      }),
    /exactly one of orderAddOnId or draftOrderAddOnId/
  );

  assert.throws(
    () =>
      reduceOrderCommitDraftSessionConfiguration(snapshot, {
        change: sessionConfigurationChange({
          domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION,
          action: "UPSERT",
          parentPackageTarget: { stableKey: "order-package:order-package-1" },
          configurationId: "configuration-album",
          optionId: "option-album",
          draftSelectionId: "draft:selection-album",
          linkedProduct: {
            productId: "product-album",
            orderAddOnId: "addon-album",
            draftOrderAddOnId: "draft:addon-album",
          },
        }),
        resolvedSelection: linkedSelection(),
        resolvedLinkedProduct: {
          productId: "product-album",
          label: "Premium Album",
          unitPrice: 45,
        },
      }),
    /exactly one of orderAddOnId or draftOrderAddOnId/
  );
});

test("rejects draft ids passed through the materialized linked-product identity path", () => {
  const snapshot = snapshotFixture({ lines: [packageLine()] });

  assert.throws(
    () =>
      reduceOrderCommitDraftSessionConfiguration(snapshot, {
        change: sessionConfigurationChange({
          domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION,
          action: "UPSERT",
          parentPackageTarget: { stableKey: "order-package:order-package-1" },
          configurationId: "configuration-album",
          optionId: "option-album",
          draftSelectionId: "draft:selection-album",
          linkedProduct: {
            productId: "product-album",
            orderAddOnId: "draft:addon-album",
          },
        }),
        resolvedSelection: linkedSelection(),
        resolvedLinkedProduct: {
          productId: "product-album",
          label: "Premium Album",
          unitPrice: 45,
        },
      }),
    /materialized OrderAddOn id/
  );
});

test("rejects materialized identity when updating an existing draft linked-product pair", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine(),
      sessionConfigurationLine({
        selectionId: "draft:selection-album",
        configurationId: "configuration-album",
        draftOrderAddOnId: "draft:addon-album",
        snapshotLinkedProductId: "product-album",
      }),
      linkedProductAddOnLine({
        selectionId: "draft:selection-album",
        draftOrderAddOnId: "draft:addon-album",
        productId: "product-album",
      }),
    ],
  });

  assert.throws(
    () =>
      reduceOrderCommitDraftSessionConfiguration(snapshot, {
        change: sessionConfigurationChange({
          domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION,
          action: "UPSERT",
          target: { stableKey: "session-configuration-selection:draft:selection-album" },
          parentPackageTarget: { stableKey: "order-package:order-package-1" },
          configurationId: "configuration-album",
          optionId: "option-album",
          linkedProduct: {
            productId: "product-album",
            orderAddOnId: "addon-album",
          },
        }),
        resolvedSelection: linkedSelection(),
        resolvedLinkedProduct: {
          productId: "product-album",
          label: "Premium Album",
          unitPrice: 45,
        },
      }),
    /owns draft:addon-album, not addon-album/
  );
});

test("rejects orphaned linked-product add-on ownership states", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine(),
      linkedProductAddOnLine({
        selectionId: "missing-selection",
        orderAddOnId: "addon-orphaned",
        productId: "product-orphaned",
      }),
    ],
  });

  assert.throws(
    () =>
      reduceOrderCommitDraftSessionConfiguration(snapshot, {
        change: sessionConfigurationChange({
          domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION,
          action: "UPSERT",
          parentPackageTarget: { stableKey: "order-package:order-package-1" },
          configurationId: "configuration-finish",
          optionId: "option-matte",
          draftSelectionId: "draft:selection-finish",
        }),
        resolvedSelection: resolvedSelection({
          configurationId: "configuration-finish",
          optionId: "option-matte",
          snapshotConfigurationCode: "FINISH",
          snapshotLabel: "Finish",
          snapshotOptionLabel: "Matte",
          snapshotFinancialBehavior: "OPERATIONAL",
          snapshotPricingMode: "NONE",
        }),
      }),
    /orphaned linked-product add-on/
  );
});

test("rejects contradictory session configuration target identity fields", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine(),
      sessionConfigurationLine({
        selectionId: "selection-album",
        configurationId: "configuration-album",
      }),
      sessionConfigurationLine({
        selectionId: "selection-other",
        configurationId: "configuration-other",
      }),
    ],
  });

  assert.throws(
    () =>
      reduceOrderCommitDraftSessionConfiguration(snapshot, {
        change: sessionConfigurationChange({
          domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION,
          action: "UPSERT",
          target: {
            stableKey: "session-configuration-selection:selection-album",
            lineId: "session-config:selection-other",
          },
          parentPackageTarget: { stableKey: "order-package:order-package-1" },
          configurationId: "configuration-album",
          optionId: "option-album",
        }),
        resolvedSelection: resolvedSelection({
          configurationId: "configuration-album",
          optionId: "option-album",
          snapshotConfigurationCode: "ALBUM",
          snapshotLabel: "Album",
          snapshotOptionLabel: "Album",
          snapshotFinancialBehavior: "OPERATIONAL",
          snapshotPricingMode: "NONE",
        }),
      }),
    /matched multiple lines from contradictory target identity fields/
  );
});

test("session configuration reducer source stays pure and lookup-free", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "src/modules/order-commits/order-commit-session-configuration-reducer.ts"
    ),
    "utf8"
  );

  assert.doesNotMatch(source, /invoiceLineItem/i);
  assert.doesNotMatch(source, /from\s+["']@\/lib\/db["']|import\(["']@\/lib\/db["']\)/);
  assert.doesNotMatch(source, /order-commit\.service/);
  assert.doesNotMatch(source, /\.service["']/);
  assert.doesNotMatch(source, /\bfindMany\b|\bfindUnique\b|\bcreateMany\b|\bupdateMany\b|\bdeleteMany\b/);
});

function sessionConfigurationChange(
  input: unknown
): SessionConfigurationStagingChange {
  const parsed = orderCommitDraftStagingChangeSchema.parse(input);
  assert.equal(
    parsed.domain,
    ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION
  );
  return parsed as SessionConfigurationStagingChange;
}

function snapshotFixture(input: {
  lines: OrderCommitSnapshotLineV1[];
}): OrderCommitSnapshotV1 {
  return {
    schemaVersion: ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
    orderId: "order-1",
    financialCaseId: "financial-case-1",
    capturedAt: "2026-06-01T00:00:00.000Z",
    currency: ORDER_COMMIT_SNAPSHOT_CURRENCY,
    lines: input.lines,
    totals: {
      subtotal: 0,
      discountTotal: 0,
      netTotal: 0,
    },
  };
}

function packageLine(
  overrides: Partial<OrderCommitSnapshotLineV1> = {}
): OrderCommitSnapshotLineV1 {
  const orderEntityId = overrides.orderEntityId ?? "order-package-1";
  return {
    lineId: `package:${orderEntityId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE,
    orderEntityId,
    parentOrderPackageId: null,
    catalogEntityId: `package-catalog-${orderEntityId}`,
    stableKey: `order-package:${orderEntityId}`,
    label: `Package ${orderEntityId}`,
    quantity: 1,
    unitPrice: 100,
    lineTotal: 100,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {},
    ...overrides,
  };
}

function resolvedSelection(
  overrides: Partial<ResolvedOrderCommitDraftSessionConfigurationSelection> = {}
): ResolvedOrderCommitDraftSessionConfigurationSelection {
  return {
    configurationId: "configuration-1",
    optionId: null,
    numericValue: null,
    textValue: null,
    snapshotOptionLabel: null,
    snapshotConfigurationCode: "CONFIG",
    snapshotLabel: "Configuration",
    snapshotPriceDelta: 0,
    snapshotFinancialBehavior: "FINANCIAL",
    snapshotInputType: "SELECT",
    snapshotPricingMode: "NONE",
    snapshotLinkedProductId: null,
    ...overrides,
  };
}

function linkedSelection(): ResolvedOrderCommitDraftSessionConfigurationSelection {
  return resolvedSelection({
    configurationId: "configuration-album",
    optionId: "option-album",
    snapshotConfigurationCode: "ALBUM",
    snapshotLabel: "Album",
    snapshotLinkedProductId: "product-album",
    snapshotOptionLabel: "Album",
    snapshotFinancialBehavior: "FINANCIAL",
    snapshotPricingMode: "LINKED_PRODUCT",
  });
}

function sessionConfigurationLine(input: {
  selectionId: string;
  configurationId: string;
  linkedOrderAddOnId?: string;
  draftOrderAddOnId?: string;
  snapshotLinkedProductId?: string | null;
}): OrderCommitSnapshotLineV1 {
  return {
    lineId: `session-config:${input.selectionId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND
        .ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
    orderEntityId: input.selectionId,
    parentOrderPackageId: "order-package-1",
    catalogEntityId: input.configurationId,
    stableKey: `session-configuration-selection:${input.selectionId}`,
    label: "Album",
    quantity: 1,
    unitPrice: 0,
    lineTotal: 0,
    priceSource:
      ORDER_COMMIT_PRICE_SOURCE.SESSION_CONFIGURATION_SELECTION_SNAPSHOT,
    metadata: {
      configurationId: input.configurationId,
      optionId: "option-album",
      numericValue: null,
      textValue: null,
      snapshotOptionLabel: "Album",
      snapshotConfigurationCode: "ALBUM",
      snapshotLabel: "Album",
      snapshotPriceDelta: 0,
      snapshotFinancialBehavior: "FINANCIAL",
      snapshotInputType: "SELECT",
      snapshotPricingMode: "LINKED_PRODUCT",
      snapshotLinkedProductId: input.snapshotLinkedProductId ?? null,
      orderAddOnId: input.linkedOrderAddOnId ?? null,
      ...(input.draftOrderAddOnId
        ? { draftOrderAddOnId: input.draftOrderAddOnId }
        : {}),
    },
  };
}

function linkedProductAddOnLine(input: {
  selectionId: string;
  orderAddOnId?: string;
  draftOrderAddOnId?: string;
  productId: string;
  label?: string;
  unitPrice?: number;
}): OrderCommitSnapshotLineV1 {
  const addOnRef = input.orderAddOnId ?? input.draftOrderAddOnId;
  assert.ok(addOnRef, "linked product fixture requires an add-on id");
  const unitPrice = input.unitPrice ?? 30;
  return {
    lineId: `session-config:${input.selectionId}:addon:${addOnRef}`,
    lineKind:
      ORDER_COMMIT_SNAPSHOT_LINE_KIND
        .LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND
        .ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
    orderEntityId: input.selectionId,
    parentOrderPackageId: "order-package-1",
    catalogEntityId: input.productId,
    stableKey: `session-configuration-selection:${input.selectionId}:add-on:${addOnRef}`,
    label: input.label ?? "Linked Product",
    quantity: 1,
    unitPrice,
    lineTotal: unitPrice,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      configurationId: "configuration-album",
      optionId: "option-album",
      numericValue: null,
      textValue: null,
      snapshotOptionLabel: "Album",
      snapshotConfigurationCode: "ALBUM",
      snapshotLabel: "Album",
      snapshotPriceDelta: 0,
      snapshotFinancialBehavior: "FINANCIAL",
      snapshotInputType: "SELECT",
      snapshotPricingMode: "LINKED_PRODUCT",
      snapshotLinkedProductId: input.productId,
      orderAddOnId: input.orderAddOnId ?? null,
      ...(input.draftOrderAddOnId
        ? { draftOrderAddOnId: input.draftOrderAddOnId }
        : {}),
      productId: input.productId,
    },
  };
}

function requireLine(
  snapshot: OrderCommitSnapshotV1,
  lineId: string
): OrderCommitSnapshotLineV1 {
  const line = snapshot.lines.find((candidate) => candidate.lineId === lineId);
  assert.ok(line, `Expected line ${lineId}`);
  return line;
}
