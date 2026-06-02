import assert from "node:assert/strict";
import test from "node:test";
import {
  addOnStageChange,
  firstOrderPackageId,
  withSpec126Harness,
} from "../../spec-126/test-helpers";

test("stageSalesChangeAction creates a draft then stages subsequent changes", async () => {
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
  });
});
