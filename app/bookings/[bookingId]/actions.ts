"use server";

import { revalidatePath } from "next/cache";
import {
  PERMISSIONS,
  requireCurrentAppUserPermission,
} from "@/lib/permissions";
import { checkInBookingSchema } from "@/modules/bookings/booking.schema";
import { checkInBooking } from "@/modules/bookings/booking.service";

export type CheckInBookingActionState = {
  errors?: Partial<Record<string, string[]>>;
  success?: string;
};

export async function checkInBookingAction(
  _prev: CheckInBookingActionState,
  formData: FormData
): Promise<CheckInBookingActionState> {
  const parsed = checkInBookingSchema.safeParse({
    bookingId: formData.get("bookingId"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  try {
    const appUser = await requireCurrentAppUserPermission(
      PERMISSIONS.BOOKING_STATUS_UPDATE
    );
    await checkInBooking(parsed.data, {
      actorUserId: appUser.id,
      actorRole: appUser.role,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to check in booking";
    return { errors: { _global: [message] } };
  }

  revalidatePath("/bookings");
  revalidatePath(`/bookings/${parsed.data.bookingId}`);
  revalidatePath("/calendar");
  revalidatePath("/orders");
  revalidatePath("/invoices");

  return { success: "Booking checked in." };
}
