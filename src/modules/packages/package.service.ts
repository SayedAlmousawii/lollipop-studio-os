import { BookingStatus, OrderStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import { createPackageSchema, updatePackageSchema } from "./package.schema";
import type {
  CreatePackageInput,
  UpdatePackageInput,
} from "./package.schema";
import type {
  Package,
  PackageItem,
  PackageOption,
  PackageWithItems,
} from "./package.types";

type DbClient = typeof db | Prisma.TransactionClient;

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.CONFIRMED,
];

const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.ACTIVE,
  OrderStatus.WAITING_SELECTION,
  OrderStatus.SELECTION_COMPLETED,
  OrderStatus.EDITING,
  OrderStatus.PRODUCTION,
  OrderStatus.READY,
];

export class PackageNotFoundError extends Error {
  constructor() {
    super("Package not found.");
    this.name = "PackageNotFoundError";
  }
}

export class PackageArchiveBlockedError extends Error {
  constructor() {
    super("This package is used by active bookings or orders and cannot be archived yet.");
    this.name = "PackageArchiveBlockedError";
  }
}

export class PackageLockedInvoiceError extends Error {
  constructor() {
    super("Package commercial fields cannot be changed because locked invoices reference this package.");
    this.name = "PackageLockedInvoiceError";
  }
}

export class PackageProductNotFoundError extends Error {
  constructor() {
    super("One or more selected products are unavailable for package deliverables.");
    this.name = "PackageProductNotFoundError";
  }
}

export async function getPackages(): Promise<Package[]> {
  const rows = await withRetry(
    () =>
      db.package.findMany({
        include: {
          items: {
            include: { product: true },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
          bookings: {
            where: { status: { in: ACTIVE_BOOKING_STATUSES } },
            select: { id: true },
          },
          originalOrders: {
            where: { status: { in: ACTIVE_ORDER_STATUSES } },
            select: { id: true },
          },
          finalOrders: {
            where: { status: { in: ACTIVE_ORDER_STATUSES } },
            select: { id: true },
          },
          _count: {
            select: {
              bookings: true,
              originalOrders: true,
              finalOrders: true,
            },
          },
        },
        orderBy: { price: "asc" },
      }),
    "Failed to fetch packages"
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    price: formatPrice(row.price),
    priceValue: row.price.toNumber(),
    photoCount: row.photoCount,
    description: row.description ?? "",
    bundleAdjustment: formatSignedPrice(row.bundleAdjustment),
    bundleAdjustmentValue: row.bundleAdjustment.toNumber(),
    bookingCount: row._count.bookings,
    originalOrderCount: row._count.originalOrders,
    finalOrderCount: row._count.finalOrders,
    activeReferenceCount:
      row.bookings.length + row.originalOrders.length + row.finalOrders.length,
    totalReferenceCount:
      row._count.bookings + row._count.originalOrders + row._count.finalOrders,
    deliverableSummary: summarizePackageDeliverables(row),
    status: row.isActive ? "Active" : "Inactive",
    isActive: row.isActive,
    items: row.items.map(mapPackageItem),
  }));
}

export async function getActivePackageOptions(): Promise<PackageOption[]> {
  const rows = await withRetry(
    () =>
      db.package.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          price: true,
          photoCount: true,
        },
        orderBy: { price: "asc" },
      }),
    "Failed to fetch package options"
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    price: row.price.toNumber(),
    priceLabel: formatPrice(row.price),
    photoCount: row.photoCount,
  }));
}

export async function getPackageWithItems(id: string): Promise<PackageWithItems | null> {
  const row = await withRetry(
    () =>
      db.package.findUnique({
        where: { id },
        include: {
          items: {
            include: { product: true },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
          _count: {
            select: {
              bookings: true,
              originalOrders: true,
              finalOrders: true,
            },
          },
          bookings: {
            where: { status: { in: ACTIVE_BOOKING_STATUSES } },
            select: { id: true },
          },
          originalOrders: {
            where: { status: { in: ACTIVE_ORDER_STATUSES } },
            select: { id: true },
          },
          finalOrders: {
            where: { status: { in: ACTIVE_ORDER_STATUSES } },
            select: { id: true },
          },
        },
      }),
    "Failed to fetch package"
  );

  return row ? mapPackageWithItems(row) : null;
}

export async function createPackage(input: CreatePackageInput): Promise<{ id: string }> {
  const data = createPackageSchema.parse(input);

  return db.$transaction(async (tx) => {
    const items = await resolvePackageItems(tx, data.items);
    const price = decimal(data.price);
    const bundleAdjustment = calculateBundleAdjustment(price, items);

    return tx.package.create({
      data: {
        name: data.name,
        price,
        photoCount: data.photoCount,
        description: data.description,
        bundleAdjustment,
        items: {
          create: items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            priceSnapshot: item.priceSnapshot,
            sortOrder: item.sortOrder,
          })),
        },
      },
      select: { id: true },
    });
  });
}

