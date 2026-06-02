import assert from "node:assert/strict";
import test from "node:test";
import { OrderCommitDraftActiveError } from "@/modules/orders/order.errors";
import { withSpec126Harness } from "../../spec-126/test-helpers";

test("active draft guard runs before the locked-invoice guard", async () => {
  await withSpec126Harness(async (ctx) => {
    const workflow = await ctx.buildLockedFinalInvoiceWorkflow(
      "guard-before-lock"
    );
    await ctx.orderCommitServices.getOrCreateOrderCommitDraft({
      orderId: workflow.orderId,
      actorContext: ctx.fixtures.adminActor,
    });

    await assert.rejects(
      () =>
        ctx.orderServices.addOrderProductAddOn(
          workflow.orderId,
          { productId: ctx.fixtures.addOnProductId },
          ctx.fixtures.adminActor
        ),
      (error) => {
        assert.match(
          String(error),
          new RegExp(escapeRegExp(new OrderCommitDraftActiveError().message))
        );
        assert.doesNotMatch(String(error), /locked invoice|workspace required/i);
        return true;
      }
    );
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
