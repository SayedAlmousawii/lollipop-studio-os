import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import { Prisma } from "@prisma/client";
import type {
  AdjustmentBaseSnapshot,
  AdjustmentWorkspaceEdit,
} from "@/modules/adjustment-workspace/adjustment-workspace.types";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };
const originalModuleLoad = moduleWithLoader._load;

moduleWithLoader._load = function loadWithServerOnlyStub(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalModuleLoad.call(this, request, parent, isMain);
};

const baseSnapshot: AdjustmentBaseSnapshot = {
  capturedAt: "2026-05-17T00:00:00.000Z",
  lines: [
    {
      lineId: "package:1",
      kind: "package",
      refId: "pkg-basic",
      label: "Basic",
      quantity: 1,
      unitPrice: "100.000",
      lineTotalGross: "100.000",
      lineTotalNet: "100.000",
      taxBreakdown: [],
    },
    {
      lineId: "addon:1",
      kind: "addon",
      refId: "album-small",
      label: "Small Album",
      quantity: 1,
      unitPrice: "20.000",
      lineTotalGross: "20.000",
      lineTotalNet: "20.000",
      taxBreakdown: [],
    },
  ],
  totals: {
    gross: "120.000",
    discount: "0.000",
    tax: "0.000",
    netPayable: "120.000",
  },
};

test("workspace net delta requires approval only for finalized decreases", async () => {
  const { computeWorkspaceProposal } = await import(
    "@/modules/adjustment-workspace/adjustment-workspace.service"
  );
  const catalog = {
    products: new Map([
      [
        "album-large",
        { id: "album-large", name: "Large Album", price: new Prisma.Decimal("35.000") },
      ],
    ]),
    packages: new Map<string, { id: string; name: string; price: Prisma.Decimal }>(),
  };

  const increase = await computeWorkspaceProposal(
    baseSnapshot,
    {
      edits: [
        {
          id: "add-large-album",
          op: "add_line",
          kind: "addon",
          refId: "album-large",
          quantity: 1,
        },
      ],
    },
    catalog
  );
  assert.equal(increase.netPayableDelta, "35.000");
  assert.equal(increase.requiresManagerApproval, false);
  assert.equal(increase.adjustmentKind, "positive");

  const decrease = await computeWorkspaceProposal(
    baseSnapshot,
    {
      edits: [
        {
          id: "remove-small-album",
          op: "remove_line",
          targetLineId: "addon:1",
        },
      ],
    },
    catalog
  );
  assert.equal(decrease.netPayableDelta, "-20.000");
  assert.equal(decrease.requiresManagerApproval, true);
  assert.equal(decrease.adjustmentKind, "negative");
});

test("zero-net swaps keep paired signed entries and finalize as zero-net", async () => {
  const { computeWorkspaceProposal } = await import(
    "@/modules/adjustment-workspace/adjustment-workspace.service"
  );
  const edits: AdjustmentWorkspaceEdit[] = [
    {
      id: "swap-basic",
      op: "swap_package",
      fromPackageRefId: "pkg-basic",
      toPackageRefId: "pkg-basic-alt",
    },
  ];
  const proposal = await computeWorkspaceProposal(
    baseSnapshot,
    { edits },
    {
      products: new Map(),
      packages: new Map([
        [
          "pkg-basic-alt",
          {
            id: "pkg-basic-alt",
            name: "Basic Alt",
            price: new Prisma.Decimal("100.000"),
          },
        ],
      ]),
    }
  );

  assert.equal(proposal.netPayableDelta, "0.000");
  assert.equal(proposal.requiresManagerApproval, false);
  assert.equal(proposal.adjustmentKind, "zero_net");
  assert.equal(proposal.deltas.length, 2);
  assert.equal(proposal.deltas[0].quantity, -1);
  assert.equal(proposal.deltas[1].quantity, 1);
});
