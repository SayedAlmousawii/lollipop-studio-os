import assert from "node:assert/strict";
import test from "node:test";

const RETIRED_MESSAGE = "Adjustment Workspace is retired — use POS";

test("staged workspace route actions refuse after AW route retirement", async () => {
  const { stagePackageTierChangeAction } = await import(
    "@/app/orders/[orderId]/adjustment-workspace/actions"
  );

  await assert.rejects(
    () =>
      stagePackageTierChangeAction("order-1", "workspace-1", {
        version: 4,
        orderPackageId: "order-package-1",
        toPackageRefId: "package-2",
      }),
    {
      name: "AdjustmentWorkspaceRetiredError",
      message: RETIRED_MESSAGE,
    }
  );
});
