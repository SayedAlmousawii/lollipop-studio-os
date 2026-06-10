"use server";

import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth";
import { createBookingSchema } from "@/modules/bookings/booking.schema";
import { createBookingInDb } from "@/modules/bookings/booking.service";
import {
  parsePackageLines,
  parseThemeInput,
} from "@/modules/bookings/booking.utils";
import {
  getCustomerPhoneSuggestions,
  type CustomerPhoneSuggestion,
} from "@/modules/customers/customer.service";

export type ActionState = {
  errors?: Partial<Record<string, string[]>>;
};

export async function createBooking(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const raw = {
    phone: formData.get("phone"),
    customerName: formData.get("customerName") || undefined,
    packages: parsePackageLines(formData),
    sessionDate: formData.get("sessionDate"),
    sessionTime: formData.get("sessionTime"),
    departmentId: formData.get("departmentId"),
    assignedPhotographerId:
      formData.get("assignedPhotographerId") || undefined,
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

export async function getBookingCustomerPhoneSuggestions(
  query: string
): Promise<CustomerPhoneSuggestion[]> {
  const appUser = await getCurrentAppUser();

  if (!appUser || !appUser.active) {
    return [];
  }

  try {
    return await getCustomerPhoneSuggestions(query);
  } catch (error) {
    console.error("Booking customer phone suggestions failed", error);
    return [];
  }
}