export async function updatePackage(
  id: string,
  input: UpdatePackageInput
): Promise<{ id: string }> {
  const data = updatePackageSchema.parse(input);

  return db.$transaction(async (tx) => {
    const existing = await tx.package.findUnique({
      where: { id },
      include: {
        items: {
          select: {
            productId: true,
            quantity: true,
            priceSnapshot: true,
            sortOrder: true,
          },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
      },
    });

    if (!existing) {
      throw new PackageNotFoundError();
    }

    const items = await resolvePackageItems(tx, data.items);
    const price = decimal(data.price);
    if (hasCommercialFieldChanges(existing, price, data.photoCount, items)) {
      await assertNoLockedInvoicesForPackage(tx, id);
    }
    if (existing.isActive && !data.isActive) {
      await assertPackageCanBeArchived(tx, id);
    }

    const bundleAdjustment = calculateBundleAdjustment(price, items);

    await tx.packageItem.deleteMany({ where: { packageId: id } });

    return tx.package.update({
      where: { id },
      data: {
        name: data.name,
        price,
        photoCount: data.photoCount,
        description: data.description,
        isActive: data.isActive,
        bundleAdjustment,
        items: {
          create: items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            priceSnapshot: item.priceSnapshot,
            sortOrder: item.sortOrder,
          })),
        },
      },
      select: { id: true },
    });
  });
}

export async function archivePackage(id: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const packageRow = await tx.package.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!packageRow) {
      throw new PackageNotFoundError();
    }

    await assertPackageCanBeArchived(tx, id);

    const totalReferences = await getTotalReferenceCounts(tx, id);
    if (
      totalReferences.bookingCount > 0 ||
      totalReferences.originalOrderCount > 0 ||
      totalReferences.finalOrderCount > 0
    ) {
      await tx.package.update({
        where: { id },
        data: { isActive: false },
      });
      return;
    }

    await tx.package.delete({ where: { id } });
  });
}

