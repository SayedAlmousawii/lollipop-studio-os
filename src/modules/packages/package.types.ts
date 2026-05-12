import type { ProductCategory } from "@prisma/client";

export type PackageStatus = "Active" | "Inactive";

export interface Package {
  id: string;
  name: string;
  price: string;
  priceValue: number;
  photoCount: number;
  durationMinutes: number;
  description: string;
  packageFamilyId: string;
  packageFamilyName: string;
  sessionTypeId: string;
  sessionTypeName: string;
  departmentId: string;
  departmentName: string;
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
  durationMinutes?: number;
}

export interface PackageFilters {
  departmentId?: string;
  sessionTypeId?: string;
}

export interface PackageTaxonomyOptions {
  departments: Array<{
    id: string;
    name: string;
    code: string;
    sessionTypes: Array<{
      id: string;
      name: string;
      code: string;
      packageFamilies: Array<{
        id: string;
        name: string;
        code: string;
      }>;
    }>;
  }>;
}

export interface PackageSessionType {
  sessionTypeId: string;
  sessionTypeCode: string;
  departmentId: string;
  departmentCode: string;
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
