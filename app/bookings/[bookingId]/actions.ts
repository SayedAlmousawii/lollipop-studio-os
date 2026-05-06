"use server";

import { redirect } from "next/navigation";
import { recordBasePaymentSchema } from "@/modules/bookings/booking.schema";
import { recordBasePaymentAndComplete } from "@/modules/bookings/booking.service";

export type RecordBasePaymentActionState = {
  errors?: Partial<Record<string, string[]>>;
};

export async function recordBasePaymentAndCompleteAction(
  _prev: RecordBasePaymentActionState,
  formData: FormData
): Promise<RecordBasePaymentActionState> {
  const parsed = recordBasePaymentSchema.safeParse({
    bookingId: formData.get("bookingId"),
    amount: formData.get("amount"),
    method: formData.get("method"),
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  let orderId: string;
  try {
    const result = await recordBasePaymentAndComplete(parsed.data);
    orderId = result.orderId;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to record base payment";
    return { errors: { _global: [message] } };
  }

  redirect(`/orders/${orderId}`);
}
