"use server";

import { redirect } from "next/navigation";
import { createBookingSchema } from "@/modules/bookings/booking.schema";
import { createBookingInDb } from "@/modules/bookings/booking.service";
import { parseThemeInput } from "@/modules/bookings/booking.utils";

export type ActionState = {
  errors?: Partial<Record<string, string[]>>;
};

export async function createBooking(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const sessionDate = buildSessionDate(
    formData.get("sessionDate"),
    formData.get("sessionTime")
  );

  if (!sessionDate) {
    return {
      errors: {
        sessionDate: ["Enter a valid session date"],
        sessionTime: ["Enter a valid session time"],
      },
    };
  }

  const raw = {
    customerId: formData.get("customerId"),
    packageId: formData.get("packageId"),
    sessionDate,
    sessionTime: formData.get("sessionTime"),
    departmentId: formData.get("departmentId"),
    assignedPhotographerId:
      formData.get("assignedPhotographerId") || undefined,
    sessionType: formData.get("sessionType"),
    notes: formData.get("notes") || undefined,
    themes: parseThemeInput(formData.get("themes")),
  };

  const parsed = createBookingSchema.safeParse(raw);
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  try {
    await createBookingInDb(parsed.data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save booking, please try again.";
    return { errors: { _global: [message] } };
  }
  redirect("/bookings");
}

function buildSessionDate(
  date: FormDataEntryValue | null,
  time: FormDataEntryValue | null
): Date | null {
  if (typeof date !== "string" || typeof time !== "string") return null;
  if (!date || !time) return null;

  const value = new Date(`${date}T${time}:00.000Z`);
  return Number.isNaN(value.getTime()) ? null : value;
}
