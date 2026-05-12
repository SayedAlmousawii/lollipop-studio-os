"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { updateBookingSchema } from "@/modules/bookings/booking.schema";
import { updateBooking } from "@/modules/bookings/booking.service";
import { parseThemeInput } from "@/modules/bookings/booking.utils";

export type UpdateBookingActionState = {
  errors?: Partial<Record<string, string[]>>;
};

export async function updateBookingAction(
  bookingId: string,
  _prev: UpdateBookingActionState,
  formData: FormData
): Promise<UpdateBookingActionState> {
  const date = formData.get("date");
  const time = formData.get("sessionTime");
  const sessionDate = buildSessionDate(date, time);

  if (!sessionDate) {
    return { errors: { date: ["Enter a valid date and time"] } };
  }

  const parsed = updateBookingSchema.safeParse({
    customerId: formData.get("customerId"),
    packages: parsePackageLines(formData),
    date: sessionDate,
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

function parsePackageLines(formData: FormData) {
  const packageIds = formData.getAll("packageIds");
  const quantities = formData.getAll("packageQuantities");
  const sortOrders = formData.getAll("packageSortOrders");

  return packageIds.map((packageId, index) => ({
    packageId,
    quantity: quantities[index] ?? "1",
    sortOrder: sortOrders[index] ?? String(index),
  }));
}

function buildSessionDate(date: FormDataEntryValue | null, time: FormDataEntryValue | null): Date | null {
  if (typeof date !== "string" || typeof time !== "string") return null;
  if (!date || !time) return null;

  const value = new Date(`${date}T${time}:00.000Z`);
  return Number.isNaN(value.getTime()) ? null : value;
}
