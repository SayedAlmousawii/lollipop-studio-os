import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  ORDER_COMMIT_KIND,
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PREVIEW_BASELINE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
  ORDER_COMMIT_STATUS,
  resolveOrderCommitPreviewBaseline,
  type OrderCommitSnapshotV1,
  type ResolveOrderCommitPreviewBaselineInput,
} from "@/modules/order-commits";

test("preview baseline uses the latest OrderCommit snapshot when one exists", async () => {
  const latestSnapshot = fakeSnapshot({ netTotal: 240 });
  const client = fakePreviewBaselineClient({
    commits: [
      fakeCommit({ id: "commit-1", sequence: 1, snapshotJson: fakeSnapshot({ netTotal: 100 }) }),
      fakeCommit({ id: "commit-2", sequence: 2, snapshotJson: latestSnapshot }),
    ],
    order: fakeOrder({
      packages: [
        fakeOrderPackage({ originalPackagePriceSnapshot: null }),
      ],
    }),
  });

  const baseline = await resolveOrderCommitPreviewBaseline({
    orderId: "order-1",
    client: client.client,
  });

  assert.equal(
    baseline.baselineSource,
    ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT
  );
  assert.equal(baseline.baselineCommitId, "commit-2");
  assert.equal(baseline.baselineSequence, 2);
  assert.deepEqual(baseline.snapshot, latestSnapshot);
  assert.equal(client.orderFindUniqueCalls, 0);
});

test("preview baseline derives package-only original composition", async () => {
  const client = fakePreviewBaselineClient({
    order: fakeOrder({
      packages: [
        fakeOrderPackage({
          id: "order-package-basic",
          originalPackageId: "package-basic",
          originalPackageNameSnapshot: "Basic",
          originalPackagePriceSnapshot: decimal("100.000"),
          originalIncludedPhotoCount: 10,
          selectedPhotoCount: 17,
          extraDigitalCount: 3,
          extraPrintCount: 2,
        }),
      ],
    }),
  });

  const baseline = await resolveOrderCommitPreviewBaseline({
    orderId: "order-1",
    client: client.client,
  });
  const packageLine = requireLine(
    baseline.snapshot,
    "order-package:order-package-basic"
  );

  assert.equal(
    baseline.baselineSource,
    ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.ORIGINAL_ORDER_COMPOSITION
  );
  assert.equal(baseline.baselineCommitId, null);
  assert.equal(baseline.snapshot.totals.netTotal, 100);
  assert.equal(baseline.snapshot.lines.length, 1);
  assert.equal(packageLine.lineKind, ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE);
  assert.equal(packageLine.orderEntityKind, ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE);
  assert.equal(packageLine.catalogEntityId, "package-basic");
  assert.equal(packageLine.label, "Basic");
  assert.equal(packageLine.unitPrice, 100);
  assert.equal(packageLine.metadata.originalPackagePriceSnapshot, 100);
  assert.equal(packageLine.metadata.selectedPhotoCount, 10);
  assert.equal(packageLine.metadata.includedPhotoCount, 10);
  assert.equal(packageLine.metadata.extraDigitalCount, 0);
  assert.equal(packageLine.metadata.extraPrintCount, 0);
});

test("preview original baseline keeps Basic 100 as the first-commit comparison", async () => {
  const client = fakePreviewBaselineClient({
    order: fakeOrder({
      packages: [
        fakeOrderPackage({
          id: "order-package-1",
          originalPackageId: "package-basic",
          originalPackageNameSnapshot: "Basic",
          originalPackagePriceSnapshot: decimal("100.000"),
          currentPackageId: "package-premium",
          currentPackageNameSnapshot: "Premium",
          finalPackagePriceSnapshot: decimal("180.000"),
          originalIncludedPhotoCount: 10,
        }),
      ],
    }),
  });

  const baseline = await resolveOrderCommitPreviewBaseline({
    orderId: "order-1",
    client: client.client,
  });
  const packageLine = requireLine(baseline.snapshot, "order-package:order-package-1");

  assert.equal(packageLine.catalogEntityId, "package-basic");
  assert.equal(packageLine.label, "Basic");
  assert.equal(packageLine.lineTotal, 100);
  assert.equal(baseline.snapshot.totals.netTotal, 100);
});

