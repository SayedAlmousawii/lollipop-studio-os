import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Module from "node:module";
import test, { after } from "node:test";
import {
  AuditAction,
  InvoiceStatus,
  InvoiceType,
  OrderAlbumSourceType,
  OrderStatus,
  Prisma,
  SessionConfigurationFinancialBehavior,
  SessionConfigurationInputType,
  SessionConfigurationPricingMode,
  UserRole,
  type PrismaClient,
} from "@prisma/client";
import {
  ORDER_COMMIT_KIND,
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
  ORDER_COMMIT_STATUS,
} from "@/modules/order-commits/order-commit.constants";
import {
  ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND,
} from "@/modules/order-commits/order-commit-preview.constants";
import type { OrderCommitSnapshotV1 } from "@/modules/order-commits/order-commit.types";
import { EXTRA_ALBUM_PAGE_PRODUCT_ID } from "@/modules/albums/album.constants";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };
const originalModuleLoad = moduleWithLoader._load;
let activeHarness: ReturnType<typeof fakeExecutionHarness> | null = null;

moduleWithLoader._load = function loadWithOrderCommitTask6Shims(
  request,
  parent,
  isMain
) {
  if (request === "server-only") return {};
  if (request === "@/lib/db") return { db: {} };
  if (
    request === "@/modules/financial-cases" ||
    request === "@/modules/financial-cases/financial-case-summary.service"
  ) {
    return {
      getFinancialCaseSummary: async () => requiredHarness().financialSummary,
    };
  }
  if (request === "@/modules/invoices/invoice.service") {
    return invoiceServiceShim();
  }
  if (request === "@/modules/audit/audit-log.service") {
    return {
      recordAuditLog: async (
        _client: Prisma.TransactionClient,
        _actorContext: unknown,
        input: unknown
      ) => {
        requiredHarness().calls.sequence.push("audit");
        requiredHarness().calls.audit.push(input as Record<string, unknown>);
      },
    };
  }
  if (request === "@/modules/orders/order-activity.service") {
    return {
      recordOrderActivity: async (
        _client: Prisma.TransactionClient,
        input: unknown
      ) => {
        requiredHarness().calls.sequence.push("activity");
        requiredHarness().calls.activity.push(input as Record<string, unknown>);
      },
    };
  }
  if (request === "@/modules/financial/invariants") {
    return {
      assertFinancialCaseInvariants: async (financialCaseId: string) => {
        requiredHarness().calls.sequence.push("invariants");
        requiredHarness().calls.invariants.push(financialCaseId);
        if (requiredHarness().options.throwInvariant) {
          throw new Error("forced invariant failure");
        }
      },
    };
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};

after(() => {
  moduleWithLoader._load = originalModuleLoad;
});

const actorContext = {
  actorUserId: "staff-user",
  actorRole: UserRole.RECEPTIONIST,
};

test("commitOrderChanges rejects no-op drafts before writes", async () => {
  const harness = fakeExecutionHarness();
  activeHarness = harness;
  const { commitOrderChanges, OrderCommitNoOpCommitError } =
    await loadExecutionService();

  await assert.rejects(
    commitOrderChanges({
      orderId: "order-1",
      expectedDraftVersion: 2,
      actorContext,
      client: harness.client,
    }),
    OrderCommitNoOpCommitError
  );

  assert.deepEqual(harness.calls.transactionOptions, [
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  ]);
  assert.deepEqual(harness.calls.orderCommitCreates, []);
  assert.deepEqual(harness.calls.documentCreateMany, []);
  assert.deepEqual(harness.calls.audit, []);
  assert.deepEqual(harness.calls.activity, []);
  assert.deepEqual(harness.calls.invariants, []);
  assert.deepEqual(harness.calls.draftDeletes, []);
  assert.equal(harness.state.draftExists, true);
  assert.deepEqual(harness.state.commits, []);
  assert.equal(harness.calls.paymentsCreated, 0);
});

test("commitOrderChanges rejects delivered orders before writes", async () => {
  const harness = fakeExecutionHarness({
    orderStatus: OrderStatus.DELIVERED,
    pendingSnapshot: snapshot({
      catalogEntityId: "package-base",
      label: "Base package refreshed",
      unitPrice: 125,
    }),
  });
  activeHarness = harness;
  const { commitOrderChanges, OrderCommitDeliveredOrderError } =
    await loadExecutionService();

  await assert.rejects(
    commitOrderChanges({
      orderId: "order-1",
      expectedDraftVersion: 2,
      actorContext,
      client: harness.client,
    }),
    OrderCommitDeliveredOrderError
  );

  assert.deepEqual(harness.calls.orderCommitCreates, []);
  assert.deepEqual(harness.calls.documentCreateMany, []);
  assert.deepEqual(harness.calls.audit, []);
  assert.deepEqual(harness.calls.activity, []);
  assert.deepEqual(harness.calls.invariants, []);
  assert.deepEqual(harness.calls.draftDeletes, []);
  assert.equal(harness.state.invoiceTotal, 100);
  assert.equal(harness.state.draftExists, true);
});

test("commitOrderChanges persists materialized operational session configuration ids before snapshotJson", async () => {
  const harness = fakeExecutionHarness({
    finalInvoice: { id: "final-invoice-1", isLocked: false },
    initialInvoiceTotal: 100,
    pendingSnapshot: snapshot({
      catalogEntityId: "package-base",
      label: "Base package",
      unitPrice: 100,
      extraLines: [
        sessionConfigurationLine({
          selectionId: "draft:session-configuration-selection-operational",
          configurationId: "configuration-finish",
          financialBehavior: SessionConfigurationFinancialBehavior.OPERATIONAL,
          priceDelta: 0,
        }),
      ],
    }),
  });
  activeHarness = harness;
  const { commitOrderChanges } = await loadExecutionService();

  await commitOrderChanges({
    orderId: "order-1",
    expectedDraftVersion: 2,
    actorContext,
    client: harness.client,
  });

  const committedSnapshot = harness.calls.orderCommitCreates[0]?.data
    .snapshotJson as OrderCommitSnapshotV1;
  const selectionLine = committedSnapshot.lines.find(
    (line) => line.catalogEntityId === "configuration-finish"
  );
  assert.equal(selectionLine?.lineKind, ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION);
  assert.equal(selectionLine?.orderEntityId, "selection-1");
  assert.equal(selectionLine?.lineId, "session-config:selection-1");
  assert.equal(
    selectionLine?.stableKey,
    "session-configuration-selection:selection-1"
  );
});

test("commitOrderChanges persists materialized financial session configuration ids before snapshotJson", async () => {
  const harness = fakeExecutionHarness({
    pendingSnapshot: snapshot({
      catalogEntityId: "package-base",
      label: "Base package",
      unitPrice: 100,
      extraLines: [
        sessionConfigurationLine({
          selectionId: "draft:session-configuration-selection-financial",
          configurationId: "configuration-premium",
          financialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
          priceDelta: 0,
        }),
      ],
    }),
  });
  activeHarness = harness;
  const { commitOrderChanges } = await loadExecutionService();

  await commitOrderChanges({
    orderId: "order-1",
    expectedDraftVersion: 2,
    actorContext,
    client: harness.client,
  });

  const committedSnapshot = harness.calls.orderCommitCreates[0]?.data
    .snapshotJson as OrderCommitSnapshotV1;
  const selectionLine = committedSnapshot.lines.find(
    (line) => line.catalogEntityId === "configuration-premium"
  );
  assert.equal(selectionLine?.orderEntityId, "selection-1");
  assert.equal(selectionLine?.lineId, "session-config:selection-1");
  assert.equal(
    selectionLine?.stableKey,
    "session-configuration-selection:selection-1"
  );
});

test("commitOrderChanges persists linked-product session configuration ids before snapshotJson", async () => {
  const harness = fakeExecutionHarness({
    pendingSnapshot: snapshot({
      catalogEntityId: "package-base",
      label: "Base package",
      unitPrice: 100,
      extraLines: [
        sessionConfigurationLine({
          selectionId: "draft:session-configuration-selection-linked",
          configurationId: "configuration-album",
          financialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
          priceDelta: 0,
          pricingMode: SessionConfigurationPricingMode.LINKED_PRODUCT,
          linkedProductId: "product-album",
          draftOrderAddOnId: "draft:linked-product-add-on-album",
        }),
        linkedProductAddOnLine({
          selectionId: "draft:session-configuration-selection-linked",
          productId: "product-album",
          draftOrderAddOnId: "draft:linked-product-add-on-album",
          unitPrice: 0,
        }),
      ],
    }),
  });
  activeHarness = harness;
  const { commitOrderChanges } = await loadExecutionService();

  await commitOrderChanges({
    orderId: "order-1",
    expectedDraftVersion: 2,
    actorContext,
    client: harness.client,
  });

  const committedSnapshot = harness.calls.orderCommitCreates[0]?.data
    .snapshotJson as OrderCommitSnapshotV1;
  const selectionLine = committedSnapshot.lines.find(
    (line) => line.catalogEntityId === "configuration-album"
  );
  const linkedLine = committedSnapshot.lines.find(
    (line) =>
      line.lineKind ===
      ORDER_COMMIT_SNAPSHOT_LINE_KIND.LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON
  );
  assert.equal(selectionLine?.orderEntityId, "selection-1");
  assert.equal(selectionLine?.metadata.orderAddOnId, "addon-1");
  assert.equal("draftOrderAddOnId" in (selectionLine?.metadata ?? {}), false);
  assert.equal(linkedLine?.orderEntityId, "selection-1");
  assert.equal(linkedLine?.lineId, "session-config:selection-1:addon:addon-1");
  assert.equal(
    linkedLine?.stableKey,
    "session-configuration-selection:selection-1:add-on:addon-1"
  );
  assert.equal(linkedLine?.metadata.orderAddOnId, "addon-1");
  assert.equal("draftOrderAddOnId" in (linkedLine?.metadata ?? {}), false);
});

test("commitOrderChanges persists materialized order-level add-on ids before snapshotJson", async () => {
  const harness = fakeExecutionHarness({
    pendingSnapshot: snapshot({
      catalogEntityId: "package-base",
      label: "Base package",
      unitPrice: 100,
      extraLines: [
        addOnLine({
          addOnId: "draft:order-add-on-canvas",
          productId: "product-canvas",
          unitPrice: 0,
        }),
      ],
    }),
  });
  activeHarness = harness;
  const { commitOrderChanges } = await loadExecutionService();

  await commitOrderChanges({
    orderId: "order-1",
    expectedDraftVersion: 2,
    actorContext,
    client: harness.client,
  });

  const committedSnapshot = harness.calls.orderCommitCreates[0]?.data
    .snapshotJson as OrderCommitSnapshotV1;
  const committedAddOnLine = committedSnapshot.lines.find(
    (line) => line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON
  );
  assert.equal(committedAddOnLine?.orderEntityId, "addon-1");
  assert.equal(committedAddOnLine?.lineId, "addon:addon-1");
  assert.equal(committedAddOnLine?.stableKey, "order-add-on:addon-1");
  assert.equal(committedAddOnLine?.parentOrderPackageId, null);
  assert.equal("draftOrderAddOnId" in (committedAddOnLine?.metadata ?? {}), false);
  assert.doesNotMatch(JSON.stringify(committedSnapshot), /draft:order-add-on-canvas/);
});

test("commitOrderChanges syncs album backing ids and extra pages without failing missing draft ids", async () => {
  const harness = fakeExecutionHarness({
    pendingSnapshot: snapshot({
      catalogEntityId: "package-base",
      label: "Base package",
      unitPrice: 100,
      extraLines: [
        {
          ...addOnLine({
          addOnId: "draft:extra-pages",
          productId: EXTRA_ALBUM_PAGE_PRODUCT_ID,
          unitPrice: 0,
          quantity: 4,
          }),
          parentOrderPackageId: "order-package-1",
        },
      ],
    }),
    initialAlbums: [
      {
        id: "album-remap",
        sourceType: OrderAlbumSourceType.PACKAGE,
        orderPackageId: "order-package-1",
        backingLineId: "draft:extra-pages",
      },
      {
        id: "album-removed-line",
        sourceType: OrderAlbumSourceType.PACKAGE,
        orderPackageId: "order-package-1",
        backingLineId: "draft:removed-before-commit",
      },
    ],
  });
  activeHarness = harness;
  const { commitOrderChanges } = await loadExecutionService();

  await commitOrderChanges({
    orderId: "order-1",
    expectedDraftVersion: 2,
    actorContext,
    client: harness.client,
  });

  assert.equal(
    harness.state.albums.find((album) => album.id === "album-remap")
      ?.backingLineId,
    "addon-1"
  );
  assert.equal(
    harness.state.albums.find((album) => album.id === "album-remap")
      ?.extraPages,
    4
  );
  assert.equal(
    harness.state.albums.find((album) => album.id === "album-removed-line")
      ?.backingLineId,
    "draft:removed-before-commit"
  );
  assert.equal(
    harness.state.albums.find((album) => album.id === "album-removed-line")
      ?.extraPages,
    4
  );
  assert.equal(harness.calls.albumUpdates.length, 2);
});

test("commitOrderChanges persists materialized package-item-upgrade ids before snapshotJson", async () => {
  const harness = fakeExecutionHarness({
    finalInvoice: { id: "final-invoice-1", isLocked: false },
    initialInvoiceTotal: 100,
    pendingSnapshot: snapshot({
      catalogEntityId: "package-base",
      label: "Base package",
      unitPrice: 100,
      extraLines: [
        {
          ...packageItemUpgradeLine({
            upgradeId: "draft:package-item-upgrade-album",
            packageItemId: "package-item-album",
            label: "Basic Album to Premium Album",
            quantity: 1,
            unitPrice: 25,
          }),
          metadata: {
            packageItemId: "package-item-album",
            draftPackageItemUpgradeId: "draft:package-item-upgrade-album",
            notes: null,
          },
        },
      ],
    }),
  });
  activeHarness = harness;
  const { commitOrderChanges } = await loadExecutionService();

  await commitOrderChanges({
    orderId: "order-1",
    expectedDraftVersion: 2,
    actorContext,
    client: harness.client,
  });

  const committedSnapshot = harness.calls.orderCommitCreates[0]?.data
    .snapshotJson as OrderCommitSnapshotV1;
  const committedUpgradeLine = committedSnapshot.lines.find(
    (line) =>
      line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE
  );
  assert.equal(committedUpgradeLine?.orderEntityId, "upgrade-1");
  assert.equal(committedUpgradeLine?.lineId, "item-upgrade:upgrade-1");
  assert.equal(
    committedUpgradeLine?.stableKey,
    "order-package-item-upgrade:upgrade-1"
  );
  assert.equal(
    "draftPackageItemUpgradeId" in (committedUpgradeLine?.metadata ?? {}),
    false
  );
  assert.doesNotMatch(
    JSON.stringify(committedSnapshot),
    /draft:package-item-upgrade-album/
  );
});

test("commitOrderChanges rebuilds unlocked FINAL without document links", async () => {
  const harness = fakeExecutionHarness({
    finalInvoice: { id: "final-invoice-1", isLocked: false },
    pendingSnapshot: snapshot({
      catalogEntityId: "package-base",
      label: "Base package",
      unitPrice: 125,
    }),
  });
  activeHarness = harness;
  const { commitOrderChanges } = await loadExecutionService();

  await commitOrderChanges({
    orderId: "order-1",
    expectedDraftVersion: 2,
    actorContext,
    client: harness.client,
  });

  const createdCommit = harness.calls.orderCommitCreates[0]?.data;
  assert.equal(createdCommit?.kind, ORDER_COMMIT_KIND.BASELINE);
  assert.deepEqual(createdCommit?.metadataJson, {
    commitKind: "ADJUSTMENT_INVOICE",
    documentPlanKind: ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.FINAL_INVOICE_REBUILD,
    approvalActorUserId: null,
    netDelta: 25,
    finalInvoiceMode: "REBUILD_UNLOCKED",
    finalInvoiceId: "final-invoice-1",
    rebuiltInvoiceId: "final-invoice-1",
  });
  assert.deepEqual(harness.calls.documentCreateMany, []);
  assert.equal(harness.state.invoiceTotal, 125);
  const orderCommitAudit = harness.calls.audit.find(
    (entry) => entry.action === AuditAction.ORDER_COMMIT_CREATED
  );
  const auditAfter = orderCommitAudit?.after as Record<string, unknown>;
  const activityMetadata = harness.calls.activity[0]?.metadata as Record<
    string,
    unknown
  >;
  assert.equal(auditAfter.finalInvoiceMode, "REBUILD_UNLOCKED");
  assert.equal(
    activityMetadata.finalInvoiceMode,
    "REBUILD_UNLOCKED"
  );
});

test("draft identity allows version 1 commits from different draft sessions", async () => {
  const harness = fakeExecutionHarness({
    draftId: "draft-B",
    draftVersion: 1,
    pendingSnapshot: snapshot({
      catalogEntityId: "package-base",
      label: "Base package refreshed",
      unitPrice: 100,
    }),
    initialCommits: [
      {
        id: "order-commit-A",
        orderId: "order-1",
        sequence: 1,
        committedFromDraftId: "draft-A",
        committedFromDraftVersion: 1,
      },
    ],
  });
  activeHarness = harness;
  const { commitOrderChanges } = await loadExecutionService();

  await commitOrderChanges({
    orderId: "order-1",
    expectedDraftVersion: 1,
    actorContext,
    client: harness.client,
  });

  const createdCommit = harness.calls.orderCommitCreates[0]?.data;
  assert.equal(createdCommit?.previousCommitId, "order-commit-A");
  assert.equal(createdCommit?.sequence, 2);
  assert.equal(createdCommit?.committedFromDraftId, "draft-B");
  assert.equal(createdCommit?.committedFromDraftVersion, 1);
  assert.deepEqual(harness.calls.draftDeletes, [{ id: "draft-B" }]);
});

test("double-submit of the same draft id is rejected cleanly", async () => {
  const harness = fakeExecutionHarness({
    draftId: "draft-A",
    draftVersion: 1,
    pendingSnapshot: snapshot({
      catalogEntityId: "package-base",
      label: "Base package refreshed",
      unitPrice: 100,
    }),
    initialCommits: [
      {
        id: "order-commit-A",
        orderId: "order-1",
        sequence: 1,
        committedFromDraftId: "draft-A",
        committedFromDraftVersion: 1,
      },
    ],
  });
  activeHarness = harness;
  const { commitOrderChanges, OrderCommitConcurrentCommitError } =
    await loadExecutionService();

  await assert.rejects(
    commitOrderChanges({
      orderId: "order-1",
      expectedDraftVersion: 1,
      actorContext,
      client: harness.client,
    }),
    OrderCommitConcurrentCommitError
  );
  assert.equal(harness.calls.transactionOptions.length, 1);
  assert.deepEqual(harness.calls.draftDeletes, []);
});

test("repeated unlocked FINAL rebuild works across version 1 draft sessions", async () => {
  const harness = fakeExecutionHarness({
    draftId: "draft-B",
    draftVersion: 1,
    finalInvoice: { id: "final-invoice-1", isLocked: false },
    initialInvoiceTotal: 100,
    pendingSnapshot: snapshot({
      catalogEntityId: "package-base",
      label: "Base package",
      unitPrice: 125,
    }),
    initialCommits: [
      {
        id: "order-commit-A",
        orderId: "order-1",
        sequence: 1,
        committedFromDraftId: "draft-A",
        committedFromDraftVersion: 1,
      },
    ],
  });
  activeHarness = harness;
  const { commitOrderChanges } = await loadExecutionService();

  await commitOrderChanges({
    orderId: "order-1",
    expectedDraftVersion: 1,
    actorContext,
    client: harness.client,
  });

  const createdCommit = harness.calls.orderCommitCreates[0]?.data;
  assert.equal(createdCommit?.sequence, 2);
  assert.equal(createdCommit?.committedFromDraftId, "draft-B");
  assert.equal(createdCommit?.committedFromDraftVersion, 1);
  assert.equal(createdCommit?.kind, ORDER_COMMIT_KIND.BASELINE);
  assert.deepEqual(createdCommit?.metadataJson, {
    commitKind: "ADJUSTMENT_INVOICE",
    documentPlanKind: ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.FINAL_INVOICE_REBUILD,
    approvalActorUserId: null,
    netDelta: 25,
    finalInvoiceMode: "REBUILD_UNLOCKED",
    finalInvoiceId: "final-invoice-1",
    rebuiltInvoiceId: "final-invoice-1",
  });
  assert.deepEqual(harness.calls.documentCreateMany, []);
  assert.equal(harness.state.invoiceTotal, 125);
});

test("commitOrderChanges keeps a re-upgraded package item delta charged once", async () => {
  const committedSnapshot = snapshot({
    catalogEntityId: "package-base",
    label: "Base package",
    unitPrice: 100,
    extraLines: [
      packageItemUpgradeLine({
        upgradeId: "upgrade-album",
        packageItemId: "package-item-album",
        label: "Basic Album to Premium Album",
        quantity: 1,
        unitPrice: 25,
      }),
    ],
  });
  const pendingSnapshot = snapshot({
    catalogEntityId: "package-base",
    label: "Base package",
    unitPrice: 100,
    extraLines: [
      packageItemUpgradeLine({
        upgradeId: "upgrade-album",
        packageItemId: "package-item-album",
        label: "Basic Album to Premium Album Refreshed",
        quantity: 1,
        unitPrice: 25,
      }),
    ],
  });
  const harness = fakeExecutionHarness({
    draftId: "draft-reupgrade",
    draftVersion: 1,
    finalInvoice: { id: "final-invoice-1", isLocked: false },
    initialInvoiceTotal: 125,
    pendingSnapshot,
    currentItemUpgrades: [
      {
        id: "upgrade-album",
        orderId: "order-1",
        orderPackageId: "order-package-1",
        packageItemId: "package-item-album",
        nameSnapshot: "Basic Album to Premium Album",
        priceSnapshot: new Prisma.Decimal(25),
        quantity: 1,
        notes: null,
      },
    ],
    initialCommits: [
      {
        id: "order-commit-A",
        orderId: "order-1",
        sequence: 1,
        snapshotJson: committedSnapshot,
        committedFromDraftId: "draft-A",
        committedFromDraftVersion: 1,
      },
    ],
  });
  activeHarness = harness;
  const { commitOrderChanges } = await loadExecutionService();

  await commitOrderChanges({
    orderId: "order-1",
    expectedDraftVersion: 1,
    actorContext,
    client: harness.client,
  });

  const createdCommit = harness.calls.orderCommitCreates[0]?.data;
  const committed = createdCommit?.snapshotJson as OrderCommitSnapshotV1;
  const upgradeLine = committed.lines.find(
    (line) => line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE
  );
  assert.equal(upgradeLine?.orderEntityId, "upgrade-album");
  assert.equal(upgradeLine?.quantity, 1);
  assert.equal(upgradeLine?.unitPrice, 25);
  assert.equal(upgradeLine?.lineTotal, 25);
  assert.equal(committed.totals.netTotal, 125);
  assert.equal(harness.state.invoiceTotal, 125);
  assert.equal((createdCommit?.metadataJson as { netDelta?: number }).netDelta, 0);
});

test("post-rebuild invariant failure rolls back invoice and preserves draft", async () => {
  const harness = fakeExecutionHarness({
    finalInvoice: { id: "final-invoice-1", isLocked: false },
    initialInvoiceTotal: 100,
    throwInvariant: true,
    pendingSnapshot: snapshot({
      catalogEntityId: "package-base",
      label: "Base package",
      unitPrice: 125,
    }),
  });
  activeHarness = harness;
  const { commitOrderChanges } = await loadExecutionService();

  await assert.rejects(
    commitOrderChanges({
      orderId: "order-1",
      expectedDraftVersion: 2,
      actorContext,
      client: harness.client,
    }),
    /forced invariant failure/
  );

  assert.equal(harness.state.invoiceTotal, 100);
  assert.equal(harness.state.draftExists, true);
  assert.deepEqual(harness.state.documents, []);
  assert.deepEqual(harness.state.commits, []);
  assert.deepEqual(harness.calls.draftDeletes, []);
});

test("commitOrderChanges rejects stale draft versions before writes", async () => {
  const harness = fakeExecutionHarness({ draftVersion: 3 });
  activeHarness = harness;
  const { commitOrderChanges, OrderCommitStaleDraftError } =
    await loadExecutionService();

  await assert.rejects(
    commitOrderChanges({
      orderId: "order-1",
      expectedDraftVersion: 2,
      actorContext,
      client: harness.client,
    }),
    OrderCommitStaleDraftError
  );
  assert.deepEqual(harness.calls.orderCommitCreates, []);
  assert.deepEqual(harness.calls.documentCreateMany, []);
  assert.deepEqual(harness.calls.draftDeletes, []);
});

test("commitOrderChanges rejects non-owner non-manager commits before writes", async () => {
  const harness = fakeExecutionHarness({ draftOwnerUserId: "draft-owner" });
  harness.pendingSnapshot.lines[0] = {
    ...harness.pendingSnapshot.lines[0],
    label: "Base package refreshed",
  };
  activeHarness = harness;
  const { commitOrderChanges } = await loadExecutionService();
  const { OrderCommitDraftPermissionError } = await import(
    "@/modules/order-commits/order-commit-draft.errors"
  );

  await assert.rejects(
    commitOrderChanges({
      orderId: "order-1",
      expectedDraftVersion: 2,
      actorContext: {
        actorUserId: "other-user",
        actorRole: UserRole.RECEPTIONIST,
      },
      client: harness.client,
    }),
    OrderCommitDraftPermissionError
  );
  assert.deepEqual(harness.calls.sequence, []);
  assert.deepEqual(harness.calls.orderCommitCreates, []);
  assert.deepEqual(harness.calls.documentCreateMany, []);
  assert.deepEqual(harness.calls.audit, []);
  assert.deepEqual(harness.calls.activity, []);
  assert.deepEqual(harness.calls.draftDeletes, []);
  assert.equal(harness.state.draftExists, true);
});

test("commitOrderChanges manager override does not transfer draft ownership", async () => {
  const harness = fakeExecutionHarness({
    draftOwnerUserId: "draft-owner",
    pendingSnapshot: snapshot({
      catalogEntityId: "package-base",
      label: "Base package refreshed",
      unitPrice: 100,
    }),
  });
  activeHarness = harness;
  const { commitOrderChanges } = await loadExecutionService();

  await commitOrderChanges({
    orderId: "order-1",
    expectedDraftVersion: 2,
    actorContext: {
      actorUserId: "manager-user",
      actorRole: UserRole.MANAGER,
    },
    client: harness.client,
  });

  assert.equal(harness.calls.draftUpdates.length, 0);
  assert.equal(harness.calls.orderCommitCreates.length, 1);
  assert.equal(
    harness.calls.orderCommitCreates[0]?.data.committedByUserId,
    "manager-user"
  );
});

test("Prisma adapter draft-id conflicts surface as concurrent commit errors without retry", async () => {
  const harness = fakeExecutionHarness({
    throwConcurrentOnCommit: "draftIdAdapter",
    pendingSnapshot: snapshot({
      catalogEntityId: "package-base",
      label: "Base package refreshed",
      unitPrice: 100,
    }),
  });
  activeHarness = harness;
  const { commitOrderChanges, OrderCommitConcurrentCommitError } =
    await loadExecutionService();

  await assert.rejects(
    commitOrderChanges({
      orderId: "order-1",
      expectedDraftVersion: 2,
      actorContext,
      client: harness.client,
    }),
    OrderCommitConcurrentCommitError
  );
  assert.equal(harness.calls.transactionOptions.length, 1);
  assert.deepEqual(harness.calls.draftDeletes, []);
});

test("legacy draft-version conflicts still surface as concurrent commit errors", async () => {
  const harness = fakeExecutionHarness({
    throwConcurrentOnCommit: "draftVersionTarget",
    pendingSnapshot: snapshot({
      catalogEntityId: "package-base",
      label: "Base package refreshed",
      unitPrice: 100,
    }),
  });
  activeHarness = harness;
  const { commitOrderChanges, OrderCommitConcurrentCommitError } =
    await loadExecutionService();

  await assert.rejects(
    commitOrderChanges({
      orderId: "order-1",
      expectedDraftVersion: 2,
      actorContext,
      client: harness.client,
    }),
    OrderCommitConcurrentCommitError
  );
  assert.equal(harness.calls.transactionOptions.length, 1);
  assert.deepEqual(harness.calls.draftDeletes, []);
});

test("commitOrderChanges source stays Task 6 scoped", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "src/modules/order-commits/order-commit-execution.service.ts"
    ),
    "utf8"
  );

  assert.match(source, /commitOrderChanges/);
  assert.match(source, /materializeOrderCommitDraftIntoOrderRows/);
  assert.match(source, /emitOrderCommitFinancialDocuments/);
  assert.match(source, /createOrderCommitDocumentLinks/);
  assert.doesNotMatch(source, /pendingOpsJson/);
  assert.doesNotMatch(source, /payment\.create|issueRefundWithPayment/);
  assert.doesNotMatch(source, /adjustment-workspace|AdjustmentWorkspace/);
  assert.doesNotMatch(source, /app\/orders|src\/components/);
});

