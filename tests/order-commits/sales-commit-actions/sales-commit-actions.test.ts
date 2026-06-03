import assert from "node:assert/strict";
import test from "node:test";
import { UserRole } from "@prisma/client";
import {
  OrderCommitApprovalRequiredError,
  OrderCommitConcurrentCommitError,
  OrderCommitCreditCapacityExhaustedError,
  OrderCommitStaleDraftError,
} from "@/modules/order-commits";
import { OrderCommitDraftPermissionError } from "@/modules/order-commits/order-commit-draft.errors";
import {
  commitSalesChangesActionWithDependencies,
  type SalesCommitActionDependencies,
} from "@/modules/order-commits/sales-commit-actions";

test("commitSalesChangesActionWithDependencies forwards the exact draft version, approval actor, and actor context", async () => {
  const calls: Array<Parameters<SalesCommitActionDependencies["commitOrderChanges"]>[0]> =
    [];
  const revalidated: string[] = [];

  const result = await commitSalesChangesActionWithDependencies(
    "order-1",
    7,
    "manager-1",
    {
      requireOrderFinancialUpdate: async () => ({
        id: "staff-1",
        role: UserRole.MANAGER,
      }),
      commitOrderChanges: async (input) => {
        calls.push(input);
        return {
          orderCommit: { id: "commit-1", sequence: 2 },
          emittedDocuments: [],
        };
      },
      revalidateSalesPaths: (orderId) => revalidated.push(orderId),
    }
  );

  assert.deepEqual(result, { kind: "success" });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    orderId: "order-1",
    expectedDraftVersion: 7,
    approvalActorUserId: "manager-1",
    actorContext: {
      actorUserId: "staff-1",
      actorRole: UserRole.MANAGER,
    },
  });
  assert.deepEqual(revalidated, ["order-1"]);
});

test("commitSalesChangesActionWithDependencies revalidates only after successful commit", async () => {
  const revalidated: string[] = [];

  const result = await commitSalesChangesActionWithDependencies(
    "order-1",
    1,
    undefined,
    {
      requireOrderFinancialUpdate: async () => ({
        id: "staff-1",
        role: UserRole.ADMIN,
      }),
      commitOrderChanges: async () => {
        throw new OrderCommitStaleDraftError({
          orderId: "order-1",
          expectedDraftVersion: 1,
          actualDraftVersion: 2,
          draftId: "draft-1",
        });
      },
      revalidateSalesPaths: (orderId) => revalidated.push(orderId),
    }
  );

  assert.equal(result.kind, "error");
  assert.deepEqual(revalidated, []);
});

test("commitSalesChangesActionWithDependencies maps commit-time errors to stable states", async () => {
  const stale = await runError(
    new OrderCommitStaleDraftError({
      orderId: "order-1",
      expectedDraftVersion: 1,
      actualDraftVersion: 2,
      draftId: "draft-1",
    })
  );
  assert.equal(stale.kind, "error");
  assert.deepEqual(stale.errors?._global?.at(-1), "commit.stale");

  const concurrent = await runError(
    new OrderCommitConcurrentCommitError({
      orderId: "order-1",
      draftVersion: 1,
    })
  );
  assert.equal(concurrent.kind, "error");
  assert.deepEqual(concurrent.errors?._global?.at(-1), "commit.concurrent");

  const approval = await runError(
    new OrderCommitApprovalRequiredError({
      orderId: "order-1",
      approvalActorUserId: null,
    })
  );
  assert.equal(approval.kind, "approval-required");
  assert.deepEqual(approval.errors?._global, ["commit.approvalRequired"]);
  assert.deepEqual(approval.errors?.approvalActorUserId, [
    "Manager/admin user ID is required.",
  ]);

  const capacity = await runError(
    new OrderCommitCreditCapacityExhaustedError({
      orderId: "order-1",
      expectedFinalCreditTotal: 45,
      currentCapacity: 20,
    })
  );
  assert.equal(capacity.kind, "error");
  assert.deepEqual(capacity.errors?._global?.at(-1), "commit.creditCapacity");
  assert.match(capacity.errors?._global?.[0] ?? "", /Credit\/refund capacity changed/);

  const permission = await runError(
    new OrderCommitDraftPermissionError("other-user", "draft-1", "commit")
  );
  assert.equal(permission.kind, "error");
  assert.deepEqual(permission.errors?._global?.[0], "commit.permission");
  assert.match(permission.errors?._global?.[1] ?? "", /Another user owns this draft/);
});

test("commitSalesChangesActionWithDependencies rethrows permission and unknown failures", async () => {
  const permissionError = new Error("permission denied");
  await assert.rejects(
    () =>
      commitSalesChangesActionWithDependencies("order-1", 1, undefined, {
        requireOrderFinancialUpdate: async () => {
          throw permissionError;
        },
        commitOrderChanges: async () => {
          throw new Error("should not run");
        },
        revalidateSalesPaths: () => undefined,
      }),
    permissionError
  );

  const unknownError = new Error("unknown");
  await assert.rejects(
    () =>
      commitSalesChangesActionWithDependencies("order-1", 1, undefined, {
        requireOrderFinancialUpdate: async () => ({
          id: "staff-1",
          role: UserRole.ADMIN,
        }),
        commitOrderChanges: async () => {
          throw unknownError;
        },
        revalidateSalesPaths: () => undefined,
      }),
    unknownError
  );
});

async function runError(error: Error) {
  return commitSalesChangesActionWithDependencies("order-1", 1, undefined, {
    requireOrderFinancialUpdate: async () => ({
      id: "staff-1",
      role: UserRole.ADMIN,
    }),
    commitOrderChanges: async () => {
      throw error;
    },
    revalidateSalesPaths: () => undefined,
  });
}
