import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createOrderCommitSalesAddOnHandlers,
  createOrderCommitSalesCompositionHandlers,
  type StageSalesChangeAction,
} from "@/modules/order-commits/sales-staging-handler-adapter";
import type { OrderCommitDraftStagingChange } from "@/modules/order-commits";
import type { POSMutationActionState } from "@/modules/orders/pos-handlers.types";

type StageCall = {
  orderId: string;
  expectedVersion: number;
  change: OrderCommitDraftStagingChange;
};

test("package change handler stages the exact package payload and expected version", async () => {
  const calls: StageCall[] = [];
  const handlers = createOrderCommitSalesCompositionHandlers({
    orderId: "order-1",
    expectedVersion: 0,
    stageSalesChangeAction: recordStage(calls),
  });

  const result = await handlers.changePackageTier({
    orderPackageId: "order-package-1",
    toPackageRefId: "package-premium",
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [
    {
      orderId: "order-1",
      expectedVersion: 0,
      change: {
        domain: "PACKAGE",
        action: "CHANGE_PACKAGE",
        target: {
          stableKey: "order-package:order-package-1",
          orderEntityId: "order-package-1",
        },
        packageId: "package-premium",
      },
    },
  ]);
});

test("package change handler preserves nonzero draft versions", async () => {
  const calls: StageCall[] = [];
  const handlers = createOrderCommitSalesCompositionHandlers({
    orderId: "order-2",
    expectedVersion: 7,
    stageSalesChangeAction: recordStage(calls),
  });

  await handlers.changePackageTier({
    orderPackageId: "order-package-2",
    toPackageRefId: "package-deluxe",
  });

  assert.equal(calls[0]?.expectedVersion, 7);
});

test("photo count handler stages the exact photo payload", async () => {
  const calls: StageCall[] = [];
  const handlers = createOrderCommitSalesCompositionHandlers({
    orderId: "order-photo",
    expectedVersion: 3,
    stageSalesChangeAction: recordStage(calls),
  });

  const result = await handlers.changeSelectedPhotoCount({
    orderPackageId: "order-package-photo",
    selectedPhotoCount: 18,
    extraDigitalCount: 2,
    extraPrintCount: 1,
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [
    {
      orderId: "order-photo",
      expectedVersion: 3,
      change: {
        domain: "PHOTO",
        action: "SET_COUNTS",
        target: {
          stableKey: "order-package:order-package-photo",
          orderEntityId: "order-package-photo",
        },
        selectedPhotoCount: 18,
        extraDigitalCount: 2,
        extraPrintCount: 1,
      },
    },
  ]);
});

test("action errors are normalized into HandlerResult errors", async () => {
  const handlers = createOrderCommitSalesCompositionHandlers({
    orderId: "order-error",
    expectedVersion: 4,
    stageSalesChangeAction: async () => ({
      kind: "error",
      errors: {
        _global: ["draft.stale"],
        packageId: ["Package is unavailable"],
        ignored: [],
      },
    }),
  });

  const result = await handlers.changePackageTier({
    orderPackageId: "order-package-error",
    toPackageRefId: "package-missing",
  });

  assert.deepEqual(result, {
    ok: false,
    errors: {
      _global: ["draft.stale"],
      packageId: ["Package is unavailable"],
    },
    approval: undefined,
  });
});

test("unsupported package-item handler is blocked and does not stage", async () => {
  const calls: StageCall[] = [];
  const handlers = createOrderCommitSalesCompositionHandlers({
    orderId: "order-item",
    expectedVersion: 2,
    stageSalesChangeAction: recordStage(calls),
  });

  const result = await handlers.upgradePackageItem({
    orderPackageId: "order-package-item",
    packageItemId: "package-item-current",
    toProductId: "product-replacement",
    quantity: 1,
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.errors._global[0], /Package item staging/);
  assert.equal(calls.length, 0);
});

test("unsupported add-on handlers are blocked and do not stage", async () => {
  const handlers = createOrderCommitSalesAddOnHandlers();

  const addResult = await handlers.addAddOn({
    productId: "product-addon",
    quantity: 1,
  });
  const removeResult = await handlers.removeAddOn({
    addOnId: "order-addon-1",
  });

  assert.equal(addResult.ok, false);
  assert.match(addResult.ok ? "" : addResult.errors._global[0], /parent package scope/);
  assert.equal(removeResult.ok, false);
  assert.match(
    removeResult.ok ? "" : removeResult.errors._global[0],
    /parent package scope/
  );
});

test("adapter source does not import db, commit execution, or public AW naming", () => {
  const source = readFileSync(
    "src/modules/order-commits/sales-staging-handler-adapter.ts",
    "utf8"
  );

  assert.doesNotMatch(source, /@\/lib\/db/);
  assert.doesNotMatch(source, /commitOrderChanges/);
  assert.doesNotMatch(source, /Adjustment Workspace/);
});

function recordStage(
  calls: StageCall[],
  state: POSMutationActionState = { kind: "success" }
): StageSalesChangeAction {
  return async (orderId, expectedVersion, change) => {
    calls.push({ orderId, expectedVersion, change });
    return state;
  };
}
