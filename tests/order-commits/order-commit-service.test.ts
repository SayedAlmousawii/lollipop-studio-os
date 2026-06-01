import assert from "node:assert/strict";
import test from "node:test";
import { InvoiceType, MediaType, Prisma, UserRole } from "@prisma/client";
import {
  backfillOrderCommitsForFinanciallyCommittedOrders,
  bootstrapOrderCommitIfMissing,
  createOrderCommitSnapshot,
  discardOrderCommitDraft,
  getOrCreateOrderCommitDraft,
  getLatestCommittedOrderSnapshot,
  getOrderCommitDraft,
  ORDER_COMMIT_DRAFT_PENDING_OPS_SCHEMA_VERSION,
  ORDER_COMMIT_KIND,
  ORDER_COMMIT_STATUS,
  type BackfillOrderCommitsForFinanciallyCommittedOrdersInput,
  type BootstrapOrderCommitIfMissingInput,
  type CreateOrderCommitSnapshotInput,
  type DiscardOrderCommitDraftInput,
  type GetLatestCommittedOrderSnapshotInput,
  type GetOrCreateOrderCommitDraftInput,
  type GetOrderCommitDraftInput,
  type OrderCommitSnapshotV1,
} from "@/modules/order-commits";
import type { ActorContext } from "@/lib/auth/actor-context";

const actorContext: ActorContext = {
  actorUserId: "user-1",
  actorRole: UserRole.ADMIN,
};

test("latest lookup by order id returns the highest sequence snapshot", async () => {
  const client = fakeOrderCommitClient({
    commits: [
      fakeCommit({ id: "commit-1", sequence: 1 }),
      fakeCommit({ id: "commit-2", sequence: 2 }),
    ],
  });

  const latest = await getLatestCommittedOrderSnapshot({
    orderId: "order-1",
    client: client.read,
  });

  assert.equal(latest?.commit.id, "commit-2");
  assert.equal(latest?.commit.sequence, 2);
  assert.equal(latest?.snapshot.schemaVersion, "order_commit_snapshot_v1");
});

test("latest lookup by financial case returns the same highest sequence shape", async () => {
  const client = fakeOrderCommitClient({
    commits: [
      fakeCommit({
        id: "commit-other",
        orderId: "order-other",
        financialCaseId: "financial-case-other",
        sequence: 4,
      }),
      fakeCommit({ id: "commit-1", sequence: 1 }),
      fakeCommit({ id: "commit-3", sequence: 3 }),
    ],
  });

  const latest = await getLatestCommittedOrderSnapshot({
    financialCaseId: "financial-case-1",
    client: client.read,
  });

  assert.equal(latest?.commit.id, "commit-3");
  assert.equal(latest?.commit.orderId, "order-1");
  assert.equal(latest?.snapshot.financialCaseId, "financial-case-1");
});

test("first create writes sequence 1 with committed V1 snapshot", async () => {
  const client = fakeOrderCommitClient();

  const created = await createOrderCommitSnapshot({
    orderId: "order-1",
    kind: ORDER_COMMIT_KIND.BASELINE,
    actorContext,
    metadata: { reason: "manual_test" },
    client: client.root,
  });

  assert.equal(created.commit.sequence, 1);
  assert.equal(created.commit.previousCommitId, null);
  assert.equal(created.commit.status, ORDER_COMMIT_STATUS.COMMITTED);
  assert.equal(created.commit.committedByUserId, "user-1");
  assert.deepEqual(created.commit.metadata, { reason: "manual_test" });
  assert.equal(created.snapshot.schemaVersion, "order_commit_snapshot_v1");
  assert.equal(client.commits.length, 1);
});

test("second create writes sequence 2 and links the previous commit", async () => {
  const client = fakeOrderCommitClient({
    commits: [fakeCommit({ id: "commit-1", sequence: 1 })],
  });

  const created = await createOrderCommitSnapshot({
    orderId: "order-1",
    kind: ORDER_COMMIT_KIND.BASELINE,
    actorContext,
    client: client.root,
  });

  assert.equal(created.commit.sequence, 2);
  assert.equal(created.commit.previousCommitId, "commit-1");
  assert.equal(client.commits.length, 2);
});

