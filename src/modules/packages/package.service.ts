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
  PackageFilters,
  PackageItem,
  PackageOption,
  PackageSessionType,
  PackageTaxonomyOptions,
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

export class PackageFamilyNotFoundError extends Error {
  constructor() {
    super("Package family not found.");
    this.name = "PackageFamilyNotFoundError";
  }
}

export async function getPackages(filters: PackageFilters = {}): Promise<Package[]> {
  const rows = await withRetry(
    () =>
      db.package.findMany({
        where: packageWhere(filters),
        include: {
          packageFamily: {
            include: {
              sessionType: {
                include: { department: true },
              },
            },
          },
          items: {
            include: { product: true },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
          _count: {
            select: {
              bookingPackages: true,
              orderPackages: true,
            },
          },
        },
        orderBy: [
          { packageFamily: { sortOrder: "asc" } },
          { packageFamily: { name: "asc" } },
          { name: "asc" },
        ],
      }),
    "Failed to fetch packages"
  );

  const activeReferenceCounts = await getActiveReferenceCountsByPackageId(
    rows.map((row) => row.id)
  );

  return rows.map((row) =>
    mapPackageWithItems(row, activeReferenceCounts.get(row.id) ?? 0)
  );
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
          durationMinutes: true,
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
    durationMinutes: row.durationMinutes,
  }));
}

