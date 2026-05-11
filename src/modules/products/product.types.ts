import type { ProductCategory } from "@prisma/client";

export type ProductStatus = "Active" | "Inactive";

export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  categoryLabel: string;
  canonicalPrice: string;
  canonicalPriceValue: number;
  description: string;
  packageItemCount: number;
  activePackageItemCount: number;
  status: ProductStatus;
  isActive: boolean;
}

export interface ProductOption {
  id: string;
  name: string;
  category: ProductCategory;
  categoryLabel: string;
  canonicalPrice: number;
  canonicalPriceLabel: string;
}

export interface GroupedProductOptions {
  category: ProductCategory;
  categoryLabel: string;
  options: ProductOption[];
}
