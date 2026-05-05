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
    department: formData.get("department"),
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
  } catch {
    return { errors: { _global: ["Unable to save booking, please try again."] } };
  }
  redirect("/bookings");
}

function parseThemeInput(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(/[\n,]/)
    .map((themeName) => themeName.trim())
    .filter(Boolean)
    .map((themeName) => ({ themeName }));
}