async function resolvePackageItems(
  client: DbClient,
  items: CreatePackageInput["items"]
): Promise<ResolvedPackageItem[]> {
  if (items.length === 0) return [];

  const products = await client.product.findMany({
    where: {
      id: { in: items.map((item) => item.productId) },
      isActive: true,
      isPackageDeliverable: true,
    },
    select: {
      id: true,
      canonicalPrice: true,
    },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  if (productById.size !== items.length) {
    throw new PackageProductNotFoundError();
  }

  return items.map((item, index) => {
    const product = productById.get(item.productId);
    if (!product) {
      throw new PackageProductNotFoundError();
    }

    return {
      productId: item.productId,
      quantity: item.quantity,
      priceSnapshot:
        item.priceSnapshot === undefined
          ? product.canonicalPrice
          : decimal(item.priceSnapshot),
      sortOrder: item.sortOrder ?? index,
    };
  });
}

function calculateBundleAdjustment(
  packagePrice: Prisma.Decimal,
  items: ResolvedPackageItem[]
): Prisma.Decimal {
  const itemTotal = items.reduce(
    (total, item) => total.plus(item.priceSnapshot.mul(item.quantity)),
    new Prisma.Decimal(0)
  );
  return packagePrice.minus(itemTotal);
}

async function assertNoLockedInvoicesForPackage(
  client: DbClient,
  packageId: string
): Promise<void> {
  const lockedInvoice = await client.invoice.findFirst({
    where: {
      isLocked: true,
      OR: [
        {
          order: {
            OR: [
              { originalPackageId: packageId },
              { finalPackageId: packageId },
            ],
          },
        },
        { booking: { packageId } },
      ],
    },
    select: { id: true },
  });

  if (lockedInvoice) {
    throw new PackageLockedInvoiceError();
  }
}

async function assertPackageCanBeArchived(
  client: DbClient,
  packageId: string
): Promise<void> {
  const activeReferences = await getActiveReferenceCounts(client, packageId);
  if (
    activeReferences.activeBookingCount > 0 ||
    activeReferences.activeOriginalOrderCount > 0 ||
    activeReferences.activeFinalOrderCount > 0
  ) {
    throw new PackageArchiveBlockedError();
  }
}

async function getActiveReferenceCounts(client: DbClient, packageId: string) {
  const [activeBookingCount, activeOriginalOrderCount, activeFinalOrderCount] =
    await Promise.all([
      client.booking.count({
        where: {
          packageId,
          status: { in: ACTIVE_BOOKING_STATUSES },
        },
      }),
      client.order.count({
        where: {
          originalPackageId: packageId,
          status: { in: ACTIVE_ORDER_STATUSES },
        },
      }),
      client.order.count({
        where: {
          finalPackageId: packageId,
          status: { in: ACTIVE_ORDER_STATUSES },
        },
      }),
    ]);

  return { activeBookingCount, activeOriginalOrderCount, activeFinalOrderCount };
}

async function getTotalReferenceCounts(client: DbClient, packageId: string) {
  const [bookingCount, originalOrderCount, finalOrderCount] = await Promise.all([
    client.booking.count({ where: { packageId } }),
    client.order.count({ where: { originalPackageId: packageId } }),
    client.order.count({ where: { finalPackageId: packageId } }),
  ]);

  return { bookingCount, originalOrderCount, finalOrderCount };
}

function hasCommercialFieldChanges(
  existing: {
    price: Prisma.Decimal;
    photoCount: number;
    items: Array<{
      productId: string;
      quantity: number;
      priceSnapshot: Prisma.Decimal;
      sortOrder: number;
    }>;
  },
  price: Prisma.Decimal,
  photoCount: number,
  items: ResolvedPackageItem[]
): boolean {
  if (!existing.price.equals(price)) return true;
  if (existing.photoCount !== photoCount) return true;

  const existingItems = [...existing.items].sort(comparePackageItems);
  const nextItems = [...items].sort(comparePackageItems);
  if (existingItems.length !== nextItems.length) return true;

  return existingItems.some((item, index) => {
    const nextItem = nextItems[index];
    return (
      item.productId !== nextItem.productId ||
      item.quantity !== nextItem.quantity ||
      !item.priceSnapshot.equals(nextItem.priceSnapshot) ||
      item.sortOrder !== nextItem.sortOrder
    );
  });
}

function comparePackageItems(
  a: { productId: string },
  b: { productId: string }
): number {
  return a.productId.localeCompare(b.productId);
}

function mapPackageWithItems(row: PackageWithItemsRow): PackageWithItems {
  return {
    id: row.id,
    name: row.name,
    price: formatPrice(row.price),
    priceValue: row.price.toNumber(),
    photoCount: row.photoCount,
    description: row.description ?? "",
    bundleAdjustment: formatSignedPrice(row.bundleAdjustment),
    bundleAdjustmentValue: row.bundleAdjustment.toNumber(),
    bookingCount: row._count.bookings,
    originalOrderCount: row._count.originalOrders,
    finalOrderCount: row._count.finalOrders,
    activeReferenceCount:
      row.bookings.length + row.originalOrders.length + row.finalOrders.length,
    totalReferenceCount:
      row._count.bookings + row._count.originalOrders + row._count.finalOrders,
    deliverableSummary: summarizePackageDeliverables(row),
    status: row.isActive ? "Active" : "Inactive",
    isActive: row.isActive,
    items: row.items.map(mapPackageItem),
  };
}

function mapPackageItem(row: PackageItemRow): PackageItem {
  return {
    id: row.id,
    productId: row.productId,
    productName: row.product.name,
    productCategory: row.product.category,
    quantity: row.quantity,
    priceSnapshot: formatPrice(row.priceSnapshot),
    priceSnapshotValue: row.priceSnapshot.toNumber(),
    lineTotal: formatPrice(row.priceSnapshot.mul(row.quantity)),
    lineTotalValue: row.priceSnapshot.mul(row.quantity).toNumber(),
    sortOrder: row.sortOrder,
  };
}

function summarizePackageDeliverables(row: {
  photoCount: number;
  items: Array<{
    quantity: number;
    product: { name: string };
  }>;
}): string {
  const parts = row.items.map(
    (item) => `${item.quantity}x ${item.product.name}`
  );

  if (row.photoCount > 0) {
    parts.push(`${row.photoCount} Photos`);
  }

  return parts.length > 0 ? parts.join(" · ") : "No deliverables set";
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(3));
}

function formatPrice(value: { toFixed(dp: number): string }): string {
  return value.toFixed(3) + " KD";
}

function formatSignedPrice(value: Prisma.Decimal): string {
  const sign = value.isNegative() ? "-" : "+";
  return `${sign}${value.abs().toFixed(3)} KD`;
}

interface ResolvedPackageItem {
  productId: string;
  quantity: number;
  priceSnapshot: Prisma.Decimal;
  sortOrder: number;
}

type PackageWithItemsRow = Prisma.PackageGetPayload<{
  include: {
    items: {
      include: { product: true };
    };
    _count: {
      select: {
        bookings: true;
        originalOrders: true;
        finalOrders: true;
      };
    };
    bookings: {
      where: { status: { in: typeof ACTIVE_BOOKING_STATUSES } };
      select: { id: true };
    };
    originalOrders: {
      where: { status: { in: typeof ACTIVE_ORDER_STATUSES } };
      select: { id: true };
    };
    finalOrders: {
      where: { status: { in: typeof ACTIVE_ORDER_STATUSES } };
      select: { id: true };
    };
  };
}>;

type PackageItemRow = PackageWithItemsRow["items"][number];
