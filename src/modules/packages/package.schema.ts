import { z } from "zod";

const moneySchema = (fieldName: string) =>
  z.preprocess(
    (value) => {
      if (value === "") return undefined;
      if (typeof value === "number") return value.toFixed(3);
      return value;
    },
    z
      .string({ error: `${fieldName} is required` })
      .trim()
      .regex(/^\d+(\.\d{1,3})?$/, `Use a valid ${fieldName.toLowerCase()} with up to 3 decimals`)
      .transform((value) => Number(value))
      .pipe(
        z
          .number()
          .min(0, `${fieldName} cannot be negative`)
          .max(9999999.999, `${fieldName} is too high`)
      )
  );

const packageItemSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  quantity: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce
      .number({ error: "Quantity is required" })
      .int("Quantity must be a whole number")
      .min(1, "Quantity must be at least 1")
      .max(999, "Quantity is too high")
  ),
  priceSnapshot: moneySchema("Price snapshot").optional(),
  sortOrder: z.preprocess(
    (value) => (value === "" || value === undefined ? 0 : value),
    z.coerce
      .number()
      .int("Sort order must be a whole number")
      .min(0, "Sort order cannot be negative")
      .max(9999, "Sort order is too high")
  ),
});

const basePackageSchema = z.object({
  packageFamilyId: z
    .string()
    .trim()
    .min(1, "Package family is required")
    .cuid("Package family is invalid"),
  durationMinutes: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce
      .number({ error: "Session duration is required" })
      .int("Session duration must be a whole number")
      .positive("Session duration must be greater than 0")
      .max(1440, "Session duration is too high")
  ),
  name: z
    .string()
    .trim()
    .min(1, "Package name is required")
    .max(120, "Package name must be 120 characters or fewer"),
  price: moneySchema("Package price"),
  photoCount: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce
      .number({ error: "Photo count is required" })
      .int("Photo count must be a whole number")
      .min(0, "Photo count cannot be negative")
      .max(9999, "Photo count is too high")
  ),
  description: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .trim()
      .max(1000, "Description must be 1000 characters or fewer")
      .optional()
  ),
  items: z.array(packageItemSchema).default([]),
});

function uniqueProducts<T extends { items: Array<{ productId: string }> }>(value: T) {
  return new Set(value.items.map((item) => item.productId)).size === value.items.length;
}

export const createPackageSchema = basePackageSchema.refine(uniqueProducts, {
  message: "Each product can only appear once in a package",
  path: ["items"],
});

export const updatePackageSchema = basePackageSchema.extend({
  isActive: z.preprocess(
    (value) => value === "on" || value === true,
    z.boolean()
  ),
}).refine(uniqueProducts, {
  message: "Each product can only appear once in a package",
  path: ["items"],
});

export type CreatePackageInput = z.infer<typeof createPackageSchema>;
export type UpdatePackageInput = z.infer<typeof updatePackageSchema>;