test("OrderCommit FINAL residual credits pass removal origin", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "src/modules/order-commits/order-commit-execution.service.ts"
    ),
    "utf8"
  );

  assert.match(
    source,
    /notes: "OrderCommit final credit note emission",\s+applicationMode: "UNAPPLIED",\s+creditOrigin: CreditOrigin\.REMOVAL,/s
  );
});

async function loadExecutionService() {
  return import("@/modules/order-commits/order-commit-execution.service");
}

function requiredHarness(): ReturnType<typeof fakeExecutionHarness> {
  assert.ok(activeHarness, "Expected an active test harness.");
  return activeHarness;
}

function invoiceServiceShim() {
  return {
    buildOpenAdjustmentLineMap: async () => new Map(),
    computeCreditNoteCapacityForFinal: async () => new Prisma.Decimal(999),
    createAdjustmentInvoiceWithClient: async () => ({ id: "adjustment-invoice-1" }),
    createCreditNoteWithClient: async () => ({ id: "credit-note-1" }),
    createInvoiceForOrderWithClient: async () => {
      requiredHarness().calls.sequence.push("base-invoice");
      return { id: "base-invoice-1", status: InvoiceStatus.DRAFT };
    },
    findPrimaryWorkflowInvoiceForOrder: async () =>
      requiredHarness().options.finalInvoice
        ? {
            ...requiredHarness().options.finalInvoice,
            status: InvoiceStatus.DRAFT,
          }
        : null,
    rebuildUnlockedFinalInvoiceForOrderWithClient: async (
      _client: Prisma.TransactionClient,
      input: { orderId: string; finalInvoiceId: string }
    ) => {
      requiredHarness().calls.sequence.push("rebuild-unlocked-final");
      requiredHarness().calls.rebuildUnlockedFinal.push(input);
      requiredHarness().state.invoiceTotal =
        requiredHarness().pendingSnapshot.totals.netTotal;
      return { id: input.finalInvoiceId, status: InvoiceStatus.DRAFT };
    },
  };
}

