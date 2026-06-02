import assert from "node:assert/strict";
import test from "node:test";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import type { ActorContext } from "@/lib/auth/actor-context";
import {
  OrderCommitDraftMissingError,
  OrderCommitDraftPermissionError,
  OrderCommitDraftStaleVersionError,
  type OrderCommitDraftStagingChange,
} from "@/modules/order-commits";
import type { OrderCommitDraftState } from "@/modules/order-commits/order-commit.service";
import {
  discardSalesDraftActionWithDependencies,
  stageSalesChangeActionWithDependencies,
  type SalesDraftActionDependencies,
} from "@/modules/order-commits/sales-staging-actions";

test("stage action lazily creates the draft and stages subsequent changes", async () => {
  const state = fakeActionState();
  const dependencies = fakeDependencies(state);
  const first = await stageSalesChangeActionWithDependencies(
    "order-1",
    0,
    fakeChange(),
    dependencies
  );
  const second = await stageSalesChangeActionWithDependencies(
    "order-1",
    1,
    fakeChange(),
    dependencies
  );

  assert.deepEqual(first, { kind: "success" });
  assert.deepEqual(second, { kind: "success" });
  assert.equal(state.draft?.version, 2);
  assert.equal(state.calls.getOrCreate, 2);
  assert.deepEqual(state.calls.stageExpectedVersions, [0, 1]);
  assert.deepEqual(state.calls.revalidate, ["order-1", "order-1"]);
});

test("stage action maps stale expectedVersion to draft.stale", async () => {
  const state = fakeActionState({ draft: { version: 1, ownerUserId: "user-1" } });
  const result = await stageSalesChangeActionWithDependencies(
    "order-1",
    0,
    fakeChange(),
    fakeDependencies(state)
  );

  assert.deepEqual(result, {
    kind: "error",
    errors: { _global: ["draft.stale"] },
  });
  assert.equal(state.draft?.version, 1);
  assert.deepEqual(state.calls.revalidate, []);
});

test("stage action maps non-owner mutation to draft.permission", async () => {
  const state = fakeActionState({
    actor: { id: "other-user", role: UserRole.RECEPTIONIST },
    draft: { version: 0, ownerUserId: "owner-user" },
  });
  const result = await stageSalesChangeActionWithDependencies(
    "order-1",
    0,
    fakeChange(),
    fakeDependencies(state)
  );

  assert.deepEqual(result, {
    kind: "error",
    errors: { _global: ["draft.permission"] },
  });
  assert.equal(state.draft?.version, 0);
});

test("stage action maps staging validation errors to field errors", async () => {
  const state = fakeActionState({
    stageOverride: () => z.object({ domain: z.string() }).parse({}),
  });
  const result = await stageSalesChangeActionWithDependencies(
    "order-1",
    0,
    fakeChange(),
    fakeDependencies(state)
  );

  assert.equal(result.kind, "error");
  assert.deepEqual(result.errors?.domain, [
    "Invalid input: expected string, received undefined",
  ]);
});

test("discard action removes a draft without staging or touching order rows", async () => {
  const state = fakeActionState({ draft: { version: 2, ownerUserId: "user-1" } });
  const beforeOrderRows = structuredClone(state.orderRows);
  const result = await discardSalesDraftActionWithDependencies(
    "order-1",
    2,
    fakeDependencies(state)
  );

  assert.deepEqual(result, { kind: "success" });
  assert.equal(state.draft, null);
  assert.deepEqual(state.orderRows, beforeOrderRows);
  assert.deepEqual(state.calls.stageExpectedVersions, []);
  assert.deepEqual(state.calls.revalidate, ["order-1"]);
});

test("discard action maps stale expectedVersion and keeps the draft", async () => {
  const state = fakeActionState({ draft: { version: 2, ownerUserId: "user-1" } });
  const result = await discardSalesDraftActionWithDependencies(
    "order-1",
    1,
    fakeDependencies(state)
  );

  assert.deepEqual(result, {
    kind: "error",
    errors: { _global: ["draft.stale"] },
  });
  assert.equal(state.draft?.version, 2);
  assert.deepEqual(state.calls.revalidate, []);
});

