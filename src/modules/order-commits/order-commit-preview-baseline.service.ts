import { Prisma, type PrismaClient } from "@prisma/client";
import {
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_CURRENCY,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
  ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
} from "./order-commit.constants";
import { ORDER_COMMIT_PREVIEW_BASELINE_SOURCE } from "./order-commit-preview.constants";
import { orderCommitSnapshotV1Schema } from "./order-commit.schema";
import { orderCommitPreviewBaselineSchema } from "./order-commit-preview.schema";
import { getLatestCommittedOrderSnapshot } from "./order-commit.service";
import type { OrderCommitPreviewBaseline } from "./order-commit-preview.types";
import type {
  OrderCommitSnapshotLineV1,
  OrderCommitSnapshotV1,
} from "./order-commit.types";

export type OrderCommitPreviewBaselineClient =
  | Pick<PrismaClient, "order" | "orderCommit">
  | Pick<Prisma.TransactionClient, "order" | "orderCommit">;

export type ResolveOrderCommitPreviewBaselineInput = {
  orderId: string;
  client?: OrderCommitPreviewBaselineClient;
};

const originalBaselineOrderSelect = {
  id: true,
  booking: {
    select: {
      financialCase: { select: { id: true } },
    },
  },
  packages: {
    select: {
      id: true,
      originalPackageId: true,
      originalPackageNameSnapshot: true,
      originalPackagePriceSnapshot: true,
      bookingPackageId: true,
      sessionTypeId: true,
      sortOrder: true,
      createdAt: true,
      originalPackage: {
        select: {
          photoCount: true,
        },
      },
      sessionType: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.OrderSelect;

type OriginalBaselineOrder = Prisma.OrderGetPayload<{
  select: typeof originalBaselineOrderSelect;
}>;

type OriginalBaselineOrderPackage = OriginalBaselineOrder["packages"][number];

export async function resolveOrderCommitPreviewBaseline(
  input: ResolveOrderCommitPreviewBaselineInput
): Promise<OrderCommitPreviewBaseline> {
  const client = input.client ?? (await loadDefaultOrderCommitPreviewBaselineClient());

  const latest = await getLatestCommittedOrderSnapshot({
    orderId: input.orderId,
    client,
  });
  if (latest) {
    return orderCommitPreviewBaselineSchema.parse({
      baselineSource: ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT,
      baselineCommitId: latest.commit.id,
      baselineSequence: latest.commit.sequence,
      snapshot: latest.snapshot,
    });
  }

  const order = await client.order.findUnique({
    where: { id: input.orderId },
    select: originalBaselineOrderSelect,
  });
  if (!order) {
    throw new Error(
      `OrderCommit preview baseline failed: order ${input.orderId} was not found.`
    );
  }

  const financialCaseId = order.booking.financialCase?.id;
  if (!financialCaseId) {
    throw new Error(
      `OrderCommit preview baseline failed: order ${input.orderId} has no FinancialCase.`
    );
  }

  const snapshot =
    order.packages.length > 0
      ? originalCompositionBaselineSnapshot(order, financialCaseId)
      : emptyBaselineSnapshot(order.id, financialCaseId);

  return orderCommitPreviewBaselineSchema.parse({
    baselineSource:
      order.packages.length > 0
        ? ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.ORIGINAL_ORDER_COMPOSITION
        : ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.EMPTY,
    baselineCommitId: null,
    baselineSequence: null,
    snapshot,
  });
}

function originalCompositionBaselineSnapshot(
  order: OriginalBaselineOrder,
  financialCaseId: string
): OrderCommitSnapshotV1 {
  const lines = order.packages.map((orderPackage) =>
    originalPackageLine(order.id, orderPackage)
  );
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.lineTotal, 0));

  return orderCommitSnapshotV1Schema.parse({
    schemaVersion: ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
    orderId: order.id,
    financialCaseId,
    capturedAt: new Date().toISOString(),
    currency: ORDER_COMMIT_SNAPSHOT_CURRENCY,
    lines,
    totals: {
      subtotal,
      discountTotal: 0,
      netTotal: subtotal,
    },
  });
}

function emptyBaselineSnapshot(
  orderId: string,
  financialCaseId: string
): OrderCommitSnapshotV1 {
  return orderCommitSnapshotV1Schema.parse({
    schemaVersion: ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
    orderId,
    financialCaseId,
    capturedAt: new Date().toISOString(),
    currency: ORDER_COMMIT_SNAPSHOT_CURRENCY,
    lines: [],
    totals: {
      subtotal: 0,
      discountTotal: 0,
      netTotal: 0,
    },
  });
}

function originalPackageLine(
  orderId: string,
  orderPackage: OriginalBaselineOrderPackage
): OrderCommitSnapshotLineV1 {
  const unitPrice = originalPackagePrice(orderId, orderPackage);
  const originalPackageName = originalPackageNameSnapshot(orderId, orderPackage);
  const includedPhotoCount = originalIncludedPhotoCount(orderId, orderPackage);

  return {
    lineId: `package:${orderPackage.id}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE,
    orderEntityId: orderPackage.id,
    parentOrderPackageId: null,
    catalogEntityId: orderPackage.originalPackageId,
    stableKey: `order-package:${orderPackage.id}`,
    label: originalPackageName,
    quantity: 1,
    unitPrice,
    lineTotal: unitPrice,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      originalPackageId: orderPackage.originalPackageId,
      originalPackageNameSnapshot: originalPackageName,
      originalPackagePriceSnapshot: unitPrice,
      bookingPackageId: orderPackage.bookingPackageId,
      selectedPhotoCount: includedPhotoCount,
      includedPhotoCount,
      extraDigitalCount: 0,
      extraPrintCount: 0,
      sessionTypeId: orderPackage.sessionType.id,
      sessionTypeName: orderPackage.sessionType.name,
      sortOrder: orderPackage.sortOrder,
    },
  };
}

function originalPackagePrice(
  orderId: string,
  orderPackage: OriginalBaselineOrderPackage
): number {
  if (!orderPackage.originalPackagePriceSnapshot) {
    throw unsafeOriginalBaselineError(
      orderId,
      orderPackage.id,
      "missing original package price snapshot"
    );
  }
  return money(orderPackage.originalPackagePriceSnapshot);
}

function originalPackageNameSnapshot(
  orderId: string,
  orderPackage: OriginalBaselineOrderPackage
): string {
  if (
    typeof orderPackage.originalPackageNameSnapshot !== "string" ||
    orderPackage.originalPackageNameSnapshot.trim().length === 0
  ) {
    throw unsafeOriginalBaselineError(
      orderId,
      orderPackage.id,
      "missing original package name snapshot"
    );
  }
  return orderPackage.originalPackageNameSnapshot;
}

function originalIncludedPhotoCount(
  orderId: string,
  orderPackage: OriginalBaselineOrderPackage
): number {
  const includedPhotoCount = orderPackage.originalPackage?.photoCount;
  if (!Number.isInteger(includedPhotoCount) || includedPhotoCount < 0) {
    throw unsafeOriginalBaselineError(
      orderId,
      orderPackage.id,
      "missing original package included-photo count"
    );
  }
  return includedPhotoCount;
}

function unsafeOriginalBaselineError(
  orderId: string,
  orderPackageId: string,
  reason: string
): Error {
  return new Error(
    `OrderCommit preview baseline failed: unsafe original baseline data-integrity error for order ${orderId}, order package ${orderPackageId}: ${reason}.`
  );
}

async function loadDefaultOrderCommitPreviewBaselineClient(): Promise<OrderCommitPreviewBaselineClient> {
  const { db } = await import("@/lib/db");
  return db;
}

function money(value: Prisma.Decimal): number {
  return roundMoney(value.toNumber());
}

function roundMoney(value: number): number {
  return Number(value.toFixed(3));
}