function fakeExecutionHarness(input?: {
  draftId?: string;
  draftVersion?: number;
  draftOwnerUserId?: string;
  finalInvoice?: { id: string; isLocked: boolean };
  orderStatus?: OrderStatus;
  initialInvoiceTotal?: number;
  pendingSnapshot?: OrderCommitSnapshotV1;
  initialCommits?: Array<Record<string, unknown>>;
  initialAlbums?: Array<{
    id: string;
    sourceType: OrderAlbumSourceType;
    orderPackageId: string | null;
    backingLineId: string;
  }>;
  currentItemUpgrades?: Array<{
    id: string;
    orderId: string;
    orderPackageId: string;
    packageItemId: string;
    nameSnapshot: string;
    priceSnapshot: Prisma.Decimal;
    quantity: number;
    notes: string | null;
  }>;
  throwInvariant?: boolean;
  throwConcurrentOnCommit?: "draftIdAdapter" | "draftVersionTarget";
}) {
  const pendingSnapshot =
    input?.pendingSnapshot ??
    snapshot({
      catalogEntityId: "package-base",
      label: "Base package",
      unitPrice: 100,
    });
  const options = {
    finalInvoice: input?.finalInvoice ?? null,
    throwInvariant: input?.throwInvariant ?? false,
  };
  const state = {
    invoiceTotal: input?.initialInvoiceTotal ?? 100,
    draftExists: true,
    documents: [] as Array<{
      id: string;
      orderCommitId: string;
      invoiceId: string;
      role: string;
      createdAt: Date;
    }>,
    commits: (input?.initialCommits ?? []).map((commit) =>
      fakeCommittedOrderCommitRow(commit)
    ) as Array<Record<string, unknown>>,
    albums: (input?.initialAlbums ?? []).map((album) => ({
      ...album,
      extraPages: 0,
    })),
  };
  const calls = {
    transactionOptions: [] as unknown[],
    sequence: [] as string[],
    orderCommitCreates: [] as Array<{ data: Record<string, unknown> }>,
    documentCreateMany: [] as Array<{ data: unknown[] }>,
    draftUpdates: [] as unknown[],
    draftDeletes: [] as unknown[],
    rebuildUnlockedFinal: [] as Array<{ orderId: string; finalInvoiceId: string }>,
    audit: [] as Array<Record<string, unknown>>,
    activity: [] as Array<Record<string, unknown>>,
    invariants: [] as string[],
    albumUpdates: [] as Array<{ id: string; data: Record<string, unknown> }>,
    paymentsCreated: 0,
  };
  const currentPackage = {
    id: "order-package-1",
    orderId: "order-1",
    originalPackageId: "package-base",
    currentPackageId: "package-base",
    bookingPackageId: "booking-package-1",
    sessionTypeId: "session-type-1",
    originalPackageNameSnapshot: "Base package",
    currentPackageNameSnapshot: "Base package",
    originalPackagePriceSnapshot: new Prisma.Decimal(100),
    finalPackagePriceSnapshot: new Prisma.Decimal(100),
    selectedPhotoCount: 10,
    extraDigitalCount: 0,
    extraPrintCount: 0,
    sortOrder: 0,
    createdAt: new Date("2026-06-02T00:00:00.000Z"),
    originalPackage: { photoCount: 10 },
    sessionType: { id: "session-type-1", name: "Portrait" },
    sessionConfigurationSelections: [],
  };
  const order = {
    id: "order-1",
    status: input?.orderStatus ?? OrderStatus.ACTIVE,
    bookingId: "booking-1",
    jobId: "job-1",
    jobNumber: "JOB-1",
    selectedPhotoCount: 10,
    customer: { id: "customer-1" },
    booking: { financialCase: { id: "financial-case-1" } },
    packages: [currentPackage],
    orderAddOns: [],
    packageItemUpgrades: [],
  };
  let invariantMarked = false;
  const markInvariantRead = () => {
    if (invariantMarked) return;
    invariantMarked = true;
    calls.sequence.push("invariants");
    calls.invariants.push("financial-case-1");
  };

  const transaction = {
    $queryRaw: async () => [],
    order: {
      findUnique: async () => order,
      update: async () => ({ id: "order-1" }),
    },
    orderPackage: {
      findMany: async () => [currentPackage],
      findUnique: async () => currentPackage,
      update: async (args: { data?: { finalPackagePriceSnapshot?: Prisma.Decimal } }) => {
        if (args.data?.finalPackagePriceSnapshot) {
          currentPackage.finalPackagePriceSnapshot =
            args.data.finalPackagePriceSnapshot;
        }
        return { id: "order-package-1" };
      },
    },
    orderAddOn: {
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({ id: "addon-1" }),
      update: async () => ({ id: "addon-1" }),
      findFirst: async () => null,
    },
    orderPackageItemUpgrade: {
      findMany: async () => input?.currentItemUpgrades ?? [],
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({ id: "upgrade-1" }),
      update: async () => ({ id: "upgrade-1" }),
      findFirst: async () => null,
    },
    orderPackageSessionConfigurationSelection: {
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({ id: "selection-1" }),
      update: async () => ({ id: "selection-1" }),
    },
    orderAlbum: {
      findMany: async () => state.albums,
      update: async (args: {
        where: { id: string };
        data: { backingLineId?: string; extraPages?: number };
      }) => {
        calls.albumUpdates.push({ id: args.where.id, data: args.data });
        const album = state.albums.find((row) => row.id === args.where.id);
        if (album) {
          album.backingLineId = args.data.backingLineId ?? album.backingLineId;
          album.extraPages = args.data.extraPages ?? album.extraPages;
        }
        return { id: args.where.id };
      },
      deleteMany: async () => ({ count: 0 }),
    },
    orderCommitDraft: {
      findUnique: async () => ({
        id: input?.draftId ?? "draft-1",
        orderId: "order-1",
        financialCaseId: "financial-case-1",
        pendingSnapshotJson: pendingSnapshot,
        version: input?.draftVersion ?? 2,
        ownerUserId: input?.draftOwnerUserId ?? actorContext.actorUserId,
      }),
      update: async (args: unknown) => {
        calls.draftUpdates.push(args);
        return { id: input?.draftId ?? "draft-1" };
      },
      updateMany: async (args: unknown) => {
        calls.draftUpdates.push(args);
        return { count: 1 };
      },
      delete: async (args: unknown) => {
        calls.sequence.push("draft.delete");
        calls.draftDeletes.push((args as { where: unknown }).where);
        state.draftExists = false;
        return { id: input?.draftId ?? "draft-1" };
      },
    },
    orderCommit: {
      findFirst: async (args?: { select?: Record<string, unknown> }) => {
        const latest = latestCommitRow(state.commits);
        if (!latest) return null;
        if (args?.select?.snapshotJson) return latest;
        return {
          id: latest.id,
          sequence: latest.sequence,
        };
      },
      create: async (args: { data: Record<string, unknown> }) => {
        calls.sequence.push("orderCommit.create");
        calls.orderCommitCreates.push(args);
        if (input?.throwConcurrentOnCommit === "draftVersionTarget") {
          throw new Prisma.PrismaClientKnownRequestError(
            "Unique constraint failed on committedFromDraftVersion",
            {
              code: "P2002",
              clientVersion: "test",
              meta: {
                target: ["orderId", "committedFromDraftVersion"],
              },
            }
          );
        }
        if (input?.throwConcurrentOnCommit === "draftIdAdapter") {
          throw new Prisma.PrismaClientKnownRequestError(
            'Unique constraint failed on the fields: ("orderId", "committedFromDraftId")',
            {
              code: "P2002",
              clientVersion: "test",
              meta: {
                modelName: "OrderCommit",
                driverAdapterError: new Error("UniqueConstraintViolation"),
              },
            }
          );
        }
        if (
          args.data.committedFromDraftId &&
          state.commits.some(
            (commit) =>
              commit.orderId === args.data.orderId &&
              commit.committedFromDraftId === args.data.committedFromDraftId
          )
        ) {
          throw new Prisma.PrismaClientKnownRequestError(
            'Unique constraint failed on the fields: ("orderId", "committedFromDraftId")',
            {
              code: "P2002",
              clientVersion: "test",
              meta: {
                modelName: "OrderCommit",
                driverAdapterError: new Error("UniqueConstraintViolation"),
              },
            }
          );
        }
        state.commits.push({
          id: `order-commit-${state.commits.length + 1}`,
          ...args.data,
        });
        return {
          id: `order-commit-${state.commits.length}`,
          sequence: args.data.sequence as number,
          kind: args.data.kind as string,
        };
      },
    },
    orderCommitDocument: {
      createMany: async (args: { data: Array<Record<string, string>> }) => {
        calls.sequence.push("document.createMany");
        calls.documentCreateMany.push(args);
        state.documents.push(
          ...args.data.map((row, index) => ({
            id: `document-link-${index + 1}`,
            orderCommitId: row.orderCommitId,
            invoiceId: row.invoiceId,
            role: row.role,
            createdAt: new Date("2026-06-02T00:00:00.000Z"),
          }))
        );
        return { count: args.data.length };
      },
      findMany: async () => state.documents,
    },
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        calls.sequence.push("audit");
        calls.audit.push(args.data);
        return { id: "audit-1" };
      },
    },
    orderActivity: {
      create: async (args: { data: Record<string, unknown> }) => {
        calls.sequence.push("activity");
        calls.activity.push(args.data);
        return { id: "activity-1" };
      },
      findFirst: async () => null,
    },
    user: {
      findUnique: async () => ({ id: "manager-user", role: UserRole.MANAGER }),
    },
    sessionConfiguration: {
      findMany: async () => [],
    },
    invoice: {
      findMany: async () =>
        options.finalInvoice
          ? [
              {
                id: options.finalInvoice.id,
                invoiceType: InvoiceType.FINAL,
                totalAmount: new Prisma.Decimal(state.invoiceTotal),
                remainingAmount: new Prisma.Decimal(state.invoiceTotal),
                status: InvoiceStatus.DRAFT,
                isLocked: options.finalInvoice.isLocked,
                documentApplicationsAsTarget: [],
              },
            ]
          : [],
      findUnique: async () =>
        options.finalInvoice
          ? {
              id: options.finalInvoice.id,
              financialCaseId: "financial-case-1",
              orderId: "order-1",
              bookingId: "booking-1",
              invoiceType: "FINAL",
              invoiceNumber: "INV-1",
              totalAmount: new Prisma.Decimal(state.invoiceTotal),
              paidAmount: new Prisma.Decimal(0),
              remainingAmount: new Prisma.Decimal(state.invoiceTotal),
              status: InvoiceStatus.DRAFT,
              isLocked: options.finalInvoice.isLocked,
              payments: [],
              _count: { lineItems: state.documents.length },
            }
          : null,
      findUniqueOrThrow: async () => {
        if (!options.finalInvoice) throw new Error("Invoice not found");
        return { id: options.finalInvoice.id, status: InvoiceStatus.DRAFT };
      },
      updateMany: async (args: { data: { totalAmount: Prisma.Decimal } }) => {
        if (options.finalInvoice?.isLocked) return { count: 0 };
        state.invoiceTotal = Number(args.data.totalAmount);
        return { count: 1 };
      },
      update: async (args: {
        data: {
          paidAmount?: Prisma.Decimal;
          remainingAmount?: Prisma.Decimal;
          status?: InvoiceStatus;
        };
      }) => {
        if (args.data.remainingAmount) {
          state.invoiceTotal = Number(args.data.remainingAmount);
        }
        return { id: options.finalInvoice?.id ?? "invoice-1" };
      },
    },
    invoiceLineItem: {
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 }),
    },
    financialCase: {
      findUnique: async () => ({
        id: "financial-case-1",
        bookingId: "booking-1",
        jobId: "job-1",
        booking: {
          id: "booking-1",
          jobId: "job-1",
          order: { id: "order-1" },
        },
        invoices: [],
      }),
      findMany: async () => [],
    },
    documentApplication: {
      findMany: async () => [],
      aggregate: async () => ({
        _sum: { amountApplied: new Prisma.Decimal(0) },
      }),
    },
    paymentAllocation: {
      aggregate: async () => ({
        _sum: { amount: new Prisma.Decimal(0) },
      }),
    },
    payment: {
      findMany: async () => {
        markInvariantRead();
        if (options.throwInvariant) {
          throw new Error("forced invariant failure");
        }
        return [];
      },
      create: async () => {
        calls.paymentsCreated += 1;
        return { id: "payment-1" };
      },
    },
  };

  const client = {
    $transaction: async (
      fn: (tx: typeof transaction) => Promise<unknown>,
      options: unknown
    ) => {
      calls.transactionOptions.push(options);
      const snapshotState = {
        invoiceTotal: state.invoiceTotal,
        draftExists: state.draftExists,
        documents: [...state.documents],
        commits: [...state.commits],
      };
      try {
        return await fn(transaction);
      } catch (error) {
        state.invoiceTotal = snapshotState.invoiceTotal;
        state.draftExists = snapshotState.draftExists;
        state.documents = snapshotState.documents;
        state.commits = snapshotState.commits;
        throw error;
      }
    },
  } as unknown as PrismaClient;

  return {
    calls,
    client,
    options,
    state,
    financialSummary: {
      stage: "booking",
      financialCaseId: "financial-case-1",
      bookingId: "booking-1",
      depositInvoice: null,
      depositPaid: false,
      awaitingFinalInvoiceAfterCheckIn: true,
      finalInvoicePending: true,
      linkedDocuments: [],
    },
    pendingSnapshot,
  };
}

