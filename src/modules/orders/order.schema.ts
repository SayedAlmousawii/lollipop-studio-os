import { z } from "zod";

export const orderAddOnSchema = z.object({
  name: z.string().trim().min(1, "Add-on name is required"),
  price: z.coerce.number().min(0, "Add-on price cannot be negative"),
});

export const updateOrderSchema = z.object({
  finalPackageId: z.string().min(1, "Package is required"),
  selectedPhotos: z.coerce
    .number()
    .int("Selected photos must be a whole number")
    .min(0, "Selected photos cannot be negative"),
  addOns: z.array(orderAddOnSchema),
  notes: z.string().trim().max(1000, "Notes must be 1000 characters or fewer").optional(),
});

export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type OrderAddOnInput = z.infer<typeof orderAddOnSchema>;
