import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  classifyOrderCommitPreview,
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PREVIEW_COMMIT_KIND,
  ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
  type OrderCommitPreviewLineDiff,
  type OrderCommitPreviewOperationalFlags,
  type OrderCommitSnapshotDiff,
} from "@/modules/order-commits";

test("classification maps positive operational deltas to adjustment invoice preview kind", () => {
  const classification = classifyOrderCommitPreview({
    diff: diffFixture({
      netDelta: 25,
      lineDiffs: [
        lineDiff({
          stableKey: "order-add-on:addon-1",
          lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON,
          changeKind: ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.ADDED,
          moneyDelta: 25,
          flags: {
            isAddOnChange: true,
            isFinanciallyRelevant: true,
            isOperationallyMeaningful: true,
          },
        }),
      ],
    }),
  });

  assert.equal(
    classification.commitKind,
    ORDER_COMMIT_PREVIEW_COMMIT_KIND.ADJUSTMENT_INVOICE
  );
  assert.equal(classification.netDelta, 25);
  assert.equal(classification.operationalFlags.isAddOnChange, true);
  assert.equal(classification.operationalFlags.isFinanciallyRelevant, true);
});

test("classification maps negative operational deltas to credit note placeholder", () => {
  const classification = classifyOrderCommitPreview({
    diff: diffFixture({
      netDelta: -80,
      lineDiffs: [
        lineDiff({
          stableKey: "order-package:package-1",
          lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
          changeKind: ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.PACKAGE_CHANGED,
          moneyDelta: -80,
          flags: {
            isPackageChange: true,
            isPackageDowngrade: true,
            isPackageSwap: true,
            isFinanciallyRelevant: true,
            isOperationallyMeaningful: true,
          },
        }),
      ],
    }),
  });

  assert.equal(
    classification.commitKind,
    ORDER_COMMIT_PREVIEW_COMMIT_KIND.CREDIT_NOTE
  );
  assert.equal(classification.operationalFlags.isPackageDowngrade, true);
  assert.equal(classification.operationalFlags.isPackageSwap, true);
});

test("classification detects meaningful zero-net operational changes", () => {
  const classification = classifyOrderCommitPreview({
    diff: diffFixture({
      netDelta: 0,
      zeroNetReason: "MEANINGFUL_ZERO_NET_OPERATIONAL_CHANGE",
      lineDiffs: [
        lineDiff({
          stableKey: "order-package:package-1",
          lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
          changeKind: ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.METADATA_CHANGED,
          moneyDelta: 0,
          flags: {
            isPackageChange: true,
            isPhotoChange: true,
            isOperationallyMeaningful: true,
          },
        }),
      ],
    }),
  });

  assert.equal(
    classification.commitKind,
    ORDER_COMMIT_PREVIEW_COMMIT_KIND.ZERO_NET_AUDIT
  );
  assert.equal(
    classification.zeroNetReason,
    "MEANINGFUL_ZERO_NET_OPERATIONAL_CHANGE"
  );
  assert.equal(classification.operationalFlags.isPhotoChange, true);
  assert.equal(classification.operationalFlags.isFinanciallyRelevant, false);
});

test("classification keeps unchanged diffs as no-op", () => {
  const classification = classifyOrderCommitPreview({
    diff: diffFixture({
      netDelta: 0,
      lineDiffs: [
        lineDiff({
          stableKey: "order-package:package-1",
          lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
          changeKind: ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.UNCHANGED,
          moneyDelta: 0,
        }),
      ],
    }),
  });

  assert.equal(
    classification.commitKind,
    ORDER_COMMIT_PREVIEW_COMMIT_KIND.NO_OP
  );
  assert.deepEqual(classification.operationalFlags, emptyFlags());
});

