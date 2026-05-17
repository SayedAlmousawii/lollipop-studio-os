import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import { InvoiceLineType, OrderEntityKind, Prisma } from "@prisma/client";
import { adjustmentPendingChangesSchema } from "@/modules/adjustment-workspace/adjustment-workspace.schema";
import type {
  AdjustmentBaseSnapshot,
  AdjustmentCompositionLine,
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

const packageEditBaseSnapshot: AdjustmentBaseSnapshot = {
  capturedAt: "2026-05-17T00:00:00.000Z",
  lines: [
    {
      lineId: "package:order-package-1",
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
      lineId: "item:order-package-1:package-item-frame",
      kind: "item",
      refId: "product-frame",
      label: "Frame",
      quantity: 1,
      unitPrice: "0.000",
      lineTotalGross: "0.000",
      lineTotalNet: "0.000",
      taxBreakdown: [],
    },
    {
      lineId: "extra-photo:order-package-1:digital",
      kind: "item",
      refId: "Extra photos - Digital (Basic)",
      label: "Extra photos - Digital (Basic)",
      quantity: 2,
      unitPrice: "5.000",
      lineTotalGross: "10.000",
      lineTotalNet: "10.000",
      taxBreakdown: [],
    },
  ],
  totals: {
    gross: "110.000",
    discount: "0.000",
    tax: "0.000",
    netPayable: "110.000",
  },
};

const packageEditCatalog = {
  products: new Map([
    [
      "product-premium-frame",
      {
        id: "product-premium-frame",
        name: "Premium Frame",
        price: new Prisma.Decimal("35.000"),
      },
    ],
  ]),
  packages: new Map([
    [
      "pkg-basic",
      {
        id: "pkg-basic",
        name: "Basic",
        price: new Prisma.Decimal("100.000"),
        photoCount: 10,
      },
    ],
    [
      "pkg-premium",
      {
        id: "pkg-premium",
        name: "Premium",
        price: new Prisma.Decimal("150.000"),
        photoCount: 15,
      },
    ],
  ]),
  packageItems: new Map([
    [
      "package-item-frame",
      {
        id: "package-item-frame",
        packageId: "pkg-basic",
        productId: "product-frame",
        productName: "Frame",
        price: new Prisma.Decimal("10.000"),
        quantity: 1,
      },
    ],
  ]),
  orderPackages: new Map([
    [
      "order-package-1",
      {
        id: "order-package-1",
        packageId: "pkg-basic",
        packageName: "Basic",
        includedPhotoCount: 10,
        sessionTypeId: "session-family",
        extraDigitalUnitPrice: new Prisma.Decimal("5.000"),
        extraPrintUnitPrice: new Prisma.Decimal("7.000"),
      },
    ],
  ]),
};

test("pending changes parser accepts mixed old and new edit shapes", () => {
  const parsed = adjustmentPendingChangesSchema.parse({
    edits: [
      {
        id: "swap-old-shape",
        op: "swap_package",
        fromPackageRefId: "pkg-basic",
        toPackageRefId: "pkg-premium",
      },
      {
        id: "tier-new-shape",
        op: "change_package_tier",
        orderPackageId: "order-package-1",
        toPackageRefId: "pkg-premium",
      },
      {
        id: "upgrade-item",
        op: "upgrade_package_item",
        orderPackageId: "order-package-1",
        packageItemId: "package-item-frame",
        toProductId: "product-premium-frame",
        quantity: "1",
      },
      {
        id: "photo-count",
        op: "change_selected_photo_count",
        orderPackageId: "order-package-1",
        selectedPhotoCount: "13",
        extraDigitalCount: "1",
        extraPrintCount: "2",
      },
    ],
  });

  assert.equal(parsed.edits.length, 4);
  assert.equal(parsed.edits[2]?.op, "upgrade_package_item");
  assert.equal(
    parsed.edits[2]?.op === "upgrade_package_item" ? parsed.edits[2].quantity : null,
    1
  );
});

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

test("package item upgrade replaces the package deliverable line", async () => {
  const { computeWorkspaceProposal } = await import(
    "@/modules/adjustment-workspace/adjustment-workspace.service"
  );
  const proposal = await computeWorkspaceProposal(
    packageEditBaseSnapshot,
    {
      edits: [
        {
          id: "upgrade-frame",
          op: "upgrade_package_item",
          orderPackageId: "order-package-1",
          packageItemId: "package-item-frame",
          toProductId: "product-premium-frame",
          quantity: 1,
        },
      ],
    },
    packageEditCatalog
  );

  const upgradedLine = proposal.proposed.lines.find(
    (line) => line.lineId === "item:order-package-1:package-item-frame"
  );
  assert.equal(upgradedLine?.refId, "product-premium-frame");
  assert.equal(upgradedLine?.label, "Frame to Premium Frame");
  assert.equal(upgradedLine?.unitPrice, "25.000");
  assert.equal(proposal.netPayableDelta, "25.000");
  assert.equal(proposal.deltas.some((line) => line.refId === "product-frame"), true);
  assert.equal(
    proposal.deltas.some((line) => line.refId === "product-premium-frame"),
    true
  );
});

test("selected photo count changes replace extra-photo billing lines", async () => {
  const { computeWorkspaceProposal } = await import(
    "@/modules/adjustment-workspace/adjustment-workspace.service"
  );
  const proposal = await computeWorkspaceProposal(
    packageEditBaseSnapshot,
    {
      edits: [
        {
          id: "change-photos",
          op: "change_selected_photo_count",
          orderPackageId: "order-package-1",
          selectedPhotoCount: 13,
          extraDigitalCount: 1,
          extraPrintCount: 2,
        },
      ],
    },
    packageEditCatalog
  );

  const extraLines = proposal.proposed.lines.filter((line) =>
    line.lineId.startsWith("extra-photo:order-package-1:")
  );
  assert.equal(extraLines.length, 2);
  assert.equal(
    extraLines.find((line) => line.lineId.endsWith(":digital"))?.quantity,
    1
  );
  assert.equal(
    extraLines.find((line) => line.lineId.endsWith(":print"))?.lineTotalNet,
    "14.000"
  );
  assert.equal(proposal.netPayableDelta, "9.000");
});

test("package tier changes are keyed by order package id", async () => {
  const { computeWorkspaceProposal } = await import(
    "@/modules/adjustment-workspace/adjustment-workspace.service"
  );
  const proposal = await computeWorkspaceProposal(
    packageEditBaseSnapshot,
    {
      edits: [
        {
          id: "change-tier",
          op: "change_package_tier",
          orderPackageId: "order-package-1",
          toPackageRefId: "pkg-premium",
        },
      ],
    },
    packageEditCatalog
  );

  const packageLine = proposal.proposed.lines.find(
    (line) => line.lineId === "package:order-package-1"
  );
  assert.equal(packageLine?.refId, "pkg-premium");
  assert.equal(packageLine?.label, "Premium");
  assert.equal(packageLine?.unitPrice, "150.000");
  assert.equal(proposal.netPayableDelta, "50.000");
});

test("tier change composes with package item and photo count changes", async () => {
  const { computeWorkspaceProposal } = await import(
    "@/modules/adjustment-workspace/adjustment-workspace.service"
  );
  const proposal = await computeWorkspaceProposal(
    packageEditBaseSnapshot,
    {
      edits: [
        {
          id: "change-tier",
          op: "change_package_tier",
          orderPackageId: "order-package-1",
          toPackageRefId: "pkg-premium",
        },
        {
          id: "upgrade-frame",
          op: "upgrade_package_item",
          orderPackageId: "order-package-1",
          packageItemId: "package-item-frame",
          toProductId: "product-premium-frame",
          quantity: 1,
        },
        {
          id: "change-photos",
          op: "change_selected_photo_count",
          orderPackageId: "order-package-1",
          selectedPhotoCount: 17,
          extraDigitalCount: 2,
          extraPrintCount: 0,
        },
      ],
    },
    packageEditCatalog
  );

  assert.equal(proposal.netPayableDelta, "75.000");
  assert.equal(
    proposal.proposed.lines.find((line) => line.lineId === "package:order-package-1")
      ?.refId,
    "pkg-premium"
  );
  assert.equal(
    proposal.proposed.lines.find((line) => line.refId === "product-premium-frame")
      ?.lineTotalNet,
    "25.000"
  );
  assert.equal(
    proposal.proposed.lines.find((line) => line.refId === "Extra photos - Digital (Premium)")
      ?.quantity,
    2
  );
});

test("reverting new staged ops before finalize normalizes to a no-op", async () => {
  const { computeWorkspaceProposal } = await import(
    "@/modules/adjustment-workspace/adjustment-workspace.service"
  );
  const proposal = await computeWorkspaceProposal(
    packageEditBaseSnapshot,
    {
      edits: [
        {
          id: "change-tier",
          op: "change_package_tier",
          orderPackageId: "order-package-1",
          toPackageRefId: "pkg-premium",
        },
        {
          id: "change-tier-back",
          op: "change_package_tier",
          orderPackageId: "order-package-1",
          toPackageRefId: "pkg-basic",
        },
        {
          id: "photos-back",
          op: "change_selected_photo_count",
          orderPackageId: "order-package-1",
          selectedPhotoCount: 12,
          extraDigitalCount: 2,
          extraPrintCount: 0,
        },
      ],
    },
    packageEditCatalog
  );

  assert.equal(proposal.netPayableDelta, "0.000");
  assert.equal(proposal.hasEdits, false);
  assert.equal(proposal.adjustmentKind, "none");
  assert.deepEqual(proposal.deltas, []);
});

test("adjustment invoice line semantics map new ops onto accounting causes", async () => {
  const { resolveAdjustmentInvoiceLineSemantics } = await import(
    "@/modules/adjustment-workspace/adjustment-workspace.service"
  );
  const line = (
    overrides: Partial<AdjustmentCompositionLine>
  ): AdjustmentCompositionLine => ({
    lineId: "line",
    kind: "item",
    refId: "ref",
    label: "Line",
    quantity: 1,
    unitPrice: "1.000",
    lineTotalGross: "1.000",
    lineTotalNet: "1.000",
    taxBreakdown: [],
    ...overrides,
  });

  assert.deepEqual(
    resolveAdjustmentInvoiceLineSemantics(line({ kind: "package" })),
    {
      lineType: InvoiceLineType.PACKAGE_UPGRADE,
      causeOrderEntityKind: OrderEntityKind.PACKAGE_TIER_UPGRADE,
    }
  );
  assert.deepEqual(resolveAdjustmentInvoiceLineSemantics(line({ kind: "item" })), {
    lineType: InvoiceLineType.PACKAGE_UPGRADE,
    causeOrderEntityKind: OrderEntityKind.UPGRADE,
  });
  assert.deepEqual(
    resolveAdjustmentInvoiceLineSemantics(
      line({
        lineId: "extra-photo:order-package-1:digital",
        refId: "Extra photos - Digital (Basic)",
      })
    ),
    {
      lineType: InvoiceLineType.BUNDLE_ADJUSTMENT,
      causeOrderEntityKind: OrderEntityKind.EXTRA_PHOTO,
    }
  );
  assert.deepEqual(resolveAdjustmentInvoiceLineSemantics(line({ kind: "addon" })), {
    lineType: InvoiceLineType.ADD_ON,
    causeOrderEntityKind: OrderEntityKind.ADDON,
  });
});

test("add then remove of the same staged line normalizes to a true no-op", async () => {
  const { computeWorkspaceProposal } = await import(
    "@/modules/adjustment-workspace/adjustment-workspace.service"
  );
  const proposal = await computeWorkspaceProposal(
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
        {
          id: "remove-large-album",
          op: "remove_line",
          targetLineId: "edit:add-large-album",
        },
      ],
    },
    {
      products: new Map([
        [
          "album-large",
          {
            id: "album-large",
            name: "Large Album",
            price: new Prisma.Decimal("35.000"),
          },
        ],
      ]),
      packages: new Map(),
    }
  );

  assert.equal(proposal.netPayableDelta, "0.000");
  assert.equal(proposal.hasEdits, false);
  assert.equal(proposal.adjustmentKind, "none");
  assert.deepEqual(proposal.deltas, []);
});

