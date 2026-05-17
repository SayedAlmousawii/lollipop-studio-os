import { Prisma } from "@prisma/client";
import { z } from "zod";

const MAX_EXTRA_PHOTO_PRICE = new Prisma.Decimal("9999999.999");

const extraPhotoUnitPriceSchema = z.preprocess(
  (value) => {
    if (value === "") return undefined;
    if (typeof value === "number") return value.toFixed(3);
    return value;
  },
  z
    .string({
      error: "Unit price is required",
    })
    .trim()
    .regex(/^\d+(\.\d{1,3})?$/, "Use a valid non-negative price with up to 3 decimals")
    .transform((value) => new Prisma.Decimal(value))
    .refine((value) => value.greaterThanOrEqualTo(0), {
      message: "Unit price cannot be negative",
    })
    .refine((value) => value.lessThanOrEqualTo(MAX_EXTRA_PHOTO_PRICE), {
      message: "Unit price is too high",
    })
);

export const updateExtraPhotoPricingSchema = z.object({
  digitalUnitPrice: extraPhotoUnitPriceSchema,
  printUnitPrice: extraPhotoUnitPriceSchema,
});

export type UpdateExtraPhotoPricingInput = z.infer<
  typeof updateExtraPhotoPricingSchema
>;
