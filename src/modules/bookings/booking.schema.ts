import { z } from "zod";
import { BookingStatus, PaymentMethod } from "@prisma/client";
import { customerPhoneSchema } from "@/modules/customers/customer.schema";

const bookingThemeSchema = z.object({
  themeName: z
    .string()
    .trim()
    .min(1, "Theme name is required")
    .max(120, "Theme name must be 120 characters or fewer"),
  notes: z
    .string()
    .trim()
    .max(500, "Theme notes must be 500 characters or fewer")
    .optional(),
});

const SESSION_TIME_REGEX = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const bookingPackageSchema = z.object({
  packageId: z.string().min(1, "Package is required"),
  quantity: z.coerce
    .number({ error: "Quantity is required" })
    .int("Quantity must be a whole number")
    .min(1, "Quantity must be at least 1"),
  sortOrder: z.coerce
    .number({ error: "Sort order is required" })
    .int("Sort order must be a whole number")
    .min(0, "Sort order must be zero or greater"),
});

function hasMaxDecimalPlaces(value: number): boolean {
  const scaledValue = value * 1000;
  return Math.abs(scaledValue - Math.round(scaledValue)) < Number.EPSILON;
}

export const createBookingSchema = z.object({
  phone: customerPhoneSchema,
  customerName: z
    .string()
    .trim()
    .max(120, "Customer name must be 120 characters or fewer")
    .optional(),
  packages: z.array(bookingPackageSchema).min(1, "Add at least one package"),
  sessionDate: z.coerce.date({ error: "Session date is required" }),
  sessionTime: z
    .string()
    .regex(SESSION_TIME_REGEX, "Session time must use HH:MM (00-23:00-59)"),
  departmentId: z.string().min(1, "Department is required"),
  assignedPhotographerId: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().trim().optional()
  ),
  notes: z
    .string()
    .trim()
    .max(1000, "Notes must be 1000 characters or fewer")
    .optional(),
  themes: z.array(bookingThemeSchema).default([]),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const updateBookingSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  packages: z.array(bookingPackageSchema).min(1, "Add at least one package"),
  date: z.date({ error: "Session date is required" }),
  sessionTime: z
    .string()
    .regex(SESSION_TIME_REGEX, "Session time must use HH:MM (00-23:00-59)"),
  departmentId: z.string().min(1, "Department is required"),
  assignedPhotographerId: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().trim().optional()
  ),
  notes: z
    .string()
    .trim()
    .max(1000, "Notes must be 1000 characters or fewer")
    .optional(),
  themes: z.array(bookingThemeSchema).default([]),
});

export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;

export const updateBookingStatusSchema = z.object({
  bookingId: z.string().min(1, "Booking is required"),
  nextStatus: z.nativeEnum(BookingStatus, {
    error: "Booking status is required",
  }),
});

export type UpdateBookingStatusInput = z.infer<typeof updateBookingStatusSchema>;

export const deletePendingBookingSchema = z.object({
  bookingId: z.string().min(1, "Booking is required"),
});

export type DeletePendingBookingInput = z.infer<
  typeof deletePendingBookingSchema
>;

export const checkInBookingSchema = z.object({
  bookingId: z.string().min(1, "Booking is required"),
  assignedPhotographerId: z.string().trim().min(1, "Photographer is required"),
  socialMediaConsent: z.preprocess(
    (value) =>
      value === "true" ? true : value === "false" ? false : value,
    z.boolean({ error: "Social media consent is required" })
  ),
});

export type CheckInBookingInput = z.infer<typeof checkInBookingSchema>;

export const recordBookingDepositSchema = z.object({
  bookingId: z.string().min(1, "Booking is required"),
  amount: z.coerce
    .number({ error: "Deposit amount is required" })
    .min(20, "Deposit amount must be at least 20.000 KD")
    .refine(hasMaxDecimalPlaces, "Deposit amount can have up to 3 decimals"),
  method: z.nativeEnum(PaymentMethod, {
    error: "Payment method is required",
  }),
  reference: z.string().trim().max(120).optional(),
});

export type RecordBookingDepositInput = z.infer<
  typeof recordBookingDepositSchema
>;
