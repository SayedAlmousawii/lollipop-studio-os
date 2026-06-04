import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ORDER_COMMIT_DRAFT_STAGING_DOMAIN } from "@/modules/order-commits/order-commit-draft.constants";
import {
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
} from "@/modules/order-commits/order-commit.constants";
import { orderCommitDraftStagingChangeSchema } from "@/modules/order-commits/order-commit-draft.schema";
import {
  buildSalesSessionConfigurationStagingChange,
  findSalesSessionConfigurationSnapshotTarget,
} from "@/modules/order-commits/sales-session-configuration-staging";
import type {
  OrderCommitSnapshotLineV1,
  OrderCommitSnapshotV1,
} from "@/modules/order-commits/order-commit.types";

const panelSource = readFileSync(
  "src/components/session-configurations/configure-session-panel.tsx",
  "utf8"
);
const salesPageSource = readFileSync("app/orders/[orderId]/sales/page.tsx", "utf8");
const salesActionSource = readFileSync(
  "app/orders/[orderId]/sales/actions.ts",
  "utf8"
);

test("operational selection stages only identity and selected value", () => {
  const change = buildSalesSessionConfigurationStagingChange({
    orderPackageId: "order-package-1",
    configurationId: "configuration-finish",
    desired: {
      configurationId: "configuration-finish",
      kind: "select",
      optionId: "option-matte",
    },
  });

  assert.deepEqual(change, {
    domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION,
    action: "UPSERT",
    parentPackageTarget: {
      stableKey: "order-package:order-package-1",
      orderEntityId: "order-package-1",
    },
    configurationId: "configuration-finish",
    optionId: "option-matte",
  });
});

test("financial selection stages value only without panel-owned impact fields", () => {
  const change = buildSalesSessionConfigurationStagingChange({
    orderPackageId: "order-package-1",
    configurationId: "configuration-premium-backdrop",
    desired: {
      configurationId: "configuration-premium-backdrop",
      kind: "counter",
      numericValue: 2,
      optionId: "option-gold",
    },
  });

  assert.equal(change.action, "UPSERT");
  assert.equal(change.numericValue, "2");
  assert.equal(change.optionId, "option-gold");
  assert.equal("snapshotPriceDelta" in change, false);
  assert.equal("priceDelta" in change, false);
  assert.equal("unitPrice" in change, false);
  assert.equal("lineTotal" in change, false);
});

test("clearing an existing selection stages remove with the snapshot-derived target", () => {
  const change = buildSalesSessionConfigurationStagingChange({
    orderPackageId: "order-package-1",
    configurationId: "configuration-finish",
    desired: null,
    existingSelection: {
      selectionId: "materialized-selection-finish",
    },
    existingSnapshotTarget: {
      stableKey: "session-configuration-selection:draft-selection-finish",
      lineId: "session-config:draft-selection-finish",
    },
  });

  assert.deepEqual(change, {
    domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION,
    action: "REMOVE",
    parentPackageTarget: {
      stableKey: "order-package:order-package-1",
      orderEntityId: "order-package-1",
    },
    configurationId: "configuration-finish",
    target: {
      stableKey: "session-configuration-selection:draft-selection-finish",
      lineId: "session-config:draft-selection-finish",
    },
  });
});

test("snapshot target lookup targets the session configuration line, not linked add-on companion", () => {
  const target = findSalesSessionConfigurationSnapshotTarget(
    {
      orderPackageId: "order-package-1",
      configurationId: "configuration-album",
    },
    snapshotFixture({
      lines: [
        packageLine(),
        sessionConfigurationLine({
          selectionId: "selection-album",
          configurationId: "configuration-album",
          linkedProductId: "product-album",
          orderAddOnId: "order-addon-album",
        }),
        linkedProductAddOnLine({
          selectionId: "selection-album",
          productId: "product-album",
          orderAddOnId: "order-addon-album",
        }),
      ],
    })
  );

  assert.deepEqual(target, {
    stableKey: "session-configuration-selection:selection-album",
    lineId: "session-config:selection-album",
  });
  assert.equal(target && "orderEntityId" in target, false);
});

test("updating an existing selection uses snapshot target, not the current selection id", () => {
  const change = buildSalesSessionConfigurationStagingChange({
    orderPackageId: "order-package-1",
    configurationId: "configuration-finish",
    desired: {
      configurationId: "configuration-finish",
      kind: "select",
      optionId: "option-glossy",
    },
    existingSelection: {
      selectionId: "materialized-selection-finish",
    },
    existingSnapshotTarget: {
      stableKey: "session-configuration-selection:draft-selection-finish",
      lineId: "session-config:draft-selection-finish",
    },
  });

  assert.deepEqual(change.target, {
    stableKey: "session-configuration-selection:draft-selection-finish",
    lineId: "session-config:draft-selection-finish",
  });
  assert.notEqual(
    change.target?.stableKey,
    "session-configuration-selection:materialized-selection-finish"
  );
});

test("new linked-product selection omits add-on ids for service assignment", () => {
  const change = buildSalesSessionConfigurationStagingChange({
    orderPackageId: "order-package-1",
    configurationId: "configuration-album",
    desired: {
      configurationId: "configuration-album",
      kind: "toggle",
    },
  });

  assert.equal(change.action, "UPSERT");
  assert.equal(change.linkedProduct, undefined);
});

