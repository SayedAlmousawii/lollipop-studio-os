"use server";

import { revalidatePath } from "next/cache";
import { updateBookingStatusSchema } from "@/modules/bookings/booking.schema";
import { updateBookingStatus } from "@/modules/bookings/booking.service";

export type UpdateBookingStatusActionState = {
  errors?: Partial<Record<string, string[]>>;
};

export async function updateBookingStatusAction(
  _prev: UpdateBookingStatusActionState,
  formData: FormData
): Promise<UpdateBookingStatusActionState> {
  const parsed = updateBookingStatusSchema.safeParse({
    bookingId: formData.get("bookingId"),
    nextStatus: formData.get("nextStatus"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  try {
    await updateBookingStatus(parsed.data.bookingId, parsed.data.nextStatus);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update booking status";
    return { errors: { _global: [message] } };
  }

  revalidatePath("/bookings");
  revalidatePath("/calendar");

  return {};
}
