import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { InvoiceStatus, InvoiceType, Prisma } from "@prisma/client";
import {
  getOrderCommitPreview,
  ORDER_COMMIT_DRAFT_PENDING_OPS_SCHEMA_VERSION,
  ORDER_COMMIT_DRAFT_OPERATION_TYPE,
  ORDER_COMMIT_KIND,
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PREVIEW_BASELINE_SOURCE,
  ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_CURRENCY,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
  ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
  ORDER_COMMIT_SNAPSHOT_VERSION,
  ORDER_COMMIT_STATUS,
  type OrderCommitFinancialSummaryLoader,
  type OrderCommitPreviewClient,
  type OrderCommitSnapshotLineV1,
  type OrderCommitSnapshotV1,
} from "@/modules/order-commits";
import type { FinancialCaseSummary } from "@/modules/financial-cases";

test("preview loader blocks missing active draft", async () => {
  const client = fakePreviewClient({ drafts: [] });

  await assert.rejects(
    getOrderCommitPreview({
      orderId: "order-1",
      client: client.client,
      financialSummaryLoader: fakeSummaryLoader(activeSummary()),
    }),
    /active draft for order order-1 was not found/i
  );
});

test("preview loader uses pending snapshot instead of pending operation history", async () => {
  const baselineSnapshot = snapshotFixture({
    lines: [packageLine({ catalogEntityId: "package-basic", label: "Basic", unitPrice: 100 })],
  });
  const pendingSnapshot = snapshotFixture({
    lines: [
      packageLine({
        catalogEntityId: "package-premium",
        label: "Premium",
        unitPrice: 180,
      }),
    ],
  });
  const firstClient = fakePreviewClient({
    commits: [
      fakeCommit({
        id: "commit-1",
        sequence: 1,
        snapshotJson: baselineSnapshot,
      }),
    ],
    drafts: [
      fakeDraft({
        id: "draft-1",
        pendingSnapshotJson: pendingSnapshot,
        pendingOpsJson: emptyPendingOps(),
      }),
    ],
  });
  const secondClient = fakePreviewClient({
    commits: [
      fakeCommit({
        id: "commit-1",
        sequence: 1,
        snapshotJson: baselineSnapshot,
      }),
    ],
    drafts: [
      fakeDraft({
        id: "draft-1",
        pendingSnapshotJson: pendingSnapshot,
        pendingOpsJson: notePendingOps(),
      }),
    ],
  });

  const firstPreview = await getOrderCommitPreview({
    orderId: "order-1",
    client: firstClient.client,
    financialSummaryLoader: fakeSummaryLoader(activeSummary()),
  });
  const secondPreview = await getOrderCommitPreview({
    orderId: "order-1",
    client: secondClient.client,
    financialSummaryLoader: fakeSummaryLoader(activeSummary()),
  });

  assert.equal(firstPreview.netDelta, 80);
  assert.equal(secondPreview.netDelta, 80);
  assert.deepEqual(firstPreview.lineDiffs, secondPreview.lineDiffs);
  assert.deepEqual(firstPreview.documentPlan, secondPreview.documentPlan);
});

test("preview loader maps first original positive delta to base invoice", async () => {
  const client = fakePreviewClient({
    commits: [],
    order: fakeOrder({
      packages: [
        fakeOriginalPackage({
          originalPackageId: "package-basic",
          originalPackageNameSnapshot: "Basic",
          originalPackagePriceSnapshot: decimal("100.000"),
          originalIncludedPhotoCount: 10,
        }),
      ],
    }),
    drafts: [
      fakeDraft({
        id: "draft-1",
        pendingSnapshotJson: snapshotFixture({
          lines: [
            packageLine({
              catalogEntityId: "package-premium",
              label: "Premium",
              unitPrice: 180,
              includedPhotoCount: 20,
            }),
          ],
        }),
      }),
    ],
  });

  const preview = await getOrderCommitPreview({
    orderId: "order-1",
    client: client.client,
    financialSummaryLoader: fakeSummaryLoader(activeSummary({ remaining: 0 })),
  });

  assert.equal(
    preview.baselineSource,
    ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.ORIGINAL_ORDER_COMPOSITION
  );
  assert.equal(preview.netDelta, 80);
  assert.equal(
    preview.documentPlan.kind,
    ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.BASE_INVOICE
  );
  assert.equal(preview.paymentImpact.amountDue, 80);
});

