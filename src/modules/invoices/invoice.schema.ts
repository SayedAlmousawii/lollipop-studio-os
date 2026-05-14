import { InvoiceLineType } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

export const createAdjustmentInvoiceSchema = z.object({
  totalAmount: z.coerce
    .number()
    .positive("Adjustment total must be greater than 0"),
  notes: z.string().trim().max(500).optional(),
});

export type AdjustmentLineInput = {
  lineType: InvoiceLineType;
  description: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
};

export type CreateAdjustmentInvoiceInput = {
  parentFinalInvoiceId: string;
  lines: AdjustmentLineInput[];
  notes?: string;
  createdByUserId?: string;
};

export const createAdjustmentInvoiceLineSchema = z.object({
  lineType: z.nativeEnum(InvoiceLineType),
  description: z.string().trim().min(1),
  quantity: z.coerce.number().int().positive(),
  unitPrice: z.coerce.number().positive(),
});