test("classification aggregates operational change domains without policy output", () => {
  const classification = classifyOrderCommitPreview({
    diff: diffFixture({
      netDelta: 0,
      zeroNetReason: "MEANINGFUL_ZERO_NET_OPERATIONAL_CHANGE",
      lineDiffs: [
        lineDiff({
          stableKey: "item-upgrade:item-1",
          lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE,
          changeKind: ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.ADDED,
          moneyDelta: 10,
          flags: {
            isPackageItemUpgradeChange: true,
            isFinanciallyRelevant: true,
            isOperationallyMeaningful: true,
          },
        }),
        lineDiff({
          stableKey: "extra-photo:print",
          lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.SELECTED_PHOTO_EXTRA,
          changeKind: ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.REMOVED,
          moneyDelta: -10,
          flags: {
            isPhotoChange: true,
            isFinanciallyRelevant: true,
            isOperationallyMeaningful: true,
          },
        }),
        lineDiff({
          stableKey: "session-config:selection-1",
          lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION,
          changeKind: ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.METADATA_CHANGED,
          moneyDelta: 0,
          flags: {
            isSessionConfigurationChange: true,
            isOperationallyMeaningful: true,
          },
        }),
        lineDiff({
          stableKey: "session-config:selection-1:addon-linked",
          lineKind:
            ORDER_COMMIT_SNAPSHOT_LINE_KIND
              .LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON,
          changeKind: ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.ADDED,
          moneyDelta: 0,
          flags: {
            isLinkedProductChange: true,
            isOperationallyMeaningful: true,
          },
        }),
      ],
    }),
  });

  assert.equal(
    classification.commitKind,
    ORDER_COMMIT_PREVIEW_COMMIT_KIND.ZERO_NET_AUDIT
  );
  assert.equal(
    classification.operationalFlags.isPackageItemUpgradeChange,
    true
  );
  assert.equal(classification.operationalFlags.isPhotoChange, true);
  assert.equal(
    classification.operationalFlags.isSessionConfigurationChange,
    true
  );
  assert.equal(classification.operationalFlags.isLinkedProductChange, true);
  assert.equal("requiresApproval" in classification, false);
  assert.equal("documentPlan" in classification, false);
  assert.equal("paymentImpact" in classification, false);
  assert.equal("refundImpact" in classification, false);
});

test("classification source consumes only diff contracts and stays pure", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "src/modules/order-commits/order-commit-preview-classification.service.ts"
    ),
    "utf8"
  );

  assert.equal(/@\/lib\/db/.test(source), false);
  assert.equal(/orderCommitSnapshotV1Schema/.test(source), false);
  assert.equal(/pendingOpsJson/.test(source), false);
  assert.equal(/invoiceLineItem/i.test(source), false);
  assert.equal(
    /from\s+["'][^"']*(adjustment-workspace|invoice\.service|payment\.service|refund|get-order-commit-preview)[^"']*["']/i.test(
      source
    ),
    false
  );
});

function diffFixture(input: {
  netDelta: number;
  lineDiffs: OrderCommitPreviewLineDiff[];
  zeroNetReason?: string | null;
}): OrderCommitSnapshotDiff {
  return {
    orderId: "order-1",
    financialCaseId: "financial-case-1",
    currency: "KWD",
    lineDiffs: input.lineDiffs,
    netDelta: input.netDelta,
    zeroNetReason: input.zeroNetReason ?? null,
  };
}

function lineDiff(input: {
  stableKey: string;
  lineKind: OrderCommitPreviewLineDiff["lineKind"];
  changeKind: OrderCommitPreviewLineDiff["changeKind"];
  moneyDelta: number;
  flags?: Partial<OrderCommitPreviewOperationalFlags>;
}): OrderCommitPreviewLineDiff {
  const summary = {
    stableKey: input.stableKey,
    lineId: `line:${input.stableKey}`,
    lineKind: input.lineKind,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE,
    orderEntityId: "entity-1",
    parentOrderPackageId: null,
    catalogEntityId: "catalog-1",
    label: "Preview Line",
    quantity: 1,
    unitPrice: Math.abs(input.moneyDelta),
    lineTotal: Math.abs(input.moneyDelta),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {},
  };

  return {
    stableKey: input.stableKey,
    lineId: summary.lineId,
    lineKind: input.lineKind,
    changeKind: input.changeKind,
    baselineLine:
      input.changeKind === ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.ADDED
        ? null
        : summary,
    pendingLine:
      input.changeKind === ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.REMOVED
        ? null
        : summary,
    quantityDelta: 0,
    moneyDelta: input.moneyDelta,
    operationalFlags: { ...emptyFlags(), ...input.flags },
  };
}

function emptyFlags(): OrderCommitPreviewOperationalFlags {
  return {
    isPackageChange: false,
    isPackageUpgrade: false,
    isPackageDowngrade: false,
    isPackageSwap: false,
    isAddOnChange: false,
    isPackageItemUpgradeChange: false,
    isPhotoChange: false,
    isSessionConfigurationChange: false,
    isLinkedProductChange: false,
    isFinanciallyRelevant: false,
    isOperationallyMeaningful: false,
  };
}
