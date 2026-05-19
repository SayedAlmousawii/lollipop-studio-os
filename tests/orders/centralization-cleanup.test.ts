import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const R12_DEPOSIT_DEDUP_REMOVED = false;

const ROOT = process.cwd();

test("R12 legacy order financial helpers are not declared", () => {
  const source = readFileSync(
    `${ROOT}/src/modules/orders/order.service.ts`,
    "utf8"
  );

  for (const helperName of [
    "summarizeInvoices",
    "mapPaymentStatus",
    "getOrderSettlementInvoices",
  ]) {
    assert.doesNotMatch(source, functionDeclaration(helperName));
  }
});

test("R12 booking deposit dedup helper is not declared after removal", () => {
  if (!R12_DEPOSIT_DEDUP_REMOVED) return;

  const source = readFileSync(
    `${ROOT}/src/modules/bookings/booking.service.ts`,
    "utf8"
  );

  assert.doesNotMatch(source, functionDeclaration("dedupeAndSortDepositInvoices"));
});

test("R12 OrderDetail no longer exposes aggregate photo-count fields", () => {
  const source = readFileSync(
    `${ROOT}/src/modules/orders/order.types.ts`,
    "utf8"
  );
  const orderDetailBlock = readInterfaceBlock(source, "OrderDetail");

  assert.doesNotMatch(orderDetailBlock, /^\s*includedPhotoCount\s*[:?]/m);
  assert.doesNotMatch(orderDetailBlock, /^\s*extraPhotoCount\s*[:?]/m);
});

function functionDeclaration(name: string): RegExp {
  return new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b`, "m");
}

function readInterfaceBlock(source: string, interfaceName: string): string {
  const declarationIndex = source.indexOf(`interface ${interfaceName}`);
  assert.notEqual(declarationIndex, -1, `${interfaceName} interface not found`);

  const openBraceIndex = source.indexOf("{", declarationIndex);
  assert.notEqual(openBraceIndex, -1, `${interfaceName} opening brace not found`);

  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBraceIndex + 1, index);
      }
    }
  }

  assert.fail(`${interfaceName} closing brace not found`);
}