test("preview original baseline never falls back to current package metadata", async () => {
  const client = fakePreviewBaselineClient({
    order: fakeOrder({
      packages: [
        fakeOrderPackage({
          id: "order-package-1",
          originalPackageId: "package-basic",
          originalPackageNameSnapshot: "Basic",
          originalPackagePriceSnapshot: decimal("100.000"),
          currentPackageId: "package-premium",
          currentPackageNameSnapshot: "Premium",
          finalPackagePriceSnapshot: decimal("180.000"),
          originalIncludedPhotoCount: 10,
          selectedPhotoCount: 20,
          extraDigitalCount: 4,
          extraPrintCount: 2,
        }),
      ],
    }),
  });

  const baseline = await resolveOrderCommitPreviewBaseline({
    orderId: "order-1",
    client: client.client,
  });
  const packageLine = requireLine(baseline.snapshot, "order-package:order-package-1");

  assert.equal(packageLine.catalogEntityId, "package-basic");
  assert.equal(packageLine.label, "Basic");
  assert.equal(packageLine.unitPrice, 100);
  assert.equal(packageLine.metadata.originalPackagePriceSnapshot, 100);
  assert.equal(packageLine.metadata.includedPhotoCount, 10);
  assert.equal(packageLine.metadata.selectedPhotoCount, 10);
  assert.equal(packageLine.metadata.extraDigitalCount, 0);
  assert.equal(packageLine.metadata.extraPrintCount, 0);
});

test("preview original baseline keeps one ordered line per original package", async () => {
  const client = fakePreviewBaselineClient({
    order: fakeOrder({
      packages: [
        fakeOrderPackage({
          id: "order-package-third",
          sortOrder: 2,
          createdAt: new Date("2026-06-01T08:00:00.000Z"),
          originalPackageNameSnapshot: "Third",
          originalPackagePriceSnapshot: decimal("30.000"),
        }),
        fakeOrderPackage({
          id: "order-package-second",
          sortOrder: 1,
          createdAt: new Date("2026-06-01T08:02:00.000Z"),
          originalPackageNameSnapshot: "Second",
          originalPackagePriceSnapshot: decimal("20.000"),
        }),
        fakeOrderPackage({
          id: "order-package-first",
          sortOrder: 1,
          createdAt: new Date("2026-06-01T08:01:00.000Z"),
          originalPackageNameSnapshot: "First",
          originalPackagePriceSnapshot: decimal("10.000"),
        }),
      ],
    }),
  });

  const baseline = await resolveOrderCommitPreviewBaseline({
    orderId: "order-1",
    client: client.client,
  });

  assert.deepEqual(
    baseline.snapshot.lines.map((line) => line.stableKey),
    [
      "order-package:order-package-first",
      "order-package:order-package-second",
      "order-package:order-package-third",
    ]
  );
  assert.equal(baseline.snapshot.totals.netTotal, 60);
});

test("preview baseline returns empty only when no committed or original composition exists", async () => {
  const client = fakePreviewBaselineClient({
    order: fakeOrder({ packages: [] }),
  });

  const baseline = await resolveOrderCommitPreviewBaseline({
    orderId: "order-1",
    client: client.client,
  });

  assert.equal(baseline.baselineSource, ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.EMPTY);
  assert.equal(baseline.baselineCommitId, null);
  assert.equal(baseline.baselineSequence, null);
  assert.deepEqual(baseline.snapshot.lines, []);
  assert.equal(baseline.snapshot.totals.netTotal, 0);
});

test("preview original baseline blocks null original package price", async () => {
  const client = fakePreviewBaselineClient({
    order: fakeOrder({
      packages: [fakeOrderPackage({ originalPackagePriceSnapshot: null })],
    }),
  });

  await assert.rejects(
    resolveOrderCommitPreviewBaseline({
      orderId: "order-1",
      client: client.client,
    }),
    /unsafe original baseline data-integrity error.*missing original package price/i
  );
});

