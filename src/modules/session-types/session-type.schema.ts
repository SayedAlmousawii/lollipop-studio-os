import { z } from "zod";

const optionalCalendarColorSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .string()
    .trim()
    .max(120, "Calendar color must be 120 characters or fewer")
    .optional()
);

export const createSessionTypeSchema = z
  .object({
    departmentId: z
      .string()
      .trim()
      .min(1, "Department is required"),
    name: z
      .string()
      .trim()
      .min(1, "Session type name is required")
      .max(120, "Session type name must be 120 characters or fewer"),
    calendarLabel: z
      .string()
      .trim()
      .min(1, "Calendar label is required")
      .max(120, "Calendar label must be 120 characters or fewer"),
    calendarColor: optionalCalendarColorSchema,
  })
  .strict();

export const updateSessionTypeSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Session type name is required")
      .max(120, "Session type name must be 120 characters or fewer")
      .optional(),
    calendarLabel: z
      .string()
      .trim()
      .min(1, "Calendar label is required")
      .max(120, "Calendar label must be 120 characters or fewer")
      .optional(),
    calendarColor: optionalCalendarColorSchema,
  })
  .strict();

export type CreateSessionTypeInput = z.infer<typeof createSessionTypeSchema>;
export type UpdateSessionTypeInput = z.infer<typeof updateSessionTypeSchema>;
