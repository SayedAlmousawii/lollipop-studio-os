import { ProductCategory } from "@prisma/client";
import { z } from "zod";

const priceSchema = z.preprocess(
  (value) => {
    if (value === "") return undefined;
    if (typeof value === "number") return value.toFixed(3);
    return value;
  },
  z
    .string({
      error: "Canonical price is required",
    })
    .trim()
    .regex(/^\d+(\.\d{1,3})?$/, "Use a valid price with up to 3 decimals")
    .transform((value) => Number(value))
    .pipe(
      z
        .number()
        .min(0, "Canonical price cannot be negative")
        .max(9999999.999, "Canonical price is too high")
    )
);

const productSchemaFields = {
  name: z
    .string()
    .trim()
    .min(1, "Product name is required")
    .max(120, "Product name must be 120 characters or fewer"),
  category: z.nativeEnum(ProductCategory, {
    error: "Select a valid product category",
  }),
  canonicalPrice: priceSchema,
  description: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .trim()
      .max(1000, "Description must be 1000 characters or fewer")
      .optional()
  ),
  isPackageDeliverable: z.preprocess(
    (value) => value === "on" || value === true,
    z.boolean()
  ),
  isAddOn: z.preprocess(
    (value) => value === "on" || value === true,
    z.boolean()
  ),
};

const baseProductSchema = z.object(productSchemaFields);

export const createProductSchema = baseProductSchema.refine(
  (value) => value.isPackageDeliverable || value.isAddOn,
  {
    message: "Select at least one product capability",
    path: ["isPackageDeliverable"],
  }
);

export const updateProductSchema = baseProductSchema.extend({
  ...productSchemaFields,
  isActive: z.preprocess(
    (value) => value === "on" || value === true,
    z.boolean()
  ),
}).refine(
  (value) => value.isPackageDeliverable || value.isAddOn,
  {
    message: "Select at least one product capability",
    path: ["isPackageDeliverable"],
  }
);

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
