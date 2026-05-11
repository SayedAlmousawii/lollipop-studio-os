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
  originalOrderCount: number;
  finalOrderCount: number;
  activeReferenceCount: number;
  totalReferenceCount: number;
  deliverableSummary: string;
  status: PackageStatus;
  isActive: boolean;
  items: PackageItem[];
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

export type PackageWithItems = Package;
