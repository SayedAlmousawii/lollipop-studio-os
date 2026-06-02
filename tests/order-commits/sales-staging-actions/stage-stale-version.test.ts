import assert from "node:assert/strict";
import test from "node:test";
import {
  addOnStageChange,
  firstOrderPackageId,
  withSpec126Harness,
} from "../../spec-126/test-helpers";

test("stageSalesChangeAction rejects stale expectedVersion and leaves draft unchanged", async () => {
  await withSpec126Harness(async (ctx) => {
    const workflow = await ctx.buildCheckedInWorkflow("stage-stale");
    const orderPackageId = await firstOrderPackageId(ctx.db, workflow.orderId);
    await ctx.orderCommitServices.getOrCreateOrderCommitDraft({
      orderId: workflow.orderId,
      actorContext: ctx.fixtures.adminActor,
    });
    const before = await ctx.db.orderCommitDraft.findUniqueOrThrow({
      where: { orderId: workflow.orderId },
      select: { version: true, pendingSnapshotJson: true },
    });

    const result = await ctx.salesActions.stageSalesChangeAction(
      workflow.orderId,
      1,
      addOnStageChange({
        orderPackageId,
        productId: ctx.fixtures.addOnProductId,
      })
    );

    assert.deepEqual(result, {
      kind: "error",
      errors: { _global: ["draft.stale"] },
    });
    const after = await ctx.db.orderCommitDraft.findUniqueOrThrow({
      where: { orderId: workflow.orderId },
      select: { version: true, pendingSnapshotJson: true },
    });
    assert.deepEqual(after, before);
    assert.deepEqual(ctx.revalidatedPaths, []);
  });
});