function latestCommitRow(commits: Array<Record<string, unknown>>) {
  return [...commits].sort(
    (left, right) => Number(right.sequence ?? 0) - Number(left.sequence ?? 0)
  )[0];
}

function fakeCommittedOrderCommitRow(
  overrides: Record<string, unknown>
): Record<string, unknown> {
  return {
    id: "order-commit-existing",
    orderId: "order-1",
    financialCaseId: "financial-case-1",
    previousCommitId: null,
    sequence: 1,
    kind: ORDER_COMMIT_KIND.BASELINE,
    status: ORDER_COMMIT_STATUS.COMMITTED,
    snapshotVersion: 1,
    snapshotJson: snapshot({
      catalogEntityId: "package-base",
      label: "Base package",
      unitPrice: 100,
    }),
    metadataJson: {},
    committedAt: new Date("2026-06-02T00:00:00.000Z"),
    committedByUserId: "staff-user",
    committedFromDraftId: "draft-existing",
    committedFromDraftVersion: 1,
    ...overrides,
  };
}

function snapshot(input: {
  catalogEntityId: string;
  label: string;
  unitPrice: number;
  extraLines?: OrderCommitSnapshotV1["lines"];
}): OrderCommitSnapshotV1 {
  const packageLine = {
    lineId: "package:order-package-1",
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE,
    orderEntityId: "order-package-1",
    parentOrderPackageId: null,
    catalogEntityId: input.catalogEntityId,
    stableKey: "order-package:order-package-1",
    label: input.label,
    quantity: 1,
    unitPrice: input.unitPrice,
    lineTotal: input.unitPrice,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      originalPackageId: "package-base",
      originalPackageNameSnapshot: "Base package",
      originalPackagePriceSnapshot: 100,
      bookingPackageId: "booking-package-1",
      selectedPhotoCount: 10,
      includedPhotoCount: 10,
      extraDigitalCount: 0,
      extraPrintCount: 0,
      sessionTypeId: "session-type-1",
      sessionTypeName: "Portrait",
      sortOrder: 0,
    },
  } satisfies OrderCommitSnapshotV1["lines"][number];
  const lines = [packageLine, ...(input.extraLines ?? [])];
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  return {
    schemaVersion: "order_commit_snapshot_v1",
    orderId: "order-1",
    financialCaseId: "financial-case-1",
    capturedAt: "2026-06-02T00:00:00.000Z",
    currency: "KWD",
    lines,
    totals: {
      subtotal,
      discountTotal: 0,
      netTotal: subtotal,
    },
  };
}