export async function getPackageWithItems(id: string): Promise<PackageWithItems | null> {
  const row = await withRetry(
    () =>
      db.package.findUnique({
        where: { id },
        include: {
          packageFamily: {
            include: {
              sessionType: {
                include: { department: true },
              },
            },
          },
          items: {
            include: { product: true },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
          _count: {
            select: {
              bookingPackages: true,
              orderPackages: true,
            },
          },
        },
      }),
    "Failed to fetch package"
  );

  if (!row) return null;

  const activeReferenceCounts = await getActiveReferenceCountsByPackageId([row.id]);
  return mapPackageWithItems(row, activeReferenceCounts.get(row.id) ?? 0);
}

export async function createPackage(input: CreatePackageInput): Promise<{ id: string }> {
  const data = createPackageSchema.parse(input);

  return db.$transaction(async (tx) => {
    await assertActivePackageFamily(tx, data.packageFamilyId);
    const items = await resolvePackageItems(tx, data.items);
    const price = decimal(data.price);
    const bundleAdjustment = calculateBundleAdjustment(price, items);

    return tx.package.create({
      data: {
        name: data.name,
        packageFamilyId: data.packageFamilyId,
        durationMinutes: data.durationMinutes,
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
    await lockPackageForUpdate(tx, id);

    const existing = await tx.package.findUnique({
      where: { id },
      include: {
        packageFamily: true,
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

    await assertActivePackageFamily(tx, data.packageFamilyId);
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
        packageFamilyId: data.packageFamilyId,
        durationMinutes: data.durationMinutes,
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
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function getPackageTaxonomyOptions(): Promise<PackageTaxonomyOptions> {
  const departments = await withRetry(
    () =>
      db.studioDepartment.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          code: true,
          sessionTypes: {
            where: { isActive: true },
            select: {
              id: true,
              name: true,
              code: true,
              packageFamilies: {
                where: { isActive: true },
                select: {
                  id: true,
                  name: true,
                  code: true,
                },
                orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
              },
            },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          },
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
    "Failed to fetch package taxonomy options"
  );

  return { departments };
}

export async function getPackageSessionType(
  packageId: string
): Promise<PackageSessionType> {
  const row = await withRetry(
    () =>
      db.package.findUnique({
        where: { id: packageId },
        select: {
          packageFamily: {
            select: {
              sessionType: {
                select: {
                  id: true,
                  code: true,
                  department: {
                    select: {
                      id: true,
                      code: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
    "Failed to fetch package session type"
  );

  if (!row) {
    throw new PackageNotFoundError();
  }

  return {
    sessionTypeId: row.packageFamily.sessionType.id,
    sessionTypeCode: row.packageFamily.sessionType.code,
    departmentId: row.packageFamily.sessionType.department.id,
    departmentCode: row.packageFamily.sessionType.department.code,
  };
}

export function parsePackageFilters(
  params: Record<string, string | string[] | undefined>
): PackageFilters {
  const departmentId = singleValue(params.departmentId)?.trim();
  const sessionTypeId = singleValue(params.sessionTypeId)?.trim();

  return {
    departmentId: departmentId && departmentId !== "all" ? departmentId : undefined,
    sessionTypeId: sessionTypeId && sessionTypeId !== "all" ? sessionTypeId : undefined,
  };
}

export async function archivePackage(id: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await lockPackageForUpdate(tx, id);

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
      totalReferences.orderCount > 0
    ) {
      await tx.package.update({
        where: { id },
        data: { isActive: false },
      });
      return;
    }

    await tx.package.delete({ where: { id } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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

async function assertActivePackageFamily(
  client: DbClient,
  packageFamilyId: string
): Promise<void> {
  const family = await client.packageFamily.findFirst({
    where: { id: packageFamilyId, isActive: true },
    select: { id: true },
  });

  if (!family) {
    throw new PackageFamilyNotFoundError();
  }
}

function packageWhere(filters: PackageFilters): Prisma.PackageWhereInput {
  return {
    packageFamily: {
      ...(filters.sessionTypeId
        ? { sessionTypeId: filters.sessionTypeId }
        : filters.departmentId
          ? { sessionType: { departmentId: filters.departmentId } }
          : {}),
    },
  };
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
            packages: { some: { packageId } },
          },
        },
        { booking: { packages: { some: { packageId } } } },
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
    activeReferences.activeOrderCount > 0
  ) {
    throw new PackageArchiveBlockedError();
  }
}

async function lockPackageForUpdate(
  client: Prisma.TransactionClient,
  packageId: string
): Promise<void> {
  await client.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "packages" WHERE id = ${packageId} FOR UPDATE
  `;
}

async function getActiveReferenceCounts(client: DbClient, packageId: string) {
  const [activeBookingCount, activeOrderCount] = await Promise.all([
    client.bookingPackage.count({
      where: {
        packageId,
        booking: { status: { in: ACTIVE_BOOKING_STATUSES } },
      },
    }),
    client.orderPackage.count({
      where: {
        packageId,
        order: { status: { in: ACTIVE_ORDER_STATUSES } },
      },
    }),
  ]);

  return { activeBookingCount, activeOrderCount };
}

async function getTotalReferenceCounts(client: DbClient, packageId: string) {
  const [bookingCount, orderCount] = await Promise.all([
    client.bookingPackage.count({ where: { packageId } }),
    client.orderPackage.count({ where: { packageId } }),
  ]);

  return { bookingCount, orderCount };
}

async function getActiveReferenceCountsByPackageId(
  packageIds: string[]
): Promise<Map<string, number>> {
  if (packageIds.length === 0) return new Map();

  const [bookingCounts, orderCounts] = await Promise.all([
    db.bookingPackage.groupBy({
      by: ["packageId"],
      where: {
        packageId: { in: packageIds },
        booking: { status: { in: ACTIVE_BOOKING_STATUSES } },
      },
      _count: { _all: true },
    }),
    db.orderPackage.groupBy({
      by: ["packageId"],
      where: {
        packageId: { in: packageIds },
        order: { status: { in: ACTIVE_ORDER_STATUSES } },
      },
      _count: { _all: true },
    }),
  ]);

  const counts = new Map<string, number>();
  for (const row of bookingCounts) {
    counts.set(row.packageId, row._count._all);
  }
  for (const row of orderCounts) {
    counts.set(row.packageId, (counts.get(row.packageId) ?? 0) + row._count._all);
  }
  return counts;
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

function mapPackageWithItems(
  row: PackageWithItemsRow,
  activeReferenceCount: number
): PackageWithItems {
  return {
    id: row.id,
    name: row.name,
    price: formatPrice(row.price),
    priceValue: row.price.toNumber(),
    photoCount: row.photoCount,
    durationMinutes: row.durationMinutes,
    description: row.description ?? "",
    packageFamilyId: row.packageFamilyId,
    packageFamilyName: row.packageFamily.name,
    sessionTypeId: row.packageFamily.sessionType.id,
    sessionTypeName: row.packageFamily.sessionType.name,
    departmentId: row.packageFamily.sessionType.department.id,
    departmentName: row.packageFamily.sessionType.department.name,
    bundleAdjustment: formatSignedPrice(row.bundleAdjustment),
    bundleAdjustmentValue: row.bundleAdjustment.toNumber(),
    bookingCount: row._count.bookingPackages,
    orderCount: row._count.orderPackages,
    activeReferenceCount,
    totalReferenceCount:
      row._count.bookingPackages + row._count.orderPackages,
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
    packageFamily: {
      include: {
        sessionType: {
          include: { department: true };
        };
      };
    };
    items: {
      include: { product: true };
    };
    _count: {
      select: {
        bookingPackages: true;
        orderPackages: true;
      };
    };
  };
}>;

type PackageItemRow = PackageWithItemsRow["items"][number];

function singleValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
