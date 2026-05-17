import assert from "node:assert/strict";
import test from "node:test";
import { buildCompositionView } from "@/modules/composition-view/composition-view.model";
import type {
  AdjustmentCompositionLine,
  AdjustmentCompositionTotals,
} from "@/modules/adjustment-workspace/adjustment-workspace.types";

test("drops only zero-delta self-swap no-op rows", () => {
  const view = buildCompositionView({
    mode: "locked",
    lines: [
      line({
        lineId: "same-album",
        label: "Album 30x30 to Album 30x30",
        lineTotalNet: "0.000",
      }),
      line({
        lineId: "real-zero",
        label: "Complimentary USB",
        lineTotalNet: "0.000",
      }),
    ],
    totals: totals("0.000"),
  });

  assert.deepEqual(
    view.rows.map((row) => row.id),
    ["real-zero"]
  );
  assertEmittedRowsMatchTotal(view.rows, view.total);
});

test("groups same-category swap pairs without losing money", () => {
  const view = buildCompositionView({
    mode: "adjustment",
    lines: [
      line({
        lineId: "remove-album",
        label: "Album 30x30 to Album 20x20",
        quantity: -2,
        unitPrice: "20.000",
        lineTotalNet: "-40.000",
      }),
      line({
        lineId: "add-album",
        label: "Album 20x20",
        quantity: 2,
        unitPrice: "10.000",
        lineTotalNet: "20.000",
      }),
      line({
        lineId: "prints",
        label: "Extra photos - Print (Premium)",
        quantity: 2,
        unitPrice: "5.000",
        lineTotalNet: "10.000",
      }),
    ],
    totals: totals("-10.000"),
  });

  assert.equal(view.rows[0]?.kind, "swap");
  assert.deepEqual(view.rows[0]?.delta, {
    from: "Album 30x30",
    to: "Album 20x20",
    amount: -20,
  });
  assert.equal(view.rows[0]?.lineTotal, -20);
  assertEmittedRowsMatchTotal(view.rows, view.total);
});

test("relabels non-zero unpaired change rows as upgrades", () => {
  const view = buildCompositionView({
    mode: "locked",
    lines: [
      line({
        lineId: "premium-frame",
        label: "Frame to Premium Frame",
        unitPrice: "25.000",
        lineTotalNet: "25.000",
      }),
    ],
    totals: totals("25.000"),
  });

  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0]?.kind, "upgrade");
  assert.deepEqual(view.rows[0]?.delta, {
    from: "Frame",
    to: "Premium Frame",
    amount: 25,
  });
  assertEmittedRowsMatchTotal(view.rows, view.total);
});

test("passes through package, add-on, extra-photo, and plain rows", () => {
  const view = buildCompositionView({
    mode: "locked",
    lines: [
      line({
        lineId: "package:1",
        kind: "package",
        label: "Premium Package",
        unitPrice: "250.000",
        lineTotalNet: "250.000",
      }),
      line({
        lineId: "addon:1",
        kind: "addon",
        label: "USB Box",
        unitPrice: "20.000",
        lineTotalNet: "20.000",
      }),
      line({
        lineId: "extra-photo:1:digital",
        label: "Extra photos - Digital (Premium)",
        quantity: 3,
        unitPrice: "2.000",
        lineTotalNet: "6.000",
      }),
      line({
        lineId: "line:1",
        label: "Studio Credit",
        unitPrice: "-5.000",
        lineTotalNet: "-5.000",
      }),
    ],
    totals: totals("271.000"),
  });

  assert.deepEqual(
    view.rows.map((row) => row.kind),
    ["package", "addOn", "extraPhotos", "line"]
  );
  assertEmittedRowsMatchTotal(view.rows, view.total);
});

test("uses upstream totals instead of recomputing the view total", () => {
  const view = buildCompositionView({
    mode: "locked",
    lines: [
      line({
        lineId: "package:1",
        kind: "package",
        label: "Premium Package",
        unitPrice: "250.000",
        lineTotalNet: "250.000",
      }),
    ],
    totals: totals("250.000"),
  });

  assert.equal(view.total, 250);
  assert.equal(sumRows(view.rows), 250);
  assertEmittedRowsMatchTotal(view.rows, view.total);
});

test("normalizes the album screenshot regression fixture", () => {
  const view = buildCompositionView({
    mode: "locked",
    lines: [
      line({
        lineId: "package:1",
        kind: "package",
        label: "Premium Package",
        unitPrice: "250.000",
        lineTotalNet: "250.000",
      }),
      line({
        lineId: "album-removal",
        label: "Album 30x30 to Album 20x20",
        quantity: -2,
        unitPrice: "20.000",
        lineTotalNet: "-40.000",
      }),
      line({
        lineId: "album-addition",
        label: "Album 20x20",
        quantity: 2,
        unitPrice: "0.000",
        lineTotalNet: "0.000",
      }),
      line({
        lineId: "album-noop",
        label: "Album 30x30 to Album 30x30",
        lineTotalNet: "0.000",
      }),
    ],
    totals: totals("210.000"),
  });

  assert.deepEqual(
    view.rows.map((row) => row.kind),
    ["package", "swap"]
  );
  assert.equal(view.rows[1]?.label, "Album Change");
  assert.deepEqual(view.rows[1]?.delta, {
    from: "Album 30x30",
    to: "Album 20x20",
    amount: -40,
  });
  assert.equal(
    view.rows.some((row) => row.label === "Album 30x30 to Album 30x30"),
    false
  );
  assertEmittedRowsMatchTotal(view.rows, view.total);
});

function line(
  overrides: Partial<AdjustmentCompositionLine>
): AdjustmentCompositionLine {
  const unitPrice = overrides.unitPrice ?? "10.000";
  const quantity = overrides.quantity ?? 1;
  const lineTotalNet =
    overrides.lineTotalNet ?? (Number(unitPrice) * quantity).toFixed(3);

  return {
    lineId: "line",
    kind: "item",
    refId: overrides.label ?? "ref",
    label: "Line",
    quantity,
    unitPrice,
    lineTotalGross: lineTotalNet,
    lineTotalNet,
    taxBreakdown: [],
    ...overrides,
  };
}

function totals(netPayable: string): AdjustmentCompositionTotals {
  return {
    gross: netPayable,
    discount: "0.000",
    tax: "0.000",
    netPayable,
  };
}

function assertEmittedRowsMatchTotal(
  rows: Array<{ lineTotal: number }>,
  total: number
) {
  assert.equal(sumRows(rows), total);
}

function sumRows(rows: Array<{ lineTotal: number }>): number {
  return Number(rows.reduce((sum, row) => sum + row.lineTotal, 0).toFixed(3));
}
