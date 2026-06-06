import assert from "node:assert/strict";
import test from "node:test";
import { UserRole } from "@prisma/client";
import {
  addOnStageChange,
  firstOrderPackageId,
  withSpec126Harness,
} from "../../spec-126/test-helpers";

test("stageSalesChangeAction rejects a non-owner non-manager actor", async () => {
  await withSpec126Harness(async (ctx) => {
    const workflow = await ctx.buildCheckedInWorkflow("stage-non-owner");
    const orderPackageId = await firstOrderPackageId(ctx.db, workflow.orderId);
    await ctx.orderCommitServices.getOrCreateOrderCommitDraft({
      orderId: workflow.orderId,
      actorContext: ctx.fixtures.adminActor,
    });

    ctx.actionActor.current = {
      id: "spec-126-non-owner",
      role: UserRole.RECEPTIONIST,
    };
    const result = await ctx.salesActions.stageSalesChangeAction(
      workflow.orderId,
      0,
      addOnStageChange({
        orderPackageId,
        productId: ctx.fixtures.addOnProductId,
      })
    );

    assert.deepEqual(result, {
      kind: "error",
      errors: {
        _global: [
          "Another user owns this draft. Refresh or coordinate before editing.",
          "draft.permission",
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
