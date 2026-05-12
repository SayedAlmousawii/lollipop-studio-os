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

const SESSION_TIME_REGEX = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export const createBookingSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  packageId: z.string().min(1, "Package is required"),
  sessionDate: z.coerce.date({ error: "Session date is required" }),
  sessionTime: z
    .string()
    .regex(SESSION_TIME_REGEX, "Session time must use HH:MM (00-23:00-59)"),
  departmentId: z.string().min(1, "Department is required"),
  assignedPhotographerId: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().trim().optional()
  ),
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
  sessionTime: z
    .string()
    .regex(SESSION_TIME_REGEX, "Session time must use HH:MM (00-23:00-59)"),
  departmentId: z.string().min(1, "Department is required"),
  assignedPhotographerId: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().trim().optional()
  ),
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
  amount: z.coerce.number().positive("Deposit amount must be greater than 0"),
  method: z.nativeEnum(PaymentMethod, {
    error: "Payment method is required",
  }),
  reference: z.string().trim().max(120).optional(),
});

export type RecordBookingDepositInput = z.infer<
  typeof recordBookingDepositSchema
>;