test("discard action maps missing draft to draft.missing", async () => {
  const state = fakeActionState({ draft: null });
  const result = await discardSalesDraftActionWithDependencies(
    "order-1",
    0,
    fakeDependencies(state)
  );

  assert.deepEqual(result, {
    kind: "error",
    errors: { _global: ["draft.missing"] },
  });
});

type FakeDraft = {
  version: number;
  ownerUserId: string;
};

type FakeActionState = {
  actor: { id: string; role: UserRole };
  draft: FakeDraft | null;
  orderRows: Array<{ id: string; marker: string }>;
  stageOverride?: () => unknown;
  calls: {
    getOrCreate: number;
    stageExpectedVersions: number[];
    discardExpectedVersions: number[];
    revalidate: string[];
  };
};

function fakeActionState(input: {
  actor?: { id: string; role: UserRole };
  draft?: FakeDraft | null;
  stageOverride?: () => unknown;
} = {}): FakeActionState {
  return {
    actor: input.actor ?? { id: "user-1", role: UserRole.RECEPTIONIST },
    draft:
      input.draft === undefined
        ? null
        : input.draft,
    orderRows: [{ id: "order-1", marker: "unchanged" }],
    stageOverride: input.stageOverride,
    calls: {
      getOrCreate: 0,
      stageExpectedVersions: [],
      discardExpectedVersions: [],
      revalidate: [],
    },
  };
}

function fakeDependencies(state: FakeActionState): SalesDraftActionDependencies {
  return {
    requireOrderFinancialUpdate: async () => state.actor,
    getOrCreateOrderCommitDraft: async ({ actorContext }) => {
      state.calls.getOrCreate += 1;
      if (!state.draft) {
        state.draft = {
          version: 0,
          ownerUserId: actorContext.actorUserId,
        };
      }
      return {} as OrderCommitDraftState;
    },
    stageOrderCommitDraftChange: async ({
      expectedVersion,
      actorContext,
    }) => {
      state.calls.stageExpectedVersions.push(expectedVersion);
      state.stageOverride?.();
      assertDraftMutable(state, actorContext, "stage");
      if (!state.draft) {
        throw new OrderCommitDraftMissingError("order-1", "stage");
      }
      if (state.draft.version !== expectedVersion) {
        throw new OrderCommitDraftStaleVersionError(
          expectedVersion,
          state.draft.version,
          "draft-1"
        );
      }
      state.draft.version += 1;
      return {} as OrderCommitDraftState;
    },
    discardOrderCommitDraft: async ({ expectedVersion, actorContext }) => {
      state.calls.discardExpectedVersions.push(expectedVersion);
      assertDraftMutable(state, actorContext, "discard");
      if (!state.draft) {
        throw new OrderCommitDraftMissingError("order-1", "discard");
      }
      if (state.draft.version !== expectedVersion) {
        throw new OrderCommitDraftStaleVersionError(
          expectedVersion,
          state.draft.version,
          "draft-1"
        );
      }
      state.draft = null;
      return {} as OrderCommitDraftState;
    },
    revalidateSalesPaths: (orderId) => {
      state.calls.revalidate.push(orderId);
    },
  };
}

function assertDraftMutable(
  state: FakeActionState,
  actorContext: ActorContext,
  action: string
): void {
  if (!state.draft) return;
  if (
    state.draft.ownerUserId === actorContext.actorUserId ||
    actorContext.actorRole === UserRole.ADMIN ||
    actorContext.actorRole === UserRole.MANAGER
  ) {
    return;
  }

  throw new OrderCommitDraftPermissionError(
    actorContext.actorUserId,
    "draft-1",
    action
  );
}

function fakeChange(): OrderCommitDraftStagingChange {
  return {
    domain: "ADD_ON",
    action: "ADD",
    parentPackageTarget: { stableKey: "order-package:1" },
    productId: "product-1",
    quantity: 1,
  };
}
