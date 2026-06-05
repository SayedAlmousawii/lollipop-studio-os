import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import { Prisma } from "@prisma/client";
import type {
  AdjustmentBaseSnapshot,
  AdjustmentCompositionLine,
  AdjustmentCompositionTotals,
  AdjustmentWorkspaceEdit,
} from "@/modules/adjustment-workspace/adjustment-workspace.types";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };

test("selected-photo baselines stay aligned across locked, staged, and finalized adjustment projections", async () => {
  await withServerOnlyStub(async () => {
    const { computeWorkspaceProposal } = await import(
      "@/modules/adjustment-workspace/adjustment-workspace.service"
    );
    const { buildCompositionSnapshotFromAdjustmentSnapshot } = await import(
      "@/modules/adjustment-workspace/adjustment-composition.service"
    );
    const { toLockedPOSComposition } = await import("@/modules/orders/composition");
    const base = baselineSnapshot();
    const edit: AdjustmentWorkspaceEdit = {
      id: "stage-selected-photos",
      op: "change_selected_photo_count",
      orderPackageId: "op-baseline",
      selectedPhotoCount: 24,
      extraDigitalCount: 2,
      extraPrintCount: 2,
    };
    const proposal = await computeWorkspaceProposal(
      base,
      { edits: [edit] },
      {
        products: new Map(),
        packages: new Map([
          [
            "pkg-baseline",
            {
              id: "pkg-baseline",
              name: "Baseline Package",
              price: new Prisma.Decimal("100.000"),
              photoCount: 20,
            },
          ],
        ]),
        orderPackages: new Map([
          [
            "op-baseline",
            {
              id: "op-baseline",
              packageId: "pkg-baseline",
              packageName: "Baseline Package",
              includedPhotoCount: 20,
              sessionTypeId: "session-portrait",
              extraDigitalUnitPrice: new Prisma.Decimal("2.000"),
              extraPrintUnitPrice: new Prisma.Decimal("3.000"),
            },
          ],
        ]),
      }
    );

    const cases = [
      {
        name: "locked",
        snapshot: base,
        pendingAdjustmentSnapshot: null,
        serviceSnapshot: base,
      },
      {
        name: "locked+staged",
        snapshot: base,
        pendingAdjustmentSnapshot: proposal.proposed,
        serviceSnapshot: proposal.proposed,
        edits: proposal.edits,
        adjustmentLines: proposal.deltas,
      },
      {
        name: "locked+finalized",
        snapshot: proposal.proposed,
        pendingAdjustmentSnapshot: null,
        serviceSnapshot: proposal.proposed,
      },
    ];

    for (const item of cases) {
      const baseComposition = buildCompositionSnapshotFromAdjustmentSnapshot(
        item.snapshot
      );
      const pendingAdjustmentComposition = item.pendingAdjustmentSnapshot
        ? buildCompositionSnapshotFromAdjustmentSnapshot(item.pendingAdjustmentSnapshot, {
            baseSnapshot: base,
            edits: item.edits,
            adjustmentLines: item.adjustmentLines,
          })
        : null;
      const effectiveComposition =
        item.pendingAdjustmentSnapshot && item.name === "locked+staged"
          ? baseComposition
          : buildCompositionSnapshotFromAdjustmentSnapshot(item.snapshot);
      const projection = toLockedPOSComposition({
        orderId: "order-1",
        jobNumber: "JOB-1",
        state: item.pendingAdjustmentSnapshot ? "adjustment" : "locked",
        baseComposition,
        effectiveComposition,
        pendingAdjustmentComposition,
        totals: (pendingAdjustmentComposition ?? effectiveComposition).totals,
      });
      const projectedLine = projection.packageLines.find(
        (line) => line.orderPackageId === "op-baseline"
      );
      const serviceBaseline = selectedPhotoBaselineFromAdjustmentSnapshot(
        item.serviceSnapshot,
        "op-baseline"
      );

      assert.deepEqual(
        {
          includedPhotoCount: projectedLine?.includedPhotoCount,
          selectedPhotoCount: projectedLine?.selectedPhotoCount,
          extraDigitalCount: projectedLine?.extraDigitalCount,
          extraPrintCount: projectedLine?.extraPrintCount,
        },
        serviceBaseline,
        item.name
      );
    }
  });
});

function selectedPhotoBaselineFromAdjustmentSnapshot(
  snapshot: AdjustmentBaseSnapshot,
  orderPackageId: string
) {
  const packageLine = snapshot.lines.find(
    (line) => line.lineId === `package:${orderPackageId}`
  );
  assert.ok(packageLine);
  const includedPhotoCount = packageLine.refMetadata?.includedPhotoCount ?? 0;
  const extraDigitalCount = extraPhotoCount(snapshot, orderPackageId, "digital");
  const extraPrintCount = extraPhotoCount(snapshot, orderPackageId, "print");

  return {
    includedPhotoCount,
    selectedPhotoCount: includedPhotoCount + extraDigitalCount + extraPrintCount,
    extraDigitalCount,
    extraPrintCount,
  };
}

function extraPhotoCount(
  snapshot: AdjustmentBaseSnapshot,
  orderPackageId: string,
  mediaType: "digital" | "print"
): number {
  return snapshot.lines
    .filter((line) => line.lineId === `extra-photo:${orderPackageId}:${mediaType}`)
    .reduce((sum, line) => sum + line.quantity, 0);
}

async function withServerOnlyStub<T>(callback: () => Promise<T>): Promise<T> {
  const originalModuleLoad = moduleWithLoader._load;
  moduleWithLoader._load = function loadWithServerOnlyStub(request, parent, isMain) {
    if (request === "server-only") return {};
    return originalModuleLoad.call(this, request, parent, isMain);
  };

  try {
    return await callback();
  } finally {
    moduleWithLoader._load = originalModuleLoad;
  }
}

function baselineSnapshot(): AdjustmentBaseSnapshot {
  return adjustmentSnapshot({
    lines: [
      adjustmentLine({
        lineId: "package:op-baseline",
        kind: "package",
        refId: "pkg-baseline",
        label: "Baseline Package",
        unitPrice: "100.000",
        lineTotalNet: "100.000",
        refMetadata: {
          includedPhotoCount: 20,
          selectedPhotoCount: 20,
          sessionTypeId: "session-portrait",
          sessionTypeName: "Portrait",
        },
      }),
    ],
  });
}

function adjustmentSnapshot(input: {
  lines: AdjustmentCompositionLine[];
}): AdjustmentBaseSnapshot {
  return {
    capturedAt: "2026-05-20T00:00:00.000Z",
    lines: input.lines,
    totals: totals(
      input.lines
        .reduce((sum, line) => sum + Number(line.lineTotalNet), 0)
        .toFixed(3)
    ),
  };
}

function adjustmentLine(
  overrides: Partial<AdjustmentCompositionLine>
): AdjustmentCompositionLine {
  const quantity = overrides.quantity ?? 1;
  const unitPrice = overrides.unitPrice ?? "1.000";
  const lineTotalNet =
    overrides.lineTotalNet ?? (Number(unitPrice) * quantity).toFixed(3);
  return {
    lineId: "line",
    kind: "addon",
    refId: "ref",
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
