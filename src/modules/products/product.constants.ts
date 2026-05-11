import type { ProductCategory } from "@prisma/client";

export const PRODUCT_CATEGORY_LABELS = {
  ALBUM: "Album",
  CANVAS: "Canvas",
  DIGITAL: "Digital",
  PRINT: "Print",
  FRAME: "Frame",
  USB: "USB",
  OTHER: "Other",
} as const satisfies Record<ProductCategory, string>;

export const PRODUCT_CATEGORY_OPTIONS = [
  "ALBUM",
  "CANVAS",
  "DIGITAL",
  "PRINT",
  "FRAME",
  "USB",
  "OTHER",
] as const satisfies readonly ProductCategory[];