test("bootstrap returns an existing commit without creating another", async () => {
  const client = fakeOrderCommitClient({
    commits: [fakeCommit({ id: "commit-existing", sequence: 1 })],
  });

  const bootstrapped = await bootstrapOrderCommitIfMissing({
    orderId: "order-1",
    actorContext,
    client: client.root,
  });

  assert.equal(bootstrapped.commit.id, "commit-existing");
  assert.equal(client.commits.length, 1);
});

test("bootstrap creates sequence 1 with bootstrap metadata when missing", async () => {
  const client = fakeOrderCommitClient();

  const bootstrapped = await bootstrapOrderCommitIfMissing({
    orderId: "order-1",
    actorContext,
    client: client.root,
  });

  assert.equal(bootstrapped.commit.sequence, 1);
  assert.equal(bootstrapped.commit.previousCommitId, null);
  assert.deepEqual(bootstrapped.commit.metadata, {
    reason: "phase_1_bootstrap",
  });
  assert.equal(client.commits.length, 1);
});

test("getOrCreate creates a first-commit draft from current operational rows", async () => {
  const client = fakeOrderCommitClient();

  const draft = await getOrCreateOrderCommitDraft({
    orderId: "order-1",
    actorContext,
    client: client.draftRoot,
  });

  assert.equal(draft.draft.orderId, "order-1");
  assert.equal(draft.draft.financialCaseId, "financial-case-order-1");
  assert.equal(draft.draft.baseCommitId, null);
  assert.equal(draft.draft.version, 0);
  assert.equal(draft.draft.ownerUserId, "user-1");
  assert.equal(draft.pendingSnapshot.lines.length, 5);
  assert.equal(draft.pendingSnapshot.financialCaseId, "financial-case-order-1");
  assert.deepEqual(draft.pendingOps, {
    schemaVersion: ORDER_COMMIT_DRAFT_PENDING_OPS_SCHEMA_VERSION,
    operations: [],
  });
  assert.equal(client.drafts.length, 1);
});

test("getOrCreate draft uses the latest committed snapshot when one exists", async () => {
  const latestSnapshot = fakeSnapshot({
    orderId: "order-1",
    financialCaseId: "financial-case-order-1",
  });
  const client = fakeOrderCommitClient({
    commits: [
      fakeCommit({
        id: "commit-1",
        orderId: "order-1",
        financialCaseId: "financial-case-order-1",
        sequence: 1,
      }),
      fakeCommit({
        id: "commit-2",
        orderId: "order-1",
        financialCaseId: "financial-case-order-1",
        sequence: 2,
        snapshotJson: latestSnapshot,
      }),
    ],
  });

  const draft = await getOrCreateOrderCommitDraft({
    orderId: "order-1",
    actorContext,
    client: client.draftRoot,
  });

  assert.equal(draft.draft.baseCommitId, "commit-2");
  assert.deepEqual(draft.pendingSnapshot, latestSnapshot);
});

test("repeated getOrCreate returns the same active draft", async () => {
  const client = fakeOrderCommitClient();

  const first = await getOrCreateOrderCommitDraft({
    orderId: "order-1",
    actorContext,
    client: client.draftRoot,
  });
  const second = await getOrCreateOrderCommitDraft({
    orderId: "order-1",
    actorContext: {
      actorUserId: "user-2",
      actorRole: UserRole.RECEPTIONIST,
    },
    client: client.draftRoot,
  });
  const loaded = await getOrderCommitDraft({
    orderId: "order-1",
    client: client.draftRead,
  });

  assert.equal(second.draft.id, first.draft.id);
  assert.equal(second.draft.ownerUserId, "user-1");
  assert.equal(loaded?.draft.id, first.draft.id);
  assert.equal(client.drafts.length, 1);
});

test("discard rejects stale expectedVersion and keeps the draft", async () => {
  const client = fakeOrderCommitClient({
    drafts: [fakeDraft({ id: "draft-1", version: 2 })],
  });

  await assert.rejects(
    discardOrderCommitDraft({
      orderId: "order-1",
      expectedVersion: 1,
      actorContext,
      client: client.draftRoot,
    }),
    /stale expectedVersion/
  );

  assert.equal(client.drafts.length, 1);
});