test("swap away then back to the base package normalizes to a true no-op", async () => {
  const { computeWorkspaceProposal } = await import(
    "@/modules/adjustment-workspace/adjustment-workspace.service"
  );
  const proposal = await computeWorkspaceProposal(
    baseSnapshot,
    {
      edits: [
        {
          id: "swap-to-alt",
          op: "swap_package",
          fromPackageRefId: "pkg-basic",
          toPackageRefId: "pkg-basic-alt",
        },
        {
          id: "swap-back",
          op: "swap_package",
          fromPackageRefId: "pkg-basic-alt",
          toPackageRefId: "pkg-basic",
        },
      ],
    },
    {
      products: new Map(),
      packages: new Map([
        [
          "pkg-basic",
          {
            id: "pkg-basic",
            name: "Basic",
            price: new Prisma.Decimal("100.000"),
          },
        ],
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
  assert.equal(proposal.hasEdits, false);
  assert.equal(proposal.adjustmentKind, "none");
  assert.deepEqual(proposal.deltas, []);
});

test("orphaned pending line edits do not crash proposal rendering", async () => {
  const { computeWorkspaceProposal } = await import(
    "@/modules/adjustment-workspace/adjustment-workspace.service"
  );
  const proposal = await computeWorkspaceProposal(
    baseSnapshot,
    {
      edits: [
        {
          id: "remove-already-removed-staged-line",
          op: "remove_line",
          targetLineId: "edit:add-large-album",
        },
      ],
    },
    {
      products: new Map(),
      packages: new Map(),
    }
  );

  assert.equal(proposal.netPayableDelta, "0.000");
  assert.equal(proposal.hasEdits, false);
  assert.equal(proposal.adjustmentKind, "none");
  assert.deepEqual(proposal.deltas, []);
});
