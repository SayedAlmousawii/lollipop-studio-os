import { InvoiceLineType, OrderEntityKind, PaymentMethod, Prisma } from "@prisma/client";
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
  unitPrice: number;
  causeOrderEntityKind?: OrderEntityKind;
  causeOrderEntityId?: string;
};

export type CreateAdjustmentInvoiceInput = {
  parentFinalInvoiceId: string;
  lines: AdjustmentLineInput[];
  notes?: string;
  createdByUserId?: string;
};

export const createRefundWithPaymentSchema = z.object({
  amount: z.coerce.number().positive("Refund amount must be greater than 0"),
  reason: z.string().trim().min(1, "Refund reason is required").max(500),
  refundOfPaymentId: z.string().trim().optional(),
  method: z.nativeEnum(PaymentMethod, {
    error: "Refund method is required",
  }),
  reference: z.string().trim().max(120).optional(),
  paidAt: z.coerce.date().optional(),
});

export type RefundInvoicePrimitiveInput = {
  sourceInvoiceId: string;
  amount: Prisma.Decimal | number | string;
  reason: string;
  createdByUserId: string;
  notes?: string;
};

export type CreateRefundWithPaymentInput = RefundInvoicePrimitiveInput & {
  method: PaymentMethod;
  refundOfPaymentId?: string;
  reference?: string;
  paidAt?: Date;
};

export const createCreditNoteSchema = z.object({
  reason: z.string().trim().min(1, "Credit note reason is required").max(500),
  notes: z.string().trim().max(500).optional(),
});

export type CreditNoteLineInput = {
  description: string;
  quantity: number;
  unitPrice: Prisma.Decimal | number | string;
  lineType?: InvoiceLineType;
  causeOrderEntityKind?: OrderEntityKind;
  causeOrderEntityId?: string;
  targetInvoiceId?: string;
  targetInvoiceLineId?: string;
};

export type CreateCreditNoteInput = {
  targetFinalInvoiceId?: string;
  targetAdjustmentInvoiceId?: string;
  lines: CreditNoteLineInput[];
  reason: string;
  createdByUserId: string;
  notes?: string;
};

export const createAdjustmentInvoiceLineSchema = z
  .object({
    lineType: z.nativeEnum(InvoiceLineType),
    description: z.string().trim().min(1),
    quantity: z.coerce.number().int().positive(),
    unitPrice: z.coerce.number().positive(),
    causeOrderEntityKind: z.nativeEnum(OrderEntityKind).optional(),
    causeOrderEntityId: z.string().trim().min(1).optional(),
  })
  .refine(
    (line) => Boolean(line.causeOrderEntityKind) === Boolean(line.causeOrderEntityId),
    {
      message:
        "causeOrderEntityKind and causeOrderEntityId must be provided together",
      path: ["causeOrderEntityId"],
    }
  );
