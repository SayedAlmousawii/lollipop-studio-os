import assert from "node:assert/strict";
import test from "node:test";
import {
  addOnStageChange,
  captureOrderRows,
  firstOrderPackageId,
  withSpec126Harness,
} from "../../spec-126/test-helpers";

test("discardSalesDraftAction removes the draft and leaves Order rows untouched", async () => {
  await withSpec126Harness(async (ctx) => {
    const workflow = await ctx.buildCheckedInWorkflow("discard-happy");
    const orderPackageId = await firstOrderPackageId(ctx.db, workflow.orderId);
    const beforeRows = await captureOrderRows(ctx.db, workflow.orderId);
    const staged = await ctx.salesActions.stageSalesChangeAction(
      workflow.orderId,
      0,
      addOnStageChange({
        orderPackageId,
        productId: ctx.fixtures.addOnProductId,
      })
    );
    assert.deepEqual(staged, { kind: "success" });

    const result = await ctx.salesActions.discardSalesDraftAction(
      workflow.orderId,
      1
    );
    assert.deepEqual(result, { kind: "success" });
    assert.equal(
      await ctx.db.orderCommitDraft.count({
        where: { orderId: workflow.orderId },
      }),
      0
    );
    assert.deepEqual(
      await captureOrderRows(ctx.db, workflow.orderId),
      beforeRows
    );

    const view = await ctx.salesPageLoader.getSalesPageView({
      orderId: workflow.orderId,
      actorContext: ctx.fixtures.adminActor,
    });
    assert.equal(view.draft, null);
    assert.equal(view.composition.source, "current");
  });
});