test("preview original baseline blocks missing original package name", async () => {
  const client = fakePreviewBaselineClient({
    order: fakeOrder({
      packages: [fakeOrderPackage({ originalPackageNameSnapshot: null })],
    }),
  });

  await assert.rejects(
    resolveOrderCommitPreviewBaseline({
      orderId: "order-1",
      client: client.client,
    }),
    /unsafe original baseline data-integrity error.*missing original package name/i
  );
});

test("preview original baseline blocks unresolved included photo count", async () => {
  const client = fakePreviewBaselineClient({
    order: fakeOrder({
      packages: [fakeOrderPackage({ originalIncludedPhotoCount: null })],
    }),
  });

  await assert.rejects(
    resolveOrderCommitPreviewBaseline({
      orderId: "order-1",
      client: client.client,
    }),
    /unsafe original baseline data-integrity error.*included-photo count/i
  );
});

test("preview original baseline blocks unsafe partial composition instead of empty fallback", async () => {
  const client = fakePreviewBaselineClient({
    order: fakeOrder({
      packages: [
        fakeOrderPackage({
          id: "order-package-safe",
          originalPackagePriceSnapshot: decimal("100.000"),
        }),
        fakeOrderPackage({
          id: "order-package-unsafe",
          originalPackagePriceSnapshot: null,
        }),
      ],
    }),
  });

  await assert.rejects(
    resolveOrderCommitPreviewBaseline({
      orderId: "order-1",
      client: client.client,
    }),
    /unsafe original baseline data-integrity error.*order-package-unsafe.*missing original package price/i
  );
});