function sessionConfigurationLine(input: {
  selectionId: string;
  configurationId: string;
  financialBehavior: SessionConfigurationFinancialBehavior;
  priceDelta: number;
  pricingMode?: SessionConfigurationPricingMode;
  linkedProductId?: string | null;
  orderAddOnId?: string | null;
  draftOrderAddOnId?: string | null;
}): OrderCommitSnapshotV1["lines"][number] {
  return {
    lineId: `session-config:${input.selectionId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND
        .ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
    orderEntityId: input.selectionId,
    parentOrderPackageId: "order-package-1",
    catalogEntityId: input.configurationId,
    stableKey: `session-configuration-selection:${input.selectionId}`,
    label: "Session configuration",
    quantity: 1,
    unitPrice: input.priceDelta,
    lineTotal: input.priceDelta,
    priceSource:
      ORDER_COMMIT_PRICE_SOURCE.SESSION_CONFIGURATION_SELECTION_SNAPSHOT,
    metadata: {
      configurationId: input.configurationId,
      optionId: null,
      numericValue: null,
      textValue: null,
      orderAddOnId: input.orderAddOnId ?? null,
      ...(input.draftOrderAddOnId
        ? { draftOrderAddOnId: input.draftOrderAddOnId }
        : {}),
      snapshotConfigurationCode: input.configurationId.toUpperCase(),
      snapshotFinancialBehavior: input.financialBehavior,
      snapshotInputType: SessionConfigurationInputType.TOGGLE,
      snapshotLabel: "Session configuration",
      snapshotLinkedProductId: input.linkedProductId ?? null,
      snapshotOptionLabel: null,
      snapshotPriceDelta: input.priceDelta,
      snapshotPricingMode:
        input.pricingMode ?? SessionConfigurationPricingMode.FIXED,
    },
  };
}

function addOnLine(input: {
  addOnId: string;
  productId: string;
  unitPrice?: number;
  quantity?: number;
}): OrderCommitSnapshotV1["lines"][number] {
  const unitPrice = input.unitPrice ?? 20;
  const quantity = input.quantity ?? 1;
  return {
    lineId: `addon:${input.addOnId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_ADD_ON,
    orderEntityId: input.addOnId,
    parentOrderPackageId: null,
    catalogEntityId: input.productId,
    stableKey: `order-add-on:${input.addOnId}`,
    label: "Canvas",
    quantity,
    unitPrice,
    lineTotal: Number((unitPrice * quantity).toFixed(3)),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      draftOrderAddOnId: input.addOnId,
      productId: input.productId,
    },
  };
}

