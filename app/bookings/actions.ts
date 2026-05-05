"use server";

import { revalidatePath } from "next/cache";
import {
  recordBookingDepositSchema,
  updateBookingStatusSchema,
} from "@/modules/bookings/booking.schema";
import {
  recordBookingDeposit,
  updateBookingStatus,
} from "@/modules/bookings/booking.service";

export type UpdateBookingStatusActionState = {
  errors?: Partial<Record<string, string[]>>;
};

export type RecordDepositActionState = {
  errors?: Partial<Record<string, string[]>>;
  success?: string;
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
  revalidatePath("/orders");

  return {};
}

export async function recordDepositAction(
  _prev: RecordDepositActionState,
  formData: FormData
): Promise<RecordDepositActionState> {
  const parsed = recordBookingDepositSchema.safeParse({
    bookingId: formData.get("bookingId"),
    amount: formData.get("amount"),
    method: formData.get("method"),
    reference: formData.get("reference") || undefined,
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  try {
    await recordBookingDeposit(parsed.data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to record deposit";
    return { errors: { _global: [message] } };
  }

  revalidatePath("/bookings");
  revalidatePath("/calendar");
  revalidatePath("/invoices");

  return { success: "Deposit recorded." };
}