test("discard enforces owner or manager mutation rules", async () => {
  const client = fakeOrderCommitClient({
    drafts: [fakeDraft({ id: "draft-1", ownerUserId: "owner-user" })],
  });

  await assert.rejects(
    discardOrderCommitDraft({
      orderId: "order-1",
      expectedVersion: 0,
      actorContext: {
        actorUserId: "user-2",
        actorRole: UserRole.RECEPTIONIST,
      },
      client: client.draftRoot,
    }),
    /cannot mutate draft/
  );
  assert.equal(client.drafts.length, 1);

  const discarded = await discardOrderCommitDraft({
    orderId: "order-1",
    expectedVersion: 0,
    actorContext: {
      actorUserId: "manager-user",
      actorRole: UserRole.MANAGER,
    },
    client: client.draftRoot,
  });

  assert.equal(discarded.draft.id, "draft-1");
  assert.equal(client.drafts.length, 0);
});

test("backfill creates commits only for financially committed orders", async () => {
  const client = fakeOrderCommitClient({
    orders: [
      fakeOrder({ id: "order-final", invoices: [invoice(InvoiceType.FINAL)] }),
      fakeOrder({
        id: "order-adjustment",
        invoices: [invoice(InvoiceType.ADJUSTMENT)],
      }),
      fakeOrder({
        id: "order-existing",
        invoices: [invoice(InvoiceType.REFUND)],
      }),
      fakeOrder({ id: "order-empty", invoices: [] }),
    ],
    commits: [
      fakeCommit({
        id: "commit-existing",
        orderId: "order-existing",
        financialCaseId: "financial-case-order-existing",
        sequence: 1,
      }),
    ],
  });

  const result = await backfillOrderCommitsForFinanciallyCommittedOrders({
    actorContext,
    client: client.root,
  });

  assert.deepEqual(result, {
    scanned: 4,
    created: 2,
    skippedExisting: 1,
    skippedNoFinancialCommitment: 1,
    failed: [],
  });
  assert.equal(client.commits.length, 3);
  assert.deepEqual(
    client.commits
      .filter((commit) => commit.id !== "commit-existing")
      .map((commit) => [commit.orderId, commit.metadataJson]),
    [
      ["order-final", { reason: "phase_1_bootstrap" }],
      ["order-adjustment", { reason: "phase_1_bootstrap" }],
    ]
  );
});

test("backfill is idempotent across repeated runs", async () => {
  const client = fakeOrderCommitClient({
    orders: [
      fakeOrder({ id: "order-final", invoices: [invoice(InvoiceType.FINAL)] }),
      fakeOrder({
        id: "order-credit-note",
        invoices: [invoice(InvoiceType.CREDIT_NOTE)],
      }),
      fakeOrder({ id: "order-empty", invoices: [] }),
    ],
  });

  const first = await backfillOrderCommitsForFinanciallyCommittedOrders({
    actorContext,
    client: client.root,
  });
  const second = await backfillOrderCommitsForFinanciallyCommittedOrders({
    actorContext,
    client: client.root,
  });

  assert.equal(first.created, 2);
  assert.equal(client.commits.length, 2);
  assert.deepEqual(second, {
    scanned: 3,
    created: 0,
    skippedExisting: 2,
    skippedNoFinancialCommitment: 1,
    failed: [],
  });
  assert.equal(client.commits.length, 2);
});

test("backfill returns inspectable failure details", async () => {
  const client = fakeOrderCommitClient({
    orders: [
      fakeOrder({
        id: "order-missing-case",
        invoices: [invoice(InvoiceType.FINAL)],
        hasFinancialCase: false,
      }),
    ],
  });

  const result = await backfillOrderCommitsForFinanciallyCommittedOrders({
    actorContext,
    client: client.root,
  });

  assert.equal(result.scanned, 1);
  assert.equal(result.created, 0);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0]?.orderId, "order-missing-case");
  assert.match(result.failed[0]?.reason ?? "", /has no FinancialCase/);
});

test("backfill does not select invoice line items", async () => {
  const client = fakeOrderCommitClient({
    orders: [
      fakeOrder({ id: "order-final", invoices: [invoice(InvoiceType.FINAL)] }),
    ],
  });

  await backfillOrderCommitsForFinanciallyCommittedOrders({
    actorContext,
    client: client.root,
  });

  assert.equal(client.invoiceLineItemSelectAttempted, false);
});

