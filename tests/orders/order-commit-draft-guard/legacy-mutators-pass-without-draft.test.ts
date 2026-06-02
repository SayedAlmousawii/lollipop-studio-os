import assert from "node:assert/strict";
import test from "node:test";
import {
  createRemovableAddOn,
  createReplacementProduct,
  firstOrderPackageId,
  firstPackageItemId,
  firstPackageItemProductCategory,
  withSpec126Harness,
  type Spec126Harness,
} from "../../spec-126/test-helpers";

type LegacyMutatorCase = {
  name: string;
  act: (
    ctx: Spec126Harness,
    workflow: { orderId: string },
    suffix: string
  ) => Promise<unknown>;
};

const legacyMutators: LegacyMutatorCase[] = [
  {
    name: "updateOrderPackage",
    act: async (ctx, workflow) =>
      ctx.orderServices.updateOrderPackage(
        workflow.orderId,
        {
          orderPackageId: await firstOrderPackageId(ctx.db, workflow.orderId),
          packageId: ctx.fixtures.upgradePackageId,
        },
        ctx.fixtures.adminActor
      ),
  },
  {
    name: "upgradeOrderPackageItem",
    act: async (ctx, workflow, suffix) =>
      ctx.orderServices.upgradeOrderPackageItem(
        workflow.orderId,
        {
          orderPackageId: await firstOrderPackageId(ctx.db, workflow.orderId),
          packageItemId: await firstPackageItemId(
            ctx.db,
            ctx.fixtures.basePackageId
          ),
          newProductId: await createReplacementProduct({
            db: ctx.db,
            suffix,
            category: await firstPackageItemProductCategory(
              ctx.db,
              ctx.fixtures.basePackageId
            ),
          }),
        },
        ctx.fixtures.adminActor
      ),
  },
  {
    name: "addOrderProductAddOn",
    act: async (ctx, workflow) =>
      ctx.orderServices.addOrderProductAddOn(
        workflow.orderId,
        { productId: ctx.fixtures.addOnProductId },
        ctx.fixtures.adminActor
      ),
  },
  {
    name: "removeOrderAddOn",
    act: async (ctx, workflow) => {
      const orderPackageId = await firstOrderPackageId(ctx.db, workflow.orderId);
      return ctx.orderServices.removeOrderAddOn(
        workflow.orderId,
        {
          addOnId: await createRemovableAddOn({
            db: ctx.db,
            orderId: workflow.orderId,
            orderPackageId,
            productId: ctx.fixtures.addOnProductId,
          }),
        },
        ctx.fixtures.adminActor
      );
    },
  },
  {
    name: "updateOrderSelectedPhotoCount",
    act: async (ctx, workflow) =>
      ctx.orderServices.updateOrderSelectedPhotoCount(
        workflow.orderId,
        {
          orderPackageId: await firstOrderPackageId(ctx.db, workflow.orderId),
          selectedPhotoCount: 12,
          extraDigitalCount: 2,
          extraPrintCount: 0,
        },
        ctx.fixtures.adminActor
      ),
  },
];

test("legacy direct mutators still pass when no OrderCommitDraft exists", async (t) => {
  await withSpec126Harness(async (ctx) => {
    for (const mutator of legacyMutators) {
      await t.test(mutator.name, async () => {
        const workflow = await ctx.buildCheckedInWorkflow(`pass-${mutator.name}`);

        await assert.doesNotReject(() =>
          mutator.act(ctx, workflow, `pass-${mutator.name}`)
        );
      });
    }
  });
});
