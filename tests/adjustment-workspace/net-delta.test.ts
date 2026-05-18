import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import {
  InvoiceLineType,
  OrderEntityKind,
  Prisma,
  SessionConfigurationFinancialBehavior,
  SessionConfigurationInputType,
  SessionConfigurationPricingMode,
} from "@prisma/client";
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
    [
      "product-gallery-frame",
      {
        id: "product-gallery-frame",
        name: "Gallery Frame",
        price: new Prisma.Decimal("45.000"),
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
    [
      "package-item-premium-frame",
      {
        id: "package-item-premium-frame",
        packageId: "pkg-premium",
        productId: "product-premium-frame",
        productName: "Premium Frame",
        price: new Prisma.Decimal("20.000"),
        quantity: 1,
      },
    ],
    [
      "package-item-unrelated-frame",
      {
        id: "package-item-unrelated-frame",
        packageId: "pkg-unrelated",
        productId: "product-unrelated-frame",
        productName: "Unrelated Frame",
        price: new Prisma.Decimal("12.000"),
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
  sessionConfigurations: new Map([
    [
      "config-twins",
      {
        id: "config-twins",
        sessionTypeId: "session-family",
        code: "TWINS",
        name: "Twins",
        inputType: SessionConfigurationInputType.TOGGLE,
        pricingMode: SessionConfigurationPricingMode.FIXED,
        financialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
        fixedPriceDelta: new Prisma.Decimal("12.000"),
        linkedProductId: null,
        linkedProductPrice: null,
        counterPricingMode: null,
        counterUnitPrice: null,
        options: new Map(),
      },
    ],
    [
      "config-cake",
      {
        id: "config-cake",
        sessionTypeId: "session-family",
        code: "CAKE",
        name: "Cake",
        inputType: SessionConfigurationInputType.TOGGLE,
        pricingMode: SessionConfigurationPricingMode.LINKED_PRODUCT,
        financialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
        fixedPriceDelta: null,
        linkedProductId: "product-cake",
        linkedProductPrice: new Prisma.Decimal("9.000"),
        counterPricingMode: null,
        counterUnitPrice: null,
        options: new Map(),
      },
    ],
    [
      "config-age",
      {
        id: "config-age",
        sessionTypeId: "session-family",
        code: "AGE",
        name: "Age Range",
        inputType: SessionConfigurationInputType.SELECT,
        pricingMode: SessionConfigurationPricingMode.TIERED,
        financialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
        fixedPriceDelta: null,
        linkedProductId: null,
        linkedProductPrice: null,
        counterPricingMode: null,
        counterUnitPrice: null,
        options: new Map([
          [
            "age-option",
            {
              id: "age-option",
              label: "30-45 Days",
              price: new Prisma.Decimal("12.000"),
              priceDelta: new Prisma.Decimal("12.000"),
            },
          ],
        ]),
      },
    ],
    [
      "config-theme",
      {
        id: "config-theme",
        sessionTypeId: "session-family",
        code: "THEME",
        name: "Theme",
        inputType: SessionConfigurationInputType.TEXT,
        pricingMode: SessionConfigurationPricingMode.NONE,
        financialBehavior: SessionConfigurationFinancialBehavior.OPERATIONAL,
        fixedPriceDelta: null,
        linkedProductId: null,
        linkedProductPrice: null,
        counterPricingMode: null,
        counterUnitPrice: null,
        options: new Map(),
      },
    ],
  ]),
};

function baseWithTwinsSelection(priceDelta: string): AdjustmentBaseSnapshot {
  return {
    ...packageEditBaseSnapshot,
    lines: [
      ...packageEditBaseSnapshot.lines,
      {
        lineId: "session-config:selection-twins",
        kind: "session_configuration",
        refId: "selection-twins",
        label: "Twins",
        quantity: 1,
        unitPrice: priceDelta,
        lineTotalGross: priceDelta,
        lineTotalNet: priceDelta,
        taxBreakdown: [],
      },
    ],
    totals: {
      gross: (110 + Number(priceDelta)).toFixed(3),
      discount: "0.000",
      tax: "0.000",
      netPayable: (110 + Number(priceDelta)).toFixed(3),
    },
    sessionConfigurationSelections: [
      {
        id: "selection-twins",
        orderPackageId: "order-package-1",
        configurationId: "config-twins",
        optionId: null,
        numericValue: null,
        textValue: null,
        snapshotOptionLabel: null,
        snapshotConfigurationCode: "TWINS",
        snapshotLabel: "Twins",
        snapshotPriceDelta: priceDelta,
        snapshotFinancialBehavior: "FINANCIAL",
        snapshotInputType: "TOGGLE",
        snapshotPricingMode: "FIXED",
        snapshotLinkedProductId: null,
        orderAddOnId: null,
      },
    ],
  };
}

function baseWithAgeSelection(optionLabel: string): AdjustmentBaseSnapshot {
  const priceDelta = "12.000";
  return {
    ...packageEditBaseSnapshot,
    lines: [
      ...packageEditBaseSnapshot.lines,
      {
        lineId: "session-config:selection-age",
        kind: "session_configuration",
        refId: "selection-age",
        label: `Age Range — ${optionLabel}`,
        quantity: 1,
        unitPrice: priceDelta,
        lineTotalGross: priceDelta,
        lineTotalNet: priceDelta,
        taxBreakdown: [],
      },
    ],
    totals: {
      gross: "122.000",
      discount: "0.000",
      tax: "0.000",
      netPayable: "122.000",
    },
    sessionConfigurationSelections: [
      {
        id: "selection-age",
        orderPackageId: "order-package-1",
        configurationId: "config-age",
        optionId: "age-option",
        numericValue: null,
        textValue: null,
        snapshotOptionLabel: optionLabel,
        snapshotConfigurationCode: "AGE",
        snapshotLabel: "Age Range",
        snapshotPriceDelta: priceDelta,
        snapshotFinancialBehavior: "FINANCIAL",
        snapshotInputType: "SELECT",
        snapshotPricingMode: "TIERED",
        snapshotLinkedProductId: null,
        orderAddOnId: null,
      },
    ],
  };
}

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
      {
        id: "session-config",
        op: "change_session_configuration_selection",
        orderPackageId: "order-package-1",
        configurationId: "config-twins",
        desired: { kind: "toggle" },
      },
    ],
  });

  assert.equal(parsed.edits.length, 5);
  assert.equal(parsed.edits[2]?.op, "upgrade_package_item");
  assert.equal(
    parsed.edits[2]?.op === "upgrade_package_item" ? parsed.edits[2].quantity : null,
    1
  );
});

