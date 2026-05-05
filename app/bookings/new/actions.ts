"use server";

import { redirect } from "next/navigation";
import { createBookingSchema } from "@/modules/bookings/booking.schema";
import { createBookingInDb } from "@/modules/bookings/booking.service";

export type ActionState = {
  errors?: Partial<Record<string, string[]>>;
};

export async function createBooking(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const raw = {
    customerId: formData.get("customerId"),
    packageId: formData.get("packageId"),
    sessionDate: formData.get("sessionDate"),
    sessionType: formData.get("sessionType"),
    notes: formData.get("notes") || undefined,
  };

  const parsed = createBookingSchema.safeParse(raw);
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  try {
    await createBookingInDb(parsed.data);
  } catch {
    return { errors: { _global: ["Unable to save booking, please try again."] } };
  }
  redirect("/bookings");
}
