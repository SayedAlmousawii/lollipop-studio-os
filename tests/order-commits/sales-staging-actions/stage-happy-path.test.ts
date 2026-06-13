import assert from "node:assert/strict";
import test from "node:test";
import { ORDER_COMMIT_SNAPSHOT_LINE_KIND } from "@/modules/order-commits/order-commit.constants";
import { ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND } from "@/modules/order-commits/order-commit-preview.constants";
import {
  createOrderCommitSalesCompositionHandlers,
} from "@/modules/order-commits/sales-staging-handler-adapter";
import {
  addOnStageChange,
  createReplacementProduct,
  firstPackageItemId,
  firstPackageItemProductCategory,
  firstOrderPackageId,
  withSpec126Harness,
} from "../../spec-126/test-helpers";

test("stageSalesChangeAction creates drafts and package-item adapter commits", async () => {
  await withSpec126Harness(async (ctx) => {
    const workflow = await ctx.buildCheckedInWorkflow("stage-happy");
    const orderPackageId = await firstOrderPackageId(ctx.db, workflow.orderId);

    const first = await ctx.salesActions.stageSalesChangeAction(
      workflow.orderId,
      0,
      addOnStageChange({
        orderPackageId,
        productId: ctx.fixtures.addOnProductId,
      })
    );
    assert.deepEqual(first, { kind: "success" });

    const firstDraft = await ctx.db.orderCommitDraft.findUniqueOrThrow({
      where: { orderId: workflow.orderId },
      select: { version: true },
    });
    assert.equal(firstDraft.version, 1);

    const second = await ctx.salesActions.stageSalesChangeAction(
      workflow.orderId,
      1,
      addOnStageChange({
        orderPackageId,
        productId: ctx.fixtures.addOnProductId,
      })
    );
    assert.deepEqual(second, { kind: "success" });

    const secondDraft = await ctx.db.orderCommitDraft.findUniqueOrThrow({
      where: { orderId: workflow.orderId },
      select: { version: true },
    });
    assert.equal(secondDraft.version, 2);
    assert.equal(
      ctx.revalidatedPaths.filter(
        (path) => path === `/orders/${workflow.orderId}/sales`
      ).length,
      2
    );

    const itemWorkflow = await ctx.buildCheckedInWorkflow("stage-item-upgrade");
    const itemOrderPackageId = await firstOrderPackageId(
      ctx.db,
      itemWorkflow.orderId
    );
    const packageItemId = await firstPackageItemId(
      ctx.db,
      ctx.fixtures.basePackageId
    );
    const toProductId = await createReplacementProduct({
      db: ctx.db,
      suffix: "stage-item-upgrade",
      category: await firstPackageItemProductCategory(
        ctx.db,
        ctx.fixtures.basePackageId
      ),
    });
    const handlers = createOrderCommitSalesCompositionHandlers({
      orderId: itemWorkflow.orderId,
      expectedVersion: 0,
      stageSalesChangeAction: ctx.salesActions.stageSalesChangeAction,
    });

    const staged = await handlers.upgradePackageItem({
      orderPackageId: itemOrderPackageId,
      packageItemId,
      toProductId,
      quantity: 2,
    });
    assert.deepEqual(staged, { ok: true });

    const { getOrderCommitPreview } = await import(
      "@/modules/order-commits/order-commit-preview.service"
    );
    const preview = await getOrderCommitPreview({ orderId: itemWorkflow.orderId });
    const upgradeDiff = preview.lineDiffs.find(
      (diff) =>
        diff.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE &&
        diff.pendingLine?.catalogEntityId === packageItemId
    );
    assert.equal(
      upgradeDiff?.changeKind,
      ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.ADDED
    );
    assert.equal(
      upgradeDiff?.pendingLine?.parentOrderPackageId,
      itemOrderPackageId
    );
    assert.equal(upgradeDiff?.pendingLine?.quantity, 2);

    const draft = await ctx.orderCommitServices.getOrderCommitDraft({
      orderId: itemWorkflow.orderId,
    });
    assert.ok(draft, "OrderCommit draft should exist after staging");
    const committed = await ctx.salesActions.commitSalesChangesAction(
      itemWorkflow.orderId,
      draft.draft.version
    );
    assert.deepEqual(committed, { kind: "success" });

    const materialized = await ctx.db.orderPackageItemUpgrade.findMany({
      where: {
        orderId: itemWorkflow.orderId,
        orderPackageId: itemOrderPackageId,
        packageItemId,
      },
      select: {
        nameSnapshot: true,
        priceSnapshot: true,
        quantity: true,
      },
    });
    assert.equal(materialized.length, 1);
    assert.equal(materialized[0]?.quantity, 2);
    assert.equal(materialized[0]?.priceSnapshot.toFixed(3), "35.000");
    assert.match(
      materialized[0]?.nameSnapshot ?? "",
      /Phase B Included Product to Spec 126 Replacement stage-item-upgrade/
    );
  });
});
