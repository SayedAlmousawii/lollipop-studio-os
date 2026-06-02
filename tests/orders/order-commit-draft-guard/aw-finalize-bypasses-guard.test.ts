import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  firstOrderPackageId,
  withSpec126Harness,
} from "../../spec-126/test-helpers";

const repoRoot = process.cwd();

test("AW finalize bypasses the active OrderCommitDraft guard end-to-end", async () => {
  await withSpec126Harness(async (ctx) => {
    const workflow = await ctx.buildLockedFinalInvoiceWorkflow("aw-bypass");
    const orderPackageId = await firstOrderPackageId(ctx.db, workflow.orderId);
    await ctx.orderCommitServices.getOrCreateOrderCommitDraft({
      orderId: workflow.orderId,
      actorContext: ctx.fixtures.adminActor,
    });

    const workspace = await ctx.adjustmentWorkspaceServices.openWorkspace(
      workflow.finalInvoiceId,
      ctx.fixtures.adminActor
    );
    const view = await ctx.adjustmentWorkspaceServices.applyEdit(
      workspace.id,
      {
        version: 0,
        edit: {
          id: "spec-126-aw-photo-count",
          op: "change_selected_photo_count",
          orderPackageId,
          selectedPhotoCount: 12,
          extraDigitalCount: 2,
          extraPrintCount: 0,
        },
      },
      ctx.fixtures.adminActor
    );

    const result = await ctx.adjustmentWorkspaceServices.finalizeWorkspace(
      workspace.id,
      { version: view.version },
      ctx.fixtures.adminActor
    );
    assert.ok(result.adjustmentInvoiceId);
    await assert.doesNotReject(async () =>
      ctx.db.adjustmentWorkspace.findUniqueOrThrow({
        where: { id: workspace.id },
        select: { status: true },
      })
    );
    assert.equal(
      await ctx.db.orderCommitDraft.count({
        where: { orderId: workflow.orderId },
      }),
      1
    );
  });
});

test("bypassOrderCommitDraftGuard true assignment is AW-only", () => {
  const matches = searchSourceLiteral(
    path.join(repoRoot, "src"),
    "bypassOrderCommitDraftGuard: true"
  );

  assert.deepEqual(matches, [
    "src/modules/adjustment-workspace/adjustment-workspace.service.ts",
  ]);
});

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