test("preview baseline source avoids invoice rows and mutation-service imports", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "src/modules/order-commits/order-commit-preview-baseline.service.ts"
    ),
    "utf8"
  );

  assert.equal(/invoiceLineItem/i.test(source), false);
  assert.equal(
    /from\s+["'][^"']*(adjustment-workspace|invoice\.service|payment\.service|refund)[^"']*["']/i.test(
      source
    ),
    false
  );
  assert.equal(/\bcurrentPackageId:\s*true/.test(source), false);
  assert.equal(/\bcurrentPackageNameSnapshot:\s*true/.test(source), false);
  assert.equal(/\bfinalPackagePriceSnapshot:\s*true/.test(source), false);
  assert.equal(/\bselectedPhotoCount:\s*true/.test(source), false);
  assert.equal(/\bextraDigitalCount:\s*true/.test(source), false);
  assert.equal(/\bextraPrintCount:\s*true/.test(source), false);
  assert.equal(/\borderAddOns?\b|\baddOns?\s*:/.test(source), false);
  assert.equal(/\borderPackageItemUpgrades?\b|\bpackageItemUpgrades?\s*:/.test(source), false);
  assert.equal(
    /\borderPackageSessionConfigurationSelections?\b|\bsessionConfigurationSelections?\s*:/.test(
      source
    ),
    false
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
  metadataJson: Record<string, unknown>;
  committedAt: Date;
  committedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type FakeOrderPackage = {
  id: string;
  originalPackageId: string;
  currentPackageId: string;
  originalPackageNameSnapshot: string | null;
  currentPackageNameSnapshot: string;
  originalPackagePriceSnapshot: Prisma.Decimal | null;
  finalPackagePriceSnapshot: Prisma.Decimal | null;
  bookingPackageId: string | null;
  sessionTypeId: string;
  selectedPhotoCount: number;
  extraDigitalCount: number;
  extraPrintCount: number;
  sortOrder: number;
  createdAt: Date;
  originalPackage: { photoCount: number } | null;
  sessionType: { id: string; name: string };
};

type FakeOrder = {
  id: string;
  financialCaseId: string | null;
  packages: FakeOrderPackage[];
};

function fakePreviewBaselineClient({
  commits = [],
  order = fakeOrder({ packages: [fakeOrderPackage()] }),
}: {
  commits?: FakeOrderCommitRow[];
  order?: FakeOrder;
} = {}) {
  let orderFindUniqueCalls = 0;
  const root = {
    orderCommit: {
      findFirst: async (args: {
        where?: { orderId?: string; financialCaseId?: string };
      }) => {
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
    },
    order: {
      findUnique: async (args: { where: { id: string } }) => {
        orderFindUniqueCalls += 1;
        if (args.where.id !== order.id) return null;
        return {
          id: order.id,
          booking: {
            financialCase: order.financialCaseId
              ? { id: order.financialCaseId }
              : null,
          },
          packages: [...order.packages].sort(
            (left, right) =>
              left.sortOrder - right.sortOrder ||
              left.createdAt.getTime() - right.createdAt.getTime() ||
              left.id.localeCompare(right.id)
          ),
        };
      },
    },
  };

  return {
    get orderFindUniqueCalls() {
      return orderFindUniqueCalls;
    },
    client: root as unknown as NonNullable<
      ResolveOrderCommitPreviewBaselineInput["client"]
    >,
  };
}

function fakeOrder(input: {
  id?: string;
  financialCaseId?: string | null;
  packages: FakeOrderPackage[];
}): FakeOrder {
  return {
    id: input.id ?? "order-1",
    financialCaseId: input.financialCaseId ?? "financial-case-1",
    packages: input.packages,
  };
}

function fakeOrderPackage(
  overrides: Partial<
    Omit<FakeOrderPackage, "originalPackage"> & {
      originalIncludedPhotoCount: number | null;
    }
  > = {}
): FakeOrderPackage {
  const id = overrides.id ?? "order-package-1";
  const originalIncludedPhotoCount =
    overrides.originalIncludedPhotoCount === undefined
      ? 10
      : overrides.originalIncludedPhotoCount;

  return {
    id,
    originalPackageId: overrides.originalPackageId ?? `original-${id}`,
    currentPackageId: overrides.currentPackageId ?? `current-${id}`,
    originalPackageNameSnapshot:
      overrides.originalPackageNameSnapshot === undefined
        ? `Original ${id}`
        : overrides.originalPackageNameSnapshot,
    currentPackageNameSnapshot:
      overrides.currentPackageNameSnapshot ?? `Current ${id}`,
    originalPackagePriceSnapshot:
      overrides.originalPackagePriceSnapshot === undefined
        ? decimal("100.000")
        : overrides.originalPackagePriceSnapshot,
    finalPackagePriceSnapshot:
      overrides.finalPackagePriceSnapshot === undefined
        ? decimal("150.000")
        : overrides.finalPackagePriceSnapshot,
    bookingPackageId:
      overrides.bookingPackageId === undefined
        ? `booking-package-${id}`
        : overrides.bookingPackageId,
    sessionTypeId: overrides.sessionTypeId ?? "session-type-1",
    selectedPhotoCount: overrides.selectedPhotoCount ?? 10,
    extraDigitalCount: overrides.extraDigitalCount ?? 0,
    extraPrintCount: overrides.extraPrintCount ?? 0,
    sortOrder: overrides.sortOrder ?? 0,
    createdAt: overrides.createdAt ?? new Date("2026-06-01T08:00:00.000Z"),
    originalPackage:
      originalIncludedPhotoCount === null
        ? null
        : { photoCount: originalIncludedPhotoCount },
    sessionType: overrides.sessionType ?? {
      id: "session-type-1",
      name: "Portrait",
    },
  };
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
    snapshotJson: overrides.snapshotJson ?? fakeSnapshot({ netTotal: 0 }),
    metadataJson: overrides.metadataJson ?? {},
    committedAt: overrides.committedAt ?? now,
    committedByUserId: overrides.committedByUserId ?? "user-1",
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function fakeSnapshot({ netTotal }: { netTotal: number }): OrderCommitSnapshotV1 {
  return {
    schemaVersion: "order_commit_snapshot_v1",
    orderId: "order-1",
    financialCaseId: "financial-case-1",
    capturedAt: "2026-06-01T09:00:00.000Z",
    currency: "KWD",
    lines: [],
    totals: {
      subtotal: netTotal,
      discountTotal: 0,
      netTotal,
    },
  };
}

function requireLine(snapshot: OrderCommitSnapshotV1, stableKey: string) {
  const line = snapshot.lines.find((candidate) => candidate.stableKey === stableKey);
  assert.ok(line, `Expected snapshot line ${stableKey}`);
  return line;
}

function decimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}
