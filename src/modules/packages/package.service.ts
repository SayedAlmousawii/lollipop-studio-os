import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import type { Package, PackageOption } from "./package.types";

export async function getPackages(): Promise<Package[]> {
  const rows = await withRetry(
    () =>
      db.package.findMany({
        include: {
          _count: { select: { bookings: true } },
        },
        orderBy: { price: "asc" },
      }),
    "Failed to fetch packages"
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    price: formatPrice(row.price),
    photoCount: row.photoCount,
    description: row.description ?? "—",
    bookingCount: row._count.bookings,
    status: row.isActive ? "Active" : "Inactive",
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

function formatPrice(value: { toFixed(dp: number): string }): string {
  return value.toFixed(3) + " KD";
}
