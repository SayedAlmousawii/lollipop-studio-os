import assert from "node:assert/strict";
import test from "node:test";
import {
  addOnStageChange,
  firstOrderPackageId,
  withSpec126Harness,
} from "../../spec-126/test-helpers";

test("getSalesPageView does not create a draft; stageSalesChangeAction does", async () => {
  await withSpec126Harness(async (ctx) => {
    const workflow = await ctx.buildCheckedInWorkflow("stage-lazy");
    const orderPackageId = await firstOrderPackageId(ctx.db, workflow.orderId);

    const view = await ctx.salesPageLoader.getSalesPageView({
      orderId: workflow.orderId,
      actorContext: ctx.fixtures.adminActor,
    });
    assert.equal(view.draft, null);
    assert.equal(
      await ctx.db.orderCommitDraft.count({
        where: { orderId: workflow.orderId },
      }),
      0
    );

    const staged = await ctx.salesActions.stageSalesChangeAction(
      workflow.orderId,
      0,
      addOnStageChange({
        orderPackageId,
        productId: ctx.fixtures.addOnProductId,
      })
    );
    assert.deepEqual(staged, { kind: "success" });
    assert.equal(
      await ctx.db.orderCommitDraft.count({
        where: { orderId: workflow.orderId },
      }),
      1
    );
  });
});