function packageItemUpgradeLine(input: {
  upgradeId: string;
  packageItemId: string;
  label: string;
  quantity: number;
  unitPrice: number;
}): OrderCommitSnapshotV1["lines"][number] {
  return {
    lineId: `item-upgrade:${input.upgradeId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_ITEM_UPGRADE,
    orderEntityId: input.upgradeId,
    parentOrderPackageId: "order-package-1",
    catalogEntityId: input.packageItemId,
    stableKey: `order-package-item-upgrade:${input.upgradeId}`,
    label: input.label,
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    lineTotal: Number((input.unitPrice * input.quantity).toFixed(3)),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      packageItemId: input.packageItemId,
      notes: null,
    },
  };
}

function linkedProductAddOnLine(input: {
  selectionId: string;
  productId: string;
  orderAddOnId?: string | null;
  draftOrderAddOnId?: string | null;
  unitPrice?: number;
}): OrderCommitSnapshotV1["lines"][number] {
  const addOnRef = input.orderAddOnId ?? input.draftOrderAddOnId;
  assert.ok(addOnRef);
  const unitPrice = input.unitPrice ?? 25;
  return {
    lineId: `session-config:${input.selectionId}:addon:${addOnRef}`,
    lineKind:
      ORDER_COMMIT_SNAPSHOT_LINE_KIND
        .LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND
        .ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
    orderEntityId: input.selectionId,
    parentOrderPackageId: "order-package-1",
    catalogEntityId: input.productId,
    stableKey: `session-configuration-selection:${input.selectionId}:add-on:${addOnRef}`,
    label: "Linked album",
    quantity: 1,
    unitPrice,
    lineTotal: unitPrice,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      configurationId: "configuration-album",
      orderAddOnId: input.orderAddOnId ?? null,
      ...(input.draftOrderAddOnId
        ? { draftOrderAddOnId: input.draftOrderAddOnId }
        : {}),
      productId: input.productId,
      addOnNotes: null,
      snapshotLinkedProductId: input.productId,
    },
  };
}
