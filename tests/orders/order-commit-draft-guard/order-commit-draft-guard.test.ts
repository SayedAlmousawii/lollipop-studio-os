import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { UserRole } from "@prisma/client";
import type { ActorContext } from "@/lib/auth/actor-context";
import {
  assertNoActiveOrderCommitDraft,
} from "@/modules/orders/policies/order-commit-draft-guard";
import { OrderCommitDraftActiveError } from "@/modules/orders/order.errors";

const repoRoot = process.cwd();
const orderServicePath = path.join(
  repoRoot,
  "src/modules/orders/order.service.ts"
);
const adjustmentWorkspaceServicePath = path.join(
  repoRoot,
  "src/modules/adjustment-workspace/adjustment-workspace.service.ts"
);

test("draft guard throws typed error when an active draft exists", async () => {
  await assert.rejects(
    () =>
      assertNoActiveOrderCommitDraft({
        orderId: "order-1",
        actorContext: actorContext(),
        tx: fakeGuardTx({ hasDraft: true }),
      }),
    OrderCommitDraftActiveError
  );
});

test("draft guard passes when no draft exists", async () => {
  await assert.doesNotReject(() =>
    assertNoActiveOrderCommitDraft({
      orderId: "order-1",
      actorContext: actorContext(),
      tx: fakeGuardTx({ hasDraft: false }),
    })
  );
});

test("AW finalize bypass marker bypasses the draft guard", async () => {
  await assert.doesNotReject(() =>
    assertNoActiveOrderCommitDraft({
      orderId: "order-1",
      actorContext: {
        ...actorContext(),
        bypassOrderCommitDraftGuard: true,
      },
      tx: fakeGuardTx({ hasDraft: true }),
    })
  );
});

test("five legacy mutators run draft guard before locked-invoice guard", () => {
  const source = readFileSync(orderServicePath, "utf8");
  const mutators = [
    "updateOrderPackage",
    "upgradeOrderPackageItem",
    "addOrderProductAddOn",
    "removeOrderAddOn",
    "updateOrderSelectedPhotoCount",
  ];

  for (const mutator of mutators) {
    const segment = exportedFunctionSegment(source, mutator);
    const draftGuardIndex = segment.indexOf("assertNoActiveOrderCommitDraft");
    const lockedGuardIndex = segment.indexOf("assertDirectPOSMutationAllowed");

    assert.notEqual(draftGuardIndex, -1, `${mutator} is missing the draft guard`);
    assert.notEqual(
      lockedGuardIndex,
      -1,
      `${mutator} is missing the locked-invoice guard`
    );
    assert.ok(
      draftGuardIndex < lockedGuardIndex,
      `${mutator} must run the draft guard before the locked-invoice guard`
    );
  }
});

test("bypassOrderCommitDraftGuard true assignment is AW-only", () => {
  const srcRoot = path.join(repoRoot, "src");
  const matches = searchSourceLiteral(
    srcRoot,
    "bypassOrderCommitDraftGuard: true"
  );

  assert.deepEqual(matches, [
    "src/modules/adjustment-workspace/adjustment-workspace.service.ts",
  ]);
});

test("finalizeWorkspace carries the internal AW-only bypass marker", () => {
  const source = readFileSync(adjustmentWorkspaceServicePath, "utf8");
  const segment = exportedFunctionSegment(source, "finalizeWorkspace");

  assert.match(segment, /const finalizeActorContext: ActorContext = \{/);
  assert.match(segment, /bypassOrderCommitDraftGuard: true/);
});

function actorContext(): ActorContext {
  return {
    actorUserId: "user-1",
    actorRole: UserRole.RECEPTIONIST,
  };
}

function fakeGuardTx(input: { hasDraft: boolean }) {
  return {
    orderCommitDraft: {
      findUnique: async () => (input.hasDraft ? { id: "draft-1" } : null),
    },
  } as Parameters<typeof assertNoActiveOrderCommitDraft>[0]["tx"];
}

function exportedFunctionSegment(source: string, functionName: string): string {
  const start = source.indexOf(`export async function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} was not found`);
  const next = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function searchSourceLiteral(root: string, literal: string): string[] {
  const matches: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const absolute = path.join(directory, entry);
      const stat = statSync(absolute);
      if (stat.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!absolute.endsWith(".ts") && !absolute.endsWith(".tsx")) continue;

      const source = readFileSync(absolute, "utf8");
      if (source.includes(literal)) {
        matches.push(path.relative(repoRoot, absolute));
      }
    }
  };
  visit(root);
  return matches.sort();
}