test("backfill bootstrap stores captured snapshots available through latest lookup", async () => {
  const client = fakeOrderCommitClient({
    orders: [
      fakeOrder({ id: "order-final", invoices: [invoice(InvoiceType.FINAL)] }),
    ],
  });

  const result = await backfillOrderCommitsForFinanciallyCommittedOrders({
    actorContext,
    client: client.root,
  });
  const latestByOrder = await getLatestCommittedOrderSnapshot({
    orderId: "order-final",
    client: client.read,
  });
  const latestByFinancialCase = await getLatestCommittedOrderSnapshot({
    financialCaseId: "financial-case-order-final",
    client: client.read,
  });
  const bootstrappedAgain = await bootstrapOrderCommitIfMissing({
    orderId: "order-final",
    actorContext,
    client: client.root,
  });
  const secondBackfill = await backfillOrderCommitsForFinanciallyCommittedOrders({
    actorContext,
    client: client.root,
  });

  assert.equal(result.created, 1);
  assert.equal(latestByOrder?.commit.sequence, 1);
  assert.equal(latestByOrder?.snapshot.lines.length, 5);
  assert.equal(
    latestByOrder?.snapshot.lines.find((line) => line.lineId === "package:op-order-final")
      ?.label,
    "Operational Package order-final"
  );
  assert.deepEqual(latestByFinancialCase?.snapshot, latestByOrder?.snapshot);
  assert.equal(bootstrappedAgain.commit.id, latestByOrder?.commit.id);
  assert.deepEqual(secondBackfill, {
    scanned: 1,
    created: 0,
    skippedExisting: 1,
    skippedNoFinancialCommitment: 0,
    failed: [],
  });
});

test("stored snapshots do not change after catalog price edits", async () => {
  const catalog = {
    packagePrice: decimal("999.000"),
    productPrice: decimal("77.000"),
    packageItemPrice: decimal("88.000"),
    extraDigitalPrice: decimal("5.000"),
    extraPrintPrice: decimal("7.500"),
  };
  const client = fakeOrderCommitClient({ catalog });

  const created = await createOrderCommitSnapshot({
    orderId: "order-1",
    kind: ORDER_COMMIT_KIND.BASELINE,
    actorContext,
    client: client.root,
  });
  catalog.packagePrice = decimal("1.000");
  catalog.productPrice = decimal("2.000");
  catalog.packageItemPrice = decimal("3.000");
  catalog.extraDigitalPrice = decimal("55.000");
  catalog.extraPrintPrice = decimal("75.000");

  const latest = await getLatestCommittedOrderSnapshot({
    orderId: "order-1",
    client: client.read,
  });

  assert.deepEqual(latest?.snapshot, created.snapshot);
  assert.equal(
    latest?.snapshot.lines.find((line) => line.lineId === "package:op-order-1")
      ?.unitPrice,
    150.125
  );
  assert.equal(
    latest?.snapshot.lines.find((line) => line.lineId === "addon:addon-order-1")
      ?.unitPrice,
    20
  );
  assert.equal(
    latest?.snapshot.lines.find((line) => line.lineId === "item-upgrade:upgrade-order-1")
      ?.unitPrice,
    15
  );
  assert.equal(
    latest?.snapshot.lines.find((line) => line.lineId === "extra-photo:op-order-1:digital")
      ?.unitPrice,
    5
  );
  assert.equal(
    latest?.snapshot.lines.find((line) => line.lineId === "extra-photo:op-order-1:print")
      ?.unitPrice,
    7.5
  );
});