test("preview loader maps latest committed positive delta to adjustment invoice", async () => {
  const client = fakePreviewClient({
    commits: [
      fakeCommit({
        id: "commit-1",
        sequence: 1,
        snapshotJson: snapshotFixture({
          lines: [packageLine({ unitPrice: 180 })],
        }),
      }),
    ],
    drafts: [
      fakeDraft({
        id: "draft-1",
        version: 3,
        pendingSnapshotJson: snapshotFixture({
          lines: [packageLine({ unitPrice: 205 })],
        }),
      }),
    ],
  });

  const preview = await getOrderCommitPreview({
    orderId: "order-1",
    client: client.client,
    financialSummaryLoader: fakeSummaryLoader(
      activeSummary({
        effectivePaid: 120,
        remaining: 10,
        creditNoteCapacity: 5,
        overpaymentCapacity: 2,
      })
    ),
  });

  assert.equal(
    preview.baselineSource,
    ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT
  );
  assert.equal(preview.baselineCommitId, "commit-1");
  assert.equal(preview.draftId, "draft-1");
  assert.equal(preview.draftVersion, 3);
  assert.equal(preview.netDelta, 25);
  assert.equal(
    preview.documentPlan.kind,
    ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.ADJUSTMENT_INVOICE
  );
  assert.equal(preview.paymentImpact.alreadyPaidAmount, 120);
  assert.equal(preview.paymentImpact.remainingAfterCommit, 35);
});

test("preview loader maps booking-stage payment state as pre-final-invoice only", async () => {
  const client = fakePreviewClient({
    commits: [],
    order: fakeOrder({ packages: [] }),
    drafts: [
      fakeDraft({
        id: "draft-1",
        pendingSnapshotJson: snapshotFixture({
          lines: [packageLine({ unitPrice: 100 })],
        }),
      }),
    ],
  });

  const preview = await getOrderCommitPreview({
    orderId: "order-1",
    client: client.client,
    financialSummaryLoader: fakeSummaryLoader(
      bookingSummary({ depositPaidAmount: 40 })
    ),
  });

  assert.equal(preview.paymentImpact.alreadyPaidAmount, 40);
  assert.equal(preview.paymentImpact.remainingAfterCommit, 100);
  assert.equal(preview.refundImpact.creditNoteAmount, 0);
  assert.equal(preview.refundImpact.refundableAmount, 0);
});

