import type { ProductCategory } from "@prisma/client";

export type PackageStatus = "Active" | "Inactive";

export interface Package {
  id: string;
  name: string;
  price: string;
  priceValue: number;
  photoCount: number;
  description: string;
  bundleAdjustment: string;
  bundleAdjustmentValue: number;
  bookingCount: number;
  status: PackageStatus;
  isActive: boolean;
}

export interface PackageOption {
  id: string;
  name: string;
  price: number;
  priceLabel: string;
  photoCount: number;
}

export interface PackageItem {
  id: string;
  productId: string;
  productName: string;
  productCategory: ProductCategory;
  quantity: number;
  priceSnapshot: string;
  priceSnapshotValue: number;
  lineTotal: string;
  lineTotalValue: number;
  sortOrder: number;
}

export interface PackageWithItems extends Package {
  originalOrderCount: number;
  finalOrderCount: number;
  items: PackageItem[];
}
