"use server";

import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth";
import { createBookingSchema } from "@/modules/bookings/booking.schema";
import { createBookingInDb } from "@/modules/bookings/booking.service";
import { parseThemeInput } from "@/modules/bookings/booking.utils";
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
    phone: formData.get("phone"),
    customerName: formData.get("customerName") || undefined,
    packages: parsePackageLines(formData),
    sessionDate,
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

function buildSessionDate(
  date: FormDataEntryValue | null,
  time: FormDataEntryValue | null
): Date | null {
  if (typeof date !== "string" || typeof time !== "string") return null;
  if (!date || !time) return null;

  const value = new Date(`${date}T${time}:00.000Z`);
  return Number.isNaN(value.getTime()) ? null : value;
}