test("preview loader source stays read-only and uses FinancialCaseSummary boundary", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "src/modules/order-commits/order-commit-preview.service.ts"
    ),
    "utf8"
  );

  assert.match(source, /getFinancialCaseSummary\(\{\s*orderId:/);
  assert.equal(/pendingOpsJson/.test(source), false);
  assert.equal(/invoiceLineItem/i.test(source), false);
  assert.equal(
    /\.(create|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(source),
    false
  );
  assert.equal(
    /from\s+["'][^"']*(adjustment-workspace|invoice\.service|payment\.service|refund)[^"']*["']/i.test(
      source
    ),
    false
  );
  assert.equal(
    /from\s+["'](?:@\/components|@\/app|\.{1,2}\/.*components)/.test(source),
    false
  );
});

type FakeCommit = {
  id: string;
  orderId: string;
  financialCaseId: string;
  previousCommitId: string | null;
  sequence: number;
  kind: string;
  status: string;
  snapshotVersion: number;
  snapshotJson: unknown;
  metadataJson: Record<string, unknown>;
  committedAt: Date;
  committedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type FakeDraft = {
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
  createdAt: Date;
  updatedAt: Date;
};

type FakeOrder = {
  id: string;
  booking: {
    financialCase: { id: string } | null;
  };
  packages: FakeOriginalPackage[];
};

type FakeOriginalPackage = {
  id: string;
  originalPackageId: string;
  originalPackageNameSnapshot: string | null;
  originalPackagePriceSnapshot: Prisma.Decimal | null;
  bookingPackageId: string | null;
  sessionTypeId: string;
  sortOrder: number;
  createdAt: Date;
  originalPackage: { photoCount: number | null } | null;
  sessionType: {
    id: string;
    name: string;
  };
};

function fakePreviewClient(input: {
  commits?: FakeCommit[];
  drafts?: FakeDraft[];
  order?: FakeOrder;
} = {}) {
  const commits = [...(input.commits ?? [])];
  const drafts = [...(input.drafts ?? [fakeDraft({ id: "draft-1" })])];
  const order = input.order ?? fakeOrder();
  const client = {
    orderCommit: {
      findFirst: async (args: { where?: { orderId?: string } }) =>
        commits
          .filter((commit) => commit.orderId === args.where?.orderId)
          .sort((left, right) => right.sequence - left.sequence)[0] ?? null,
    },
    orderCommitDraft: {
      findUnique: async (args: { where: { orderId?: string } }) =>
        drafts.find((draft) => draft.orderId === args.where.orderId) ?? null,
    },
    order: {
      findUnique: async (args: { where: { id: string } }) =>
        order.id === args.where.id ? order : null,
    },
  };

  return {
    client: client as unknown as OrderCommitPreviewClient,
  };
}

function fakeCommit(
  overrides: Partial<FakeCommit> & { id: string; sequence: number }
): FakeCommit {
  const now = new Date("2026-06-02T09:00:00.000Z");
  return {
    id: overrides.id,
    orderId: overrides.orderId ?? "order-1",
    financialCaseId: overrides.financialCaseId ?? "financial-case-1",
    previousCommitId: overrides.previousCommitId ?? null,
    sequence: overrides.sequence,
    kind: overrides.kind ?? ORDER_COMMIT_KIND.BASELINE,
    status: overrides.status ?? ORDER_COMMIT_STATUS.COMMITTED,
    snapshotVersion: overrides.snapshotVersion ?? ORDER_COMMIT_SNAPSHOT_VERSION,
    snapshotJson:
      overrides.snapshotJson ??
      snapshotFixture({
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

function fakeDraft(overrides: Partial<FakeDraft> & { id: string }): FakeDraft {
  const now = new Date("2026-06-02T09:30:00.000Z");
  const orderId = overrides.orderId ?? "order-1";
  const financialCaseId = overrides.financialCaseId ?? "financial-case-1";

  return {
    id: overrides.id,
    orderId,
    financialCaseId,
    baseCommitId: overrides.baseCommitId ?? null,
    pendingSnapshotVersion:
      overrides.pendingSnapshotVersion ?? ORDER_COMMIT_SNAPSHOT_VERSION,
    pendingSnapshotJson:
      overrides.pendingSnapshotJson ?? snapshotFixture({ orderId, financialCaseId }),
    pendingOpsJson: overrides.pendingOpsJson ?? emptyPendingOps(),
    version: overrides.version ?? 0,
    ownerUserId: overrides.ownerUserId ?? "user-1",
    openedByUserId: overrides.openedByUserId ?? "user-1",
    lastTouchedByUserId: overrides.lastTouchedByUserId ?? "user-1",
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function fakeOrder(input: Partial<FakeOrder> = {}): FakeOrder {
  return {
    id: input.id ?? "order-1",
    booking: input.booking ?? {
      financialCase: { id: "financial-case-1" },
    },
    packages:
      input.packages ??
      [
        fakeOriginalPackage({
          id: "order-package-1",
          originalPackagePriceSnapshot: decimal("100.000"),
        }),
      ],
  };
}

function fakeOriginalPackage(
  input: Partial<FakeOriginalPackage> = {}
): FakeOriginalPackage {
  return {
    id: input.id ?? "order-package-1",
    originalPackageId: input.originalPackageId ?? "package-basic",
    originalPackageNameSnapshot:
      input.originalPackageNameSnapshot ?? "Basic",
    originalPackagePriceSnapshot:
      input.originalPackagePriceSnapshot ?? decimal("100.000"),
    bookingPackageId: input.bookingPackageId ?? "booking-package-1",
    sessionTypeId: input.sessionTypeId ?? "session-type-1",
    sortOrder: input.sortOrder ?? 0,
    createdAt: input.createdAt ?? new Date("2026-06-02T08:00:00.000Z"),
    originalPackage:
      input.originalPackage ??
      { photoCount: input.originalPackage?.photoCount ?? 10 },
    sessionType: input.sessionType ?? {
      id: "session-type-1",
      name: "Portrait",
    },
  };
}

function snapshotFixture(input: {
  orderId?: string;
  financialCaseId?: string;
  lines?: OrderCommitSnapshotLineV1[];
} = {}): OrderCommitSnapshotV1 {
  const lines = input.lines ?? [];
  const subtotal = money(lines.reduce((sum, line) => sum + line.lineTotal, 0));

  return {
    schemaVersion: ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
    orderId: input.orderId ?? "order-1",
    financialCaseId: input.financialCaseId ?? "financial-case-1",
    capturedAt: "2026-06-02T10:00:00.000Z",
    currency: ORDER_COMMIT_SNAPSHOT_CURRENCY,
    lines,
    totals: {
      subtotal,
      discountTotal: 0,
      netTotal: subtotal,
    },
  };
}

function packageLine(input: {
  orderPackageId?: string;
  catalogEntityId?: string;
  label?: string;
  quantity?: number;
  unitPrice?: number;
  includedPhotoCount?: number;
} = {}): OrderCommitSnapshotLineV1 {
  const orderPackageId = input.orderPackageId ?? "order-package-1";
  const quantity = input.quantity ?? 1;
  const unitPrice = input.unitPrice ?? 100;
  const includedPhotoCount = input.includedPhotoCount ?? 10;

  return {
    lineId: `package:${orderPackageId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE,
    orderEntityId: orderPackageId,
    parentOrderPackageId: null,
    catalogEntityId: input.catalogEntityId ?? "package-basic",
    stableKey: `order-package:${orderPackageId}`,
    label: input.label ?? "Basic",
    quantity,
    unitPrice,
    lineTotal: money(quantity * unitPrice),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      includedPhotoCount,
      selectedPhotoCount: includedPhotoCount,
      extraDigitalCount: 0,
      extraPrintCount: 0,
      sessionTypeId: "session-type-1",
      sessionTypeName: "Portrait",
      sortOrder: 0,
    },
  };
}

function fakeSummaryLoader(
  summary: FinancialCaseSummary | null
): OrderCommitFinancialSummaryLoader {
  return async ({ orderId }) => {
    assert.equal(orderId, "order-1");
    return summary;
  };
}

function activeSummary(input: {
  effectivePaid?: number;
  remaining?: number;
  creditNoteCapacity?: number;
  overpaymentCapacity?: number;
} = {}): FinancialCaseSummary {
  return {
    stage: "active",
    financialCaseId: "financial-case-1",
    orderId: "order-1",
    bookingId: "booking-1",
    depositInvoice: null,
    finalInvoice: {
      id: "invoice-final",
      invoiceNumber: "INV-1",
      invoiceType: InvoiceType.FINAL,
      total: 180,
      remaining: input.remaining ?? 0,
      status: InvoiceStatus.ISSUED,
      isLocked: false,
      depositPaidAmount: 0,
    },
    finalizedAdjustments: [],
    creditNotes: [],
    refunds: [],
    customerTotal: 180,
    effectivePaid: input.effectivePaid ?? 0,
    paidSoFar: input.effectivePaid ?? 0,
    depositApplied: 0,
    remaining: input.remaining ?? 0,
    totalAdjustments: 0,
    finalTotal: 180,
    overpaymentCapacity: input.overpaymentCapacity ?? 0,
    creditNoteCapacity: input.creditNoteCapacity ?? 0,
    linkedDocuments: [],
    paymentStatusEnum: "PARTIAL",
  };
}

function bookingSummary(input: {
  depositPaidAmount?: number;
} = {}): FinancialCaseSummary {
  return {
    stage: "booking",
    financialCaseId: "financial-case-1",
    bookingId: "booking-1",
    depositInvoice: {
      id: "invoice-deposit",
      invoiceNumber: "INV-DEP",
      total: 40,
      status: InvoiceStatus.PAID,
      isLocked: true,
      paidAmount: input.depositPaidAmount ?? 0,
    },
    depositPaid: true,
    awaitingFinalInvoiceAfterCheckIn: true,
    finalInvoicePending: true,
    linkedDocuments: [],
  };
}

function emptyPendingOps() {
  return {
    schemaVersion: ORDER_COMMIT_DRAFT_PENDING_OPS_SCHEMA_VERSION,
    operations: [],
  };
}

function notePendingOps() {
  return {
    schemaVersion: ORDER_COMMIT_DRAFT_PENDING_OPS_SCHEMA_VERSION,
    operations: [
      {
        id: "note-1",
        type: ORDER_COMMIT_DRAFT_OPERATION_TYPE.NOTE_APPENDED,
        payload: { note: "history only" },
        actorUserId: "user-1",
        createdAt: "2026-06-02T11:00:00.000Z",
      },
    ],
  };
}

function decimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function money(value: number): number {
  return Number(value.toFixed(3));
}
