import { z } from "zod";

export const createBookingSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  packageId: z.string().min(1, "Package is required"),
  sessionDate: z.coerce.date({ error: "Session date is required" }),
  sessionType: z.enum(["NEWBORN", "KIDS", "FAMILY", "MATERNITY", "OTHER"], {
    error: "Session type is required",
  }),
  notes: z.string().optional(),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
