"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  PERMISSIONS,
  requireCurrentAppUserPermission,
} from "@/lib/permissions";
import {
  deletePendingBookingSchema,
  recordBookingDepositSchema,
  updateBookingStatusSchema,
} from "@/modules/bookings/booking.schema";
import {
  deletePendingBooking,
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

export type DeletePendingBookingActionState = {
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
    await requireCurrentAppUserPermission(PERMISSIONS.BOOKING_STATUS_UPDATE);
    await updateBookingStatus(parsed.data.bookingId, parsed.data.nextStatus);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update booking status";
    return { errors: { _global: [message] } };
  }

  revalidatePath("/bookings");
  revalidatePath(`/bookings/${parsed.data.bookingId}`);
  revalidatePath("/calendar");
  revalidatePath("/orders");
  revalidatePath("/invoices");

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
    const appUser = await requireCurrentAppUserPermission(PERMISSIONS.PAYMENT_CREATE);
    await recordBookingDeposit(parsed.data, {
      actorUserId: appUser.id, actorRole: appUser.role,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to record deposit";
    return { errors: { _global: [message] } };
  }

  revalidatePath("/bookings");
  revalidatePath(`/bookings/${parsed.data.bookingId}`);
  revalidatePath("/calendar");
  revalidatePath("/invoices");

  return { success: "Deposit recorded." };
}

export async function deletePendingBookingAction(
  _prev: DeletePendingBookingActionState,
  formData: FormData
): Promise<DeletePendingBookingActionState> {
  const parsed = deletePendingBookingSchema.safeParse({
    bookingId: formData.get("bookingId"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  try {
    await requireCurrentAppUserPermission(PERMISSIONS.BOOKING_STATUS_UPDATE);
    await deletePendingBooking(parsed.data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to delete pending booking";
    return { errors: { _global: [message] } };
  }

  revalidatePath("/bookings");
  revalidatePath(`/bookings/${parsed.data.bookingId}`);
  revalidatePath("/calendar");

  redirect("/bookings");
}
