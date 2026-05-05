import { z } from "zod";
import { BookingStatus, PaymentMethod } from "@prisma/client";

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

export const createBookingSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  packageId: z.string().min(1, "Package is required"),
  sessionDate: z.coerce.date({ error: "Session date is required" }),
  department: z
    .string()
    .trim()
    .min(1, "Department is required")
    .max(80, "Department must be 80 characters or fewer"),
  assignedPhotographerId: z.string().trim().optional(),
  sessionType: z.enum(["NEWBORN", "KIDS", "FAMILY", "MATERNITY", "OTHER"], {
    error: "Session type is required",
  }),
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
  packageId: z.string().min(1, "Package is required"),
  date: z.date({ error: "Session date is required" }),
  department: z
    .string()
    .trim()
    .min(1, "Department is required")
    .max(80, "Department must be 80 characters or fewer"),
  assignedPhotographerId: z.string().trim().optional(),
  sessionType: z.enum(["NEWBORN", "KIDS", "FAMILY", "MATERNITY", "OTHER"], {
    error: "Session type is required",
  }),
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

export const recordBookingDepositSchema = z.object({
  bookingId: z.string().min(1, "Booking is required"),
  amount: z.coerce.number().positive("Deposit amount must be greater than 0"),
  method: z.nativeEnum(PaymentMethod, {
    error: "Payment method is required",
  }),
  reference: z.string().trim().max(120).optional(),
});

export type RecordBookingDepositInput = z.infer<
  typeof recordBookingDepositSchema
>;