test("session configuration workspace edits produce session configuration deltas", async () => {
  const { computeWorkspaceProposal, resolveAdjustmentInvoiceLineSemantics } = await import(
    "@/modules/adjustment-workspace/adjustment-workspace.service"
  );
  const proposal = await computeWorkspaceProposal(
    packageEditBaseSnapshot,
    {
      edits: [
        {
          id: "session-config",
          op: "change_session_configuration_selection",
          orderPackageId: "order-package-1",
          configurationId: "config-twins",
          desired: { kind: "toggle" },
        },
      ],
    },
    packageEditCatalog
  );

  assert.equal(proposal.netPayableDelta, "12.000");
  assert.equal(proposal.deltas.length, 1);
  assert.equal(proposal.deltas[0]?.kind, "session_configuration");
  assert.equal(proposal.deltas[0]?.refId, "pending:config-twins");
  assert.match(proposal.deltas[0]?.label ?? "", /^Added: /);
  assert.deepEqual(
    proposal.deltas.map((line) => resolveAdjustmentInvoiceLineSemantics(line)),
    [
      {
        lineType: InvoiceLineType.SESSION_CONFIGURATION,
        causeOrderEntityKind: OrderEntityKind.SESSION_CONFIGURATION_SELECTION,
      },
    ]
  );
});