type FakeOrderCommitRow = {
  id: string;
  orderId: string;
  financialCaseId: string;
  previousCommitId: string | null;
  sequence: number;
  kind: string;
  status: string;
  snapshotVersion: number;
  snapshotJson: unknown;
  metadataJson: unknown;
  committedAt: Date;
  committedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type FakeOrderCommitFindFirstArgs = {
  where?: { orderId?: string; financialCaseId?: string };
};

type FakeOrderCommitCreateArgs = {
  data: {
    orderId: string;
    financialCaseId: string;
    previousCommitId: string | null;
    sequence: number;
    kind: string;
    status: string;
    snapshotVersion: number;
    snapshotJson: unknown;
    metadataJson: unknown;
    committedByUserId: string | null;
  };
};

type FakeOrderCommitDraftRow = {
  id: string;
  orderId: string;
  financialCaseId: string;
  baseCommitId: string | null;
  pendingSnapshotVersion: number;
  pendingSnapshotJson: unknown;
  pendingOpsJson: unknown;
  version: number;
  ownerUserId: string;
  openedByUserId: string;
  lastTouchedByUserId: string;
  legacyAdjustmentWorkspaceId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type FakeOrderCommitDraftFindUniqueArgs = {
  where: { orderId?: string; id?: string };
};

type FakeOrderCommitDraftCreateArgs = {
  data: {
    orderId: string;
    financialCaseId: string;
    baseCommitId: string | null;
    pendingSnapshotVersion: number;
    pendingSnapshotJson: unknown;
    pendingOpsJson: unknown;
    ownerUserId: string;
    openedByUserId: string;
    lastTouchedByUserId: string;
  };
};

type FakeOrderCommitDraftDeleteManyArgs = {
  where: { id: string; version: number };
};

type FakeInvoiceHeader = {
  invoiceType: InvoiceType;
  isLocked: boolean;
};

type FakeBackfillOrder = {
  id: string;
  financialCaseId: string | null;
  invoices: FakeInvoiceHeader[];
};

type FakeOrderFindManyArgs = {
  select?: {
    invoices?: {
      select?: Record<string, unknown>;
    };
  };
};

type FakeOrderFindUniqueArgs = {
  where: { id: string };
};

type MutableCatalogPrices = {
  packagePrice: Prisma.Decimal;
  productPrice: Prisma.Decimal;
  packageItemPrice: Prisma.Decimal;
  extraDigitalPrice: Prisma.Decimal;
  extraPrintPrice: Prisma.Decimal;
};

function fakeOrderCommitClient(
  options: {
    commits?: FakeOrderCommitRow[];
    drafts?: FakeOrderCommitDraftRow[];
    orders?: FakeBackfillOrder[];
    catalog?: MutableCatalogPrices;
  } = {}
) {
  const commits = [...(options.commits ?? [])];
  const drafts = [...(options.drafts ?? [])];
  const orders = options.orders ?? [
    fakeOrder({ id: "order-1", invoices: [] }),
  ];
  const catalog = options.catalog ?? {
    packagePrice: decimal("999.000"),
    productPrice: decimal("77.000"),
    packageItemPrice: decimal("88.000"),
    extraDigitalPrice: decimal("5.000"),
    extraPrintPrice: decimal("7.500"),
  };
  let invoiceLineItemSelectAttempted = false;
  const root = {
    order: {
      findMany: async (args: FakeOrderFindManyArgs) => {
        if (args.select?.invoices?.select?.lineItems) {
          invoiceLineItemSelectAttempted = true;
          throw new Error("Backfill must not select invoice line items.");
        }
        return orders.map((order) => ({
          id: order.id,
          invoices: order.invoices,
          orderCommits: commits
            .filter((commit) => commit.orderId === order.id)
            .slice(0, 1)
            .map((commit) => ({ id: commit.id })),
        }));
      },
      findUnique: async (args: FakeOrderFindUniqueArgs) => {
        const order = orders.find((candidate) => candidate.id === args.where.id);
        const financialCaseId =
          order?.financialCaseId ??
          (args.where.id === "order-1" ? "financial-case-1" : null);
        return {
          id: args.where.id,
          booking: {
            financialCase: financialCaseId ? { id: financialCaseId } : null,
          },
          ...fakeOperationalRows(args.where.id, catalog),
        };
      },
    },
    sessionTypeExtraPhotoPricing: {
      findMany: async () => [
        {
          sessionTypeId: "session-type-1",
          mediaType: MediaType.DIGITAL,
          unitPrice: catalog.extraDigitalPrice,
        },
        {
          sessionTypeId: "session-type-1",
          mediaType: MediaType.PRINT,
          unitPrice: catalog.extraPrintPrice,
        },
      ],
    },
    orderCommit: {
      findFirst: async (args: FakeOrderCommitFindFirstArgs) => {
        const candidates = commits
          .filter((commit) => {
            if (args.where?.orderId) return commit.orderId === args.where.orderId;
            if (args.where?.financialCaseId) {
              return commit.financialCaseId === args.where.financialCaseId;
            }
            return true;
          })
          .sort((left, right) => right.sequence - left.sequence);
        return candidates[0] ?? null;
      },
      create: async (args: FakeOrderCommitCreateArgs) => {
        const now = new Date("2026-06-01T10:00:00.000Z");
        const row: FakeOrderCommitRow = {
          id: `commit-${commits.length + 1}`,
          orderId: args.data.orderId,
          financialCaseId: args.data.financialCaseId,
          previousCommitId: args.data.previousCommitId,
          sequence: args.data.sequence,
          kind: args.data.kind,
          status: args.data.status,
          snapshotVersion: args.data.snapshotVersion,
          snapshotJson: args.data.snapshotJson,
          metadataJson: args.data.metadataJson,
          committedAt: now,
          committedByUserId: args.data.committedByUserId,
          createdAt: now,
          updatedAt: now,
        };
        commits.push(row);
        return row;
      },
    },
    orderCommitDraft: {
      findUnique: async (args: FakeOrderCommitDraftFindUniqueArgs) =>
        drafts.find((draft) => {
          if (args.where.orderId) return draft.orderId === args.where.orderId;
          if (args.where.id) return draft.id === args.where.id;
          return false;
        }) ?? null,
      create: async (args: FakeOrderCommitDraftCreateArgs) => {
        const now = new Date("2026-06-01T10:00:00.000Z");
        const row: FakeOrderCommitDraftRow = {
          id: `draft-${drafts.length + 1}`,
          orderId: args.data.orderId,
          financialCaseId: args.data.financialCaseId,
          baseCommitId: args.data.baseCommitId,
          pendingSnapshotVersion: args.data.pendingSnapshotVersion,
          pendingSnapshotJson: args.data.pendingSnapshotJson,
          pendingOpsJson: args.data.pendingOpsJson,
          version: 0,
          ownerUserId: args.data.ownerUserId,
          openedByUserId: args.data.openedByUserId,
          lastTouchedByUserId: args.data.lastTouchedByUserId,
          legacyAdjustmentWorkspaceId: null,
          createdAt: now,
          updatedAt: now,
        };
        drafts.push(row);
        return row;
      },
      deleteMany: async (args: FakeOrderCommitDraftDeleteManyArgs) => {
        const index = drafts.findIndex(
          (draft) =>
            draft.id === args.where.id && draft.version === args.where.version
        );
        if (index === -1) return { count: 0 };
        drafts.splice(index, 1);
        return { count: 1 };
      },
    },
    $transaction: async <T>(fn: (transaction: unknown) => Promise<T>) => fn(root),
  };

  return {
    commits,
    drafts,
    get invoiceLineItemSelectAttempted() {
      return invoiceLineItemSelectAttempted;
    },
    read: root as unknown as NonNullable<
      GetLatestCommittedOrderSnapshotInput["client"]
    >,
    root: root as unknown as NonNullable<
      | CreateOrderCommitSnapshotInput["client"]
      | BootstrapOrderCommitIfMissingInput["client"]
      | BackfillOrderCommitsForFinanciallyCommittedOrdersInput["client"]
    >,
    draftRead: root as unknown as NonNullable<GetOrderCommitDraftInput["client"]>,
    draftRoot: root as unknown as NonNullable<
      | GetOrCreateOrderCommitDraftInput["client"]
      | DiscardOrderCommitDraftInput["client"]
    >,
  };
}

function fakeOrder(input: {
  id: string;
  invoices: FakeInvoiceHeader[];
  hasFinancialCase?: boolean;
}): FakeBackfillOrder {
  return {
    id: input.id,
    financialCaseId:
      input.hasFinancialCase === false ? null : `financial-case-${input.id}`,
    invoices: input.invoices,
  };
}

function fakeOperationalRows(orderId: string, catalog: MutableCatalogPrices) {
  const orderPackageId = `op-${orderId}`;
  return {
    packages: [
      {
        id: orderPackageId,
        originalPackageId: `pkg-original-${orderId}`,
        currentPackageId: `pkg-current-${orderId}`,
        bookingPackageId: `booking-package-${orderId}`,
        sessionTypeId: "session-type-1",
        originalPackageNameSnapshot: `Original Package ${orderId}`,
        currentPackageNameSnapshot: `Operational Package ${orderId}`,
        originalPackagePriceSnapshot: decimal("100.000"),
        finalPackagePriceSnapshot: decimal("150.125"),
        selectedPhotoCount: 12,
        extraDigitalCount: 1,
        extraPrintCount: 1,
        sortOrder: 1,
        createdAt: new Date("2026-06-01T08:00:00.000Z"),
        currentPackage: {
          price: catalog.packagePrice,
          photoCount: 10,
        },
        sessionType: {
          id: "session-type-1",
          name: "Portrait",
        },
        sessionConfigurationSelections: [],
      },
    ],
    orderAddOns: [
      {
        id: `addon-${orderId}`,
        orderPackageId,
        productId: `product-${orderId}`,
        nameSnapshot: `Operational Add On ${orderId}`,
        priceSnapshot: decimal("20.000"),
        quantity: 3,
        notes: "scoped add-on",
        createdAt: new Date("2026-06-01T08:03:00.000Z"),
        product: {
          price: catalog.productPrice,
        },
        sessionConfigurationSelections: [],
      },
    ],
    packageItemUpgrades: [
      {
        id: `upgrade-${orderId}`,
        orderPackageId,
        packageItemId: `package-item-${orderId}`,
        nameSnapshot: `Upgrade Album ${orderId}`,
        priceSnapshot: decimal("15.000"),
        quantity: 2,
        notes: null,
        createdAt: new Date("2026-06-01T08:05:00.000Z"),
        packageItem: {
          price: catalog.packageItemPrice,
        },
      },
    ],
  };
}

function invoice(invoiceType: InvoiceType, isLocked = false): FakeInvoiceHeader {
  return { invoiceType, isLocked };
}

function fakeCommit(
  overrides: Partial<FakeOrderCommitRow> & { id: string; sequence: number }
): FakeOrderCommitRow {
  const now = new Date("2026-06-01T09:00:00.000Z");
  return {
    id: overrides.id,
    orderId: overrides.orderId ?? "order-1",
    financialCaseId: overrides.financialCaseId ?? "financial-case-1",
    previousCommitId: overrides.previousCommitId ?? null,
    sequence: overrides.sequence,
    kind: overrides.kind ?? ORDER_COMMIT_KIND.BASELINE,
    status: overrides.status ?? ORDER_COMMIT_STATUS.COMMITTED,
    snapshotVersion: overrides.snapshotVersion ?? 1,
    snapshotJson:
      overrides.snapshotJson ??
      fakeSnapshot({
        orderId: overrides.orderId ?? "order-1",
        financialCaseId: overrides.financialCaseId ?? "financial-case-1",
      }),
    metadataJson: overrides.metadataJson ?? {},
    committedAt: overrides.committedAt ?? now,
    committedByUserId: overrides.committedByUserId ?? "user-1",
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function fakeDraft(overrides: Partial<FakeOrderCommitDraftRow> & { id: string }) {
  const now = new Date("2026-06-01T09:30:00.000Z");
  const orderId = overrides.orderId ?? "order-1";
  const financialCaseId = overrides.financialCaseId ?? "financial-case-1";
  return {
    id: overrides.id,
    orderId,
    financialCaseId,
    baseCommitId: overrides.baseCommitId ?? null,
    pendingSnapshotVersion: overrides.pendingSnapshotVersion ?? 1,
    pendingSnapshotJson:
      overrides.pendingSnapshotJson ?? fakeSnapshot({ orderId, financialCaseId }),
    pendingOpsJson:
      overrides.pendingOpsJson ??
      {
        schemaVersion: ORDER_COMMIT_DRAFT_PENDING_OPS_SCHEMA_VERSION,
        operations: [],
      },
    version: overrides.version ?? 0,
    ownerUserId: overrides.ownerUserId ?? "user-1",
    openedByUserId: overrides.openedByUserId ?? "user-1",
    lastTouchedByUserId: overrides.lastTouchedByUserId ?? "user-1",
    legacyAdjustmentWorkspaceId: overrides.legacyAdjustmentWorkspaceId ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function fakeSnapshot(input: {
  orderId: string;
  financialCaseId: string;
}): OrderCommitSnapshotV1 {
  return {
    schemaVersion: "order_commit_snapshot_v1",
    orderId: input.orderId,
    financialCaseId: input.financialCaseId,
    capturedAt: "2026-06-01T09:00:00.000Z",
    currency: "KWD",
    lines: [],
    totals: {
      subtotal: 0,
      discountTotal: 0,
      netTotal: 0,
    },
  };
}

function decimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}
