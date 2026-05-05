import { z } from "zod";

export const createAdjustmentInvoiceSchema = z.object({
  totalAmount: z.coerce
    .number()
    .positive("Adjustment total must be greater than 0"),
  notes: z.string().trim().max(500).optional(),
});

export type CreateAdjustmentInvoiceInput = z.infer<
  typeof createAdjustmentInvoiceSchema
>;