test("linked-product session configuration workspace edits produce add-on deltas", async () => {
  const { computeWorkspaceProposal, resolveAdjustmentInvoiceLineSemantics } = await import(
    "@/modules/adjustment-workspace/adjustment-workspace.service"
  );
  const proposal = await computeWorkspaceProposal(
    packageEditBaseSnapshot,
    {
      edits: [
        {
          id: "session-config-cake",
          op: "change_session_configuration_selection",
          orderPackageId: "order-package-1",
          configurationId: "config-cake",
          desired: { kind: "toggle" },
        },
      ],
    },
    packageEditCatalog
  );

  assert.equal(proposal.netPayableDelta, "9.000");
  assert.equal(proposal.deltas.length, 1);
  assert.equal(proposal.deltas[0]?.kind, "addon");
  assert.equal(proposal.deltas[0]?.refId, "product-cake");
  assert.equal(
    proposal.deltas[0]?.refMetadata?.orderAddOnId,
    "pending:addon:config-cake"
  );
  assert.equal(proposal.deltas[0]?.label, "Added: Cake");
  assert.deepEqual(resolveAdjustmentInvoiceLineSemantics(proposal.deltas[0]!), {
    lineType: InvoiceLineType.ADD_ON,
    causeOrderEntityKind: OrderEntityKind.ADDON,
  });
});

test("session configuration workspace deltas prefix removed and changed descriptions", async () => {
  const { computeWorkspaceProposal } = await import(
    "@/modules/adjustment-workspace/adjustment-workspace.service"
  );
  const base = baseWithTwinsSelection("5.000");

  const removed = await computeWorkspaceProposal(
    base,
    {
      edits: [
        {
          id: "remove-session-config",
          op: "change_session_configuration_selection",
          orderPackageId: "order-package-1",
          configurationId: "config-twins",
          desired: null,
        },
      ],
    },
    packageEditCatalog
  );
  assert.match(removed.deltas[0]?.label ?? "", /^Removed: Twins/);

  const changed = await computeWorkspaceProposal(
    base,
    {
      edits: [
        {
          id: "change-session-config",
          op: "change_session_configuration_selection",
          orderPackageId: "order-package-1",
          configurationId: "config-twins",
          desired: { kind: "toggle" },
        },
      ],
    },
    packageEditCatalog
  );
  assert.match(changed.deltas[0]?.label ?? "", /^Changed: Twins → Twins/);
});

test("session configuration changed detection includes option label snapshots", async () => {
  const { computeWorkspaceProposal } = await import(
    "@/modules/adjustment-workspace/adjustment-workspace.service"
  );
  const proposal = await computeWorkspaceProposal(
    baseWithAgeSelection("Old Label"),
    {
      edits: [
        {
          id: "age-label-refresh",
          op: "change_session_configuration_selection",
          orderPackageId: "order-package-1",
          configurationId: "config-age",
          desired: { kind: "select", optionId: "age-option" },
        },
      ],
    },
    packageEditCatalog
  );

  assert.equal(proposal.netPayableDelta, "0.000");
  assert.equal(proposal.deltas.length, 0);
  assert.equal(proposal.hasEdits, true);
});

test("session configuration workspace edits accept operational configurations without deltas", async () => {
  const { computeWorkspaceProposal } = await import(
    "@/modules/adjustment-workspace/adjustment-workspace.service"
  );
  const proposal = await computeWorkspaceProposal(
    packageEditBaseSnapshot,
    {
      edits: [
        {
          id: "session-config",
          op: "change_session_configuration_selection",
          orderPackageId: "order-package-1",
          configurationId: "config-theme",
          desired: { kind: "text", textValue: "Blue" },
        },
      ],
    },
    packageEditCatalog
  );

  assert.equal(proposal.netPayableDelta, "0.000");
  assert.equal(proposal.grossDelta, "0.000");
  assert.equal(proposal.discountDelta, "0.000");
  assert.equal(proposal.deltas.length, 0);
  assert.equal(proposal.hasEdits, true);
});

