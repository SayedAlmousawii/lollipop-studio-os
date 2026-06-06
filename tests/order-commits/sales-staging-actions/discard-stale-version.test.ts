import assert from "node:assert/strict";
import test from "node:test";
import { withSpec126Harness } from "../../spec-126/test-helpers";

test("discardSalesDraftAction rejects stale expectedVersion and keeps the draft", async () => {
  await withSpec126Harness(async (ctx) => {
    const workflow = await ctx.buildCheckedInWorkflow("discard-stale");
    await ctx.orderCommitServices.getOrCreateOrderCommitDraft({
      orderId: workflow.orderId,
      actorContext: ctx.fixtures.adminActor,
    });

    const result = await ctx.salesActions.discardSalesDraftAction(
      workflow.orderId,
      1
    );

    assert.deepEqual(result, {
      kind: "error",
      errors: {
        _global: [
          "Draft changed since you opened it. Refresh to see the latest.",
          "draft.stale",
        ],
      },
    });
    const draft = await ctx.db.orderCommitDraft.findUniqueOrThrow({
      where: { orderId: workflow.orderId },
      select: { version: true },
    });
    assert.equal(draft.version, 0);
    assert.deepEqual(ctx.revalidatedPaths, []);
  });
});
