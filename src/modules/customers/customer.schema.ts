import { z } from "zod";
import { CustomerStatus } from "@prisma/client";

export const createCustomerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Full name is required")
    .max(120, "Full name must be 120 characters or fewer"),
  phone: z
    .string()
    .trim()
    .min(5, "Phone number is required")
    .max(32, "Phone number must be 32 characters or fewer")
    .regex(/^[+\d\s()-]+$/, "Enter a valid phone number")
    .transform((value) => value.replace(/[\s()-]/g, "")),
  notes: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .trim()
      .max(1000, "Notes must be 1000 characters or fewer")
      .optional()
  ),
});

export const updateCustomerSchema = createCustomerSchema.extend({
  status: z.nativeEnum(CustomerStatus, {
    error: "Select a valid customer status",
  }),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