test("operational workspace edits leave historical invoice lines untouched", async () => {
  const { computeWorkspaceProposal } = await import(
    "@/modules/adjustment-workspace/adjustment-workspace.service"
  );
  const baseWithHistoricalLine: AdjustmentBaseSnapshot = {
    ...packageEditBaseSnapshot,
    lines: [
      ...packageEditBaseSnapshot.lines,
      {
        lineId: "session-config:selection-theme",
        kind: "session_configuration",
        refId: "selection-theme",
        label: "Theme",
        quantity: 1,
        unitPrice: "12.000",
        lineTotalGross: "12.000",
        lineTotalNet: "12.000",
        taxBreakdown: [],
      },
    ],
    totals: {
      gross: "122.000",
      discount: "0.000",
      tax: "0.000",
      netPayable: "122.000",
    },
    sessionConfigurationSelections: [
      {
        id: "selection-theme",
        orderPackageId: "order-package-1",
        configurationId: "config-theme",
        optionId: null,
        numericValue: null,
        textValue: "Red",
        snapshotOptionLabel: null,
        snapshotConfigurationCode: "THEME",
        snapshotLabel: "Theme",
        snapshotPriceDelta: "12.000",
        snapshotFinancialBehavior: "FINANCIAL",
        snapshotInputType: "TEXT",
        snapshotPricingMode: "FIXED",
        snapshotLinkedProductId: null,
        orderAddOnId: null,
      },
    ],
  };

  const proposal = await computeWorkspaceProposal(
    baseWithHistoricalLine,
    {
      edits: [
        {
          id: "session-config",
          op: "change_session_configuration_selection",
          orderPackageId: "order-package-1",
          configurationId: "config-theme",
          desired: { kind: "text", textValue: "Blue" },
        },
      ],
    },
    packageEditCatalog
  );

  assert.equal(proposal.netPayableDelta, "0.000");
  assert.equal(proposal.deltas.length, 0);
  assert.equal(proposal.proposed.lines.length, baseWithHistoricalLine.lines.length);
  assert.equal(proposal.hasEdits, true);
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

test("package item upgrade uses staged tier package items after a tier change", async () => {
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
          id: "upgrade-premium-frame",
          op: "upgrade_package_item",
          orderPackageId: "order-package-1",
          packageItemId: "package-item-premium-frame",
          toProductId: "product-gallery-frame",
          quantity: 1,
        },
      ],
    },
    packageEditCatalog
  );

  const upgradedLine = proposal.proposed.lines.find(
    (line) => line.lineId === "item:order-package-1:package-item-premium-frame"
  );
  assert.equal(upgradedLine?.refId, "product-gallery-frame");
  assert.equal(upgradedLine?.label, "Premium Frame to Gallery Frame");
  assert.equal(upgradedLine?.unitPrice, "25.000");
});

test("package item upgrade sees staged tier edits later in the pending list", async () => {
  const { computeWorkspaceProposal } = await import(
    "@/modules/adjustment-workspace/adjustment-workspace.service"
  );
  const proposal = await computeWorkspaceProposal(
    packageEditBaseSnapshot,
    {
      edits: [
        {
          id: "upgrade-premium-frame",
          op: "upgrade_package_item",
          orderPackageId: "order-package-1",
          packageItemId: "package-item-premium-frame",
          toProductId: "product-gallery-frame",
          quantity: 1,
        },
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

  assert.equal(proposal.netPayableDelta, "75.000");
});

test("package item upgrade rejects items outside the persisted or staged tier", async () => {
  const { computeWorkspaceProposal } = await import(
    "@/modules/adjustment-workspace/adjustment-workspace.service"
  );
  await assert.rejects(
    computeWorkspaceProposal(
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
            id: "upgrade-unrelated-frame",
            op: "upgrade_package_item",
            orderPackageId: "order-package-1",
            packageItemId: "package-item-unrelated-frame",
            toProductId: "product-gallery-frame",
            quantity: 1,
          },
        ],
      },
      packageEditCatalog
    ),
    /Package item does not belong to the specified order package/
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
          packageItemId: "package-item-premium-frame",
          toProductId: "product-gallery-frame",
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
    proposal.proposed.lines.find((line) => line.refId === "product-gallery-frame")
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
