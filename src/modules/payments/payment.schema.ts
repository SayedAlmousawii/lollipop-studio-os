import { PaymentMethod, PaymentType } from "@prisma/client";
import { z } from "zod";

export const recordPaymentSchema = z.object({
  financialCaseId: z.string().min(1).optional(),
  amount: z.coerce.number().positive("Payment amount must be greater than 0"),
  method: z.nativeEnum(PaymentMethod, {
    error: "Payment method is required",
  }),
  paymentType: z.nativeEnum(PaymentType),
  paidAt: z.coerce.date().optional(),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
});

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
