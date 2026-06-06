import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("composition module exports the live OrderComposition view-model APIs", () => {
  const source = readFileSync(
    join(process.cwd(), "src/modules/orders/composition/index.ts"),
    "utf8"
  );

  assert.match(source, /getOrderCompositionViewModel/);
  assert.match(source, /buildCompositionSnapshotFromPOSWorkspace/);
  assert.match(source, /toLockedPOSComposition/);
});

test("new composition module does not introduce label-derived swap parsing", () => {
  const violations = walk(join(process.cwd(), "src/modules/orders/composition"))
    .filter((filePath) => filePath.endsWith(".ts"))
    .filter((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return (
        source.includes("parseChangeLabel") ||
        source.includes('" to "') ||
        source.includes("' to '") ||
        source.includes("` to `") ||
        source.includes("\\s+to\\s+")
      );
    })
    .map((filePath) => filePath.replace(`${process.cwd()}/`, ""));

  assert.deepEqual(violations, []);
});

test("R7b projector files stay pure", () => {
  const violations = walk(
    join(process.cwd(), "src/modules/orders/composition/projections")
  )
    .filter((filePath) => filePath.endsWith(".ts"))
    .flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");
      const forbidden = [
        "@/lib/db",
        "@/components/",
        "@/app/",
        "app/",
        "order.service",
        "server action",
      ].filter((pattern) => source.includes(pattern));
      return forbidden.map(
        (pattern) => `${filePath.replace(`${process.cwd()}/`, "")}: ${pattern}`
      );
    });

  assert.deepEqual(violations, []);
});

test("Spec 145 order composition service is Adjustment Workspace-free", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "src/modules/orders/composition/order-composition.service.ts"
    ),
    "utf8"
  );

  for (const forbidden of [
    "@/modules/adjustment-workspace",
    "AdjustmentWorkspaceStatus",
    "AdjustmentWorkspaceEdit",
    "getPendingAdjustmentOrderCompositionViewModel",
    "workspaceId",
    ".adjustmentWorkspace",
  ]) {
    assert.doesNotMatch(source, new RegExp(escapeRegExp(forbidden)));
  }
});

test("Spec 145 orders table projection does not read Adjustment Workspace rows", () => {
  const source = readFileSync(
    join(process.cwd(), "src/modules/orders/order.service.ts"),
    "utf8"
  );
  const fetchOrdersBody = functionBody(source, "fetchOrders", "fetchOrdersByCustomerId");
  const mapOrderBody = functionBody(source, "mapOrderRow", "formatOrderPackageNames");

  assert.doesNotMatch(fetchOrdersBody, /adjustmentWorkspaces/);
  assert.doesNotMatch(fetchOrdersBody, /AdjustmentWorkspaceStatus/);
  assert.doesNotMatch(
    mapOrderBody,
    new RegExp(["hasOpen", "AdjustmentWorkspace"].join(""))
  );
  assert.doesNotMatch(mapOrderBody, /adjustmentWorkspaces/);
});

function walk(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const absolute = join(directory, entry);
      const stat = statSync(absolute);
      if (stat.isDirectory()) {
        visit(absolute);
        continue;
      }
      files.push(absolute);
    }
  };
  visit(root);
  return files.sort();
}

function functionBody(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `${startMarker} not found`);
  assert.notEqual(end, -1, `${endMarker} not found after ${startMarker}`);
  return source.slice(start, end);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
