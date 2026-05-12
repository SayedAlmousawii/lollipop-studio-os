import { z } from "zod";
import { CustomerStatus } from "@prisma/client";
import { formatCustomerPhone } from "./customer.utils";

export const customerPhoneSchema = z
  .string()
  .trim()
  .min(1, "Phone number is required")
  .regex(/^\+?[\d\s\-().]+$/, "Enter a valid phone number")
  .transform((value) => value.replace(/[\s\-().]/g, ""))
  .pipe(
    z
      .string()
      .regex(/^\+?\d+$/, "Enter a valid phone number")
      .refine(
        (value) => {
          const digits = value.replace(/^\+/, "").replace(/\D/g, "");
          return digits.length >= 7;
        },
        "Phone number is too short"
      )
      .refine(
        (value) => {
          const digits = value.replace(/^\+/, "").replace(/\D/g, "");
          return digits.length <= 15;
        },
        "Phone number is too long"
      )
  )
  .transform((value) => formatCustomerPhone(value));

export const createCustomerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Full name is required")
    .max(120, "Full name must be 120 characters or fewer"),
  phone: customerPhoneSchema,
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

export const childSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Child name is required")
    .max(120, "Child name must be 120 characters or fewer"),
  dateOfBirth: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date")
      .refine((value) => isValidDateInput(value), "Enter a valid date")
      .optional()
  ),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type ChildInput = z.infer<typeof childSchema>;

function isValidDateInput(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
