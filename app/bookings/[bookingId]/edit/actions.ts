"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { updateBookingSchema } from "@/modules/bookings/booking.schema";
import { updateBooking } from "@/modules/bookings/booking.service";

export type UpdateBookingActionState = {
  errors?: Partial<Record<string, string[]>>;
};

export async function updateBookingAction(
  bookingId: string,
  _prev: UpdateBookingActionState,
  formData: FormData
): Promise<UpdateBookingActionState> {
  const date = formData.get("date");
  const time = formData.get("time");
  const sessionDate = buildSessionDate(date, time);

  if (!sessionDate) {
    return { errors: { date: ["Enter a valid date and time"] } };
  }

  const parsed = updateBookingSchema.safeParse({
    customerId: formData.get("customerId"),
    packageId: formData.get("packageId"),
    date: sessionDate,
    sessionType: formData.get("sessionType"),
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  try {
    await updateBooking(bookingId, parsed.data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update booking";
    return { errors: { _global: [message] } };
  }

  revalidatePath("/bookings");
  redirect("/bookings");
}

function buildSessionDate(date: FormDataEntryValue | null, time: FormDataEntryValue | null): Date | null {
  if (typeof date !== "string" || typeof time !== "string") return null;
  if (!date || !time) return null;

  const value = new Date(`${date}T${time}:00.000Z`);
  return Number.isNaN(value.getTime()) ? null : value;
}
