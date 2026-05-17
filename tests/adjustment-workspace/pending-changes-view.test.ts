import assert from "node:assert/strict";
import test from "node:test";
import { buildPendingChangesView } from "@/modules/adjustment-workspace/pending-changes-view";
import type {
  AdjustmentBaseSnapshot,
  AdjustmentCompositionLine,
} from "@/modules/adjustment-workspace/adjustment-workspace.types";

test("renders package swaps as one human-readable pending change row", () => {
  const rows = buildPendingChangesView(
    [
      {
        id: "tier:package-1",
        op: "change_package_tier",
        orderPackageId: "package-1",
        toPackageRefId: "pkg-smaller",
      },
    ],
    {
      base: snapshot([line("package:package-1", "package", "pkg-large", "Album 30x30", 1, "80.000")]),
      proposed: snapshot([line("package:package-1", "package", "pkg-smaller", "Album 20x20", 1, "40.000")]),
      deltas: [
        line("delta:package:pkg-large", "package", "pkg-large", "Album 30x30", -1, "-80.000"),
        line("delta:package:pkg-smaller", "package", "pkg-smaller", "Album 20x20", 1, "40.000"),
      ],
    }
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.label, "Package Change");
  assert.equal(rows[0]?.description, "Album 30x30 → Album 20x20");
  assert.equal(rows[0]?.amount, -40);
});

test("renders staged POS edit types without raw operation names", () => {
  const rows = buildPendingChangesView([
    { id: "add-1", op: "add_line", kind: "addon", refId: "usb-box", quantity: 1 },
    { id: "remove-1", op: "remove_line", targetLineId: "addon:old" },
    {
      id: "upgrade-1",
      op: "upgrade_package_item",
      orderPackageId: "package-1",
      packageItemId: "frame-basic",
      toProductId: "frame-premium",
      quantity: 1,
    },
    {
      id: "photos-1",
      op: "change_selected_photo_count",
      orderPackageId: "package-1",
      selectedPhotoCount: 18,
      extraDigitalCount: 3,
      extraPrintCount: 0,
    },
  ]);

  const rendered = rows.map((row) => `${row.label} ${row.description}`).join(" ");
  assert.doesNotMatch(rendered, /add_line|remove_line|upgrade_package_item|change_selected_photo_count/);
  assert.match(rendered, /Add add-on/);
  assert.match(rendered, /Remove line/);
  assert.match(rendered, /Frame Change/);
  assert.match(rendered, /Selected Photos/);
});

function snapshot(lines: AdjustmentCompositionLine[]): AdjustmentBaseSnapshot {
  const total = lines
    .reduce((sum, currentLine) => sum + Number(currentLine.lineTotalNet), 0)
    .toFixed(3);
  return {
    capturedAt: "2026-05-17T00:00:00.000Z",
    lines,
    totals: {
      gross: total,
      discount: "0.000",
      tax: "0.000",
      netPayable: total,
    },
  };
}

function line(
  lineId: string,
  kind: AdjustmentCompositionLine["kind"],
  refId: string,
  label: string,
  quantity: number,
  lineTotalNet: string
): AdjustmentCompositionLine {
  const unitPrice = (Number(lineTotalNet) / quantity).toFixed(3);
  return {
    lineId,
    kind,
    refId,
    label,
    quantity,
    unitPrice,
    lineTotalGross: lineTotalNet,
    lineTotalNet,
    taxBreakdown: [],
  };
}