test("materialized linked-product selection forwards materialized orderAddOnId", () => {
  const change = buildSalesSessionConfigurationStagingChange({
    orderPackageId: "order-package-1",
    configurationId: "configuration-album",
    desired: {
      configurationId: "configuration-album",
      kind: "toggle",
    },
    existingSelection: {
      selectionId: "selection-album",
      snapshotLinkedProductId: "product-album",
      orderAddOnId: "order-addon-album",
    },
    existingSnapshotTarget: {
      stableKey: "session-configuration-selection:selection-album",
      lineId: "session-config:selection-album",
    },
  });

  assert.deepEqual(change.linkedProduct, {
    productId: "product-album",
    orderAddOnId: "order-addon-album",
  });
  assert.equal(change.target?.lineId, "session-config:selection-album");
});

test("draft orderAddOnId remains rejected by the staging schema", () => {
  const parsed = orderCommitDraftStagingChangeSchema.safeParse({
    domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION,
    action: "UPSERT",
    parentPackageTarget: { stableKey: "order-package:order-package-1" },
    configurationId: "configuration-album",
    linkedProduct: {
      productId: "product-album",
      orderAddOnId: "draft:addon-album",
    },
  });

  assert.equal(parsed.success, false);
});

test("Sales page mounts ConfigureSessionPanel in commit-staging mode", () => {
  assert.match(salesPageSource, /configurePanelMode="commit-staging"/);
  assert.match(
    salesPageSource,
    /expectedVersion=\{salesPageView\.draft\?\.version \?\? 0\}/
  );
});

test("commit-staging panel path uses Sales staging action and threads versions", () => {
  const submitStart = panelSource.indexOf("function submitCommitStagingEdits()");
  const submitEnd = panelSource.indexOf("return (", submitStart);
  const submitSource = panelSource.slice(submitStart, submitEnd);

  assert.match(submitSource, /let currentVersion = commitDraftVersion/);
  assert.match(submitSource, /stageSessionConfigurationSelectionAction/);
  assert.match(submitSource, /currentVersion = result\.version/);
  assert.match(submitSource, /setCommitDraftVersion\(result\.version\)/);
  assert.match(
    submitSource,
    /order_commit\.session_configuration_edit_staged_from_sales/
  );
  assert.doesNotMatch(submitSource, /configureSessionAction/);
  assert.doesNotMatch(submitSource, /applySessionConfigurationWorkspaceEditAction/);
});

test("commit-staging financial configs do not show panel-owned fee hints or AW link", () => {
  assert.match(
    panelSource,
    /mode\.kind === "commit-staging" &&[\s\S]*configuration\.financialBehavior === "FINANCIAL"/
  );
  assert.match(
    panelSource,
    /mode\.kind === "adjustment" \|\| mode\.kind === "commit-staging"/
  );

  const commitModeBranch = panelSource.slice(
    panelSource.indexOf('configurePanelMode === "commit-staging"'),
    panelSource.indexOf(": editPolicies.sessionConfigurationFinancialEdit", panelSource.indexOf('configurePanelMode === "commit-staging"'))
  );
  assert.doesNotMatch(commitModeBranch, /Adjustment Workspace/);
});

test("dedicated Sales session action avoids legacy live and AW writes", () => {
  const actionStart = salesActionSource.indexOf(
    "export async function stageSessionConfigurationSelectionAction"
  );
  const actionEnd = salesActionSource.indexOf(
    "export async function discardSalesDraftAction",
    actionStart
  );
  const actionSource = salesActionSource.slice(actionStart, actionEnd);

  assert.match(actionSource, /buildSalesSessionConfigurationStagingChange/);
  assert.match(actionSource, /withSalesSessionConfigurationSnapshotTarget/);
  assert.match(actionSource, /stageOrderCommitDraftChange/);
  assert.doesNotMatch(actionSource, /writeOrderPackageSelections/);
  assert.doesNotMatch(actionSource, /applySessionConfigurationWorkspaceEditAction/);
});

function snapshotFixture(input: {
  lines: OrderCommitSnapshotLineV1[];
}): OrderCommitSnapshotV1 {
  return {
    schemaVersion: "order_commit_snapshot_v1",
    orderId: "order-1",
    financialCaseId: "financial-case-1",
    capturedAt: "2026-06-04T00:00:00.000Z",
    currency: "KWD",
    lines: input.lines,
    totals: {
      subtotal: 100,
      discountTotal: 0,
      netTotal: 100,
    },
  };
}

function packageLine(): OrderCommitSnapshotLineV1 {
  return {
    lineId: "package:order-package-1",
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE,
    orderEntityId: "order-package-1",
    parentOrderPackageId: null,
    catalogEntityId: "package-base",
    stableKey: "order-package:order-package-1",
    label: "Base package",
    quantity: 1,
    unitPrice: 100,
    lineTotal: 100,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: { sessionTypeId: "session-type-1" },
  };
}

function sessionConfigurationLine(input: {
  selectionId: string;
  configurationId: string;
  linkedProductId?: string | null;
  orderAddOnId?: string | null;
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
      orderAddOnId: input.orderAddOnId ?? null,
      snapshotLinkedProductId: input.linkedProductId ?? null,
    },
  };
}

function linkedProductAddOnLine(input: {
  selectionId: string;
  productId: string;
  orderAddOnId: string;
}): OrderCommitSnapshotLineV1 {
  return {
    lineId: `session-config:${input.selectionId}:addon:${input.orderAddOnId}`,
    lineKind:
      ORDER_COMMIT_SNAPSHOT_LINE_KIND
        .LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND
        .ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
    orderEntityId: input.selectionId,
    parentOrderPackageId: "order-package-1",
    catalogEntityId: input.productId,
    stableKey: `session-configuration-selection:${input.selectionId}:add-on:${input.orderAddOnId}`,
    label: "Album",
    quantity: 1,
    unitPrice: 25,
    lineTotal: 25,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      orderAddOnId: input.orderAddOnId,
      productId: input.productId,
    },
  };
}
