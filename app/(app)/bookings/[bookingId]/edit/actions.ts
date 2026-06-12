"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { updateBookingSchema } from "@/modules/bookings/booking.schema";
import { updateBooking } from "@/modules/bookings/booking.service";
import {
  parsePackageLines,
  parseThemeInput,
} from "@/modules/bookings/booking.utils";

export type UpdateBookingActionState = {
  errors?: Partial<Record<string, string[]>>;
};

export async function updateBookingAction(
  bookingId: string,
  _prev: UpdateBookingActionState,
  formData: FormData
): Promise<UpdateBookingActionState> {
  const date = formData.get("date");

  const parsed = updateBookingSchema.safeParse({
    customerId: formData.get("customerId"),
    packages: parsePackageLines(formData),
    date,
    sessionTime: formData.get("sessionTime"),
    departmentId: formData.get("departmentId"),
    assignedPhotographerId:
      formData.get("assignedPhotographerId") || undefined,
    notes: formData.get("notes") || undefined,
    themes: parseThemeInput(formData.get("themes")),
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
  revalidatePath("/calendar");
  redirect("/bookings");
}
