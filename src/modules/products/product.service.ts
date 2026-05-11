import { Prisma, ProductCategory } from "@prisma/client";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import { PRODUCT_CATEGORY_LABELS, PRODUCT_CATEGORY_OPTIONS } from "./product.constants";
import { createProductSchema, updateProductSchema } from "./product.schema";
import type {
  CreateProductInput,
  UpdateProductInput,
} from "./product.schema";
import type {
  GroupedProductOptions,
  Product,
  ProductOption,
} from "./product.types";

export class ProductArchiveBlockedError extends Error {
  constructor() {
    super("This product is used by active packages and cannot be archived yet.");
    this.name = "ProductArchiveBlockedError";
  }
}

export class ProductNotFoundError extends Error {
  constructor() {
    super("Product not found.");
    this.name = "ProductNotFoundError";
  }
}

export async function getProducts(): Promise<Product[]> {
  const rows = await withRetry(
    () =>
      db.product.findMany({
        include: {
          packageItems: {
            select: {
              package: { select: { isActive: true } },
            },
          },
          _count: { select: { packageItems: true } },
        },
        orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      }),
    "Failed to fetch products"
  );

  return rows.map((row) => {
    const activePackageItemCount = row.packageItems.filter(
      (item) => item.package.isActive
    ).length;

    return {
      id: row.id,
      name: row.name,
      category: row.category,
      categoryLabel: PRODUCT_CATEGORY_LABELS[row.category],
      canonicalPrice: formatPrice(row.canonicalPrice),
      canonicalPriceValue: row.canonicalPrice.toNumber(),
      description: row.description ?? "",
      packageItemCount: row._count.packageItems,
      activePackageItemCount,
      status: row.isActive ? "Active" : "Inactive",
      isActive: row.isActive,
      isPackageDeliverable: row.isPackageDeliverable,
      isAddOn: row.isAddOn,
    };
  });
}

export async function getActiveProductOptions(): Promise<GroupedProductOptions[]> {
  const rows = await withRetry(
    () =>
      db.product.findMany({
        where: { isActive: true, isPackageDeliverable: true },
        select: {
          id: true,
          name: true,
          category: true,
          canonicalPrice: true,
        },
        orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      }),
    "Failed to fetch product options"
  );

  const optionsByCategory = new Map<ProductCategory, ProductOption[]>();
  for (const category of PRODUCT_CATEGORY_OPTIONS) {
    optionsByCategory.set(category, []);
  }

  for (const row of rows) {
    optionsByCategory.get(row.category)?.push({
      id: row.id,
      name: row.name,
      category: row.category,
      categoryLabel: PRODUCT_CATEGORY_LABELS[row.category],
      canonicalPrice: row.canonicalPrice.toNumber(),
      canonicalPriceLabel: formatPrice(row.canonicalPrice),
    });
  }

  return PRODUCT_CATEGORY_OPTIONS.map((category) => ({
    category,
    categoryLabel: PRODUCT_CATEGORY_LABELS[category],
    options: optionsByCategory.get(category) ?? [],
  })).filter((group) => group.options.length > 0);
}

export async function createProduct(input: CreateProductInput) {
  const data = createProductSchema.parse(input);

  return db.product.create({
    data: {
      name: data.name,
      category: data.category,
      canonicalPrice: decimal(data.canonicalPrice),
      description: data.description,
      isPackageDeliverable: data.isPackageDeliverable,
      isAddOn: data.isAddOn,
    },
    select: { id: true },
  });
}

export async function updateProduct(
  id: string,
  input: UpdateProductInput
) {
  const data = updateProductSchema.parse(input);

  try {
    return await db.product.update({
      where: { id },
      data: {
        name: data.name,
        category: data.category,
        canonicalPrice: decimal(data.canonicalPrice),
        description: data.description,
        isActive: data.isActive,
        isPackageDeliverable: data.isPackageDeliverable,
        isAddOn: data.isAddOn,
      },
      select: { id: true },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      throw new ProductNotFoundError();
    }
    throw error;
  }
}

export async function archiveProduct(id: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id },
      select: {
        id: true,
        packageItems: {
          select: {
            package: { select: { isActive: true } },
          },
        },
        _count: { select: { orderAddOns: true } },
      },
    });

    if (!product) {
      throw new ProductNotFoundError();
    }

    const hasActivePackageReferences = product.packageItems.some(
      (item) => item.package.isActive
    );

    if (hasActivePackageReferences) {
      throw new ProductArchiveBlockedError();
    }

    if (product.packageItems.length > 0 || product._count.orderAddOns > 0) {
      await tx.product.update({
        where: { id },
        data: { isActive: false },
      });
      return;
    }

    await tx.product.delete({ where: { id } });
  });
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(3));
}

function formatPrice(value: { toFixed(dp: number): string }): string {
  return value.toFixed(3) + " KD";
}
