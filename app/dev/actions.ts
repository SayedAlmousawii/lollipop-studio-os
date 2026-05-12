"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createDevelopmentTestBooking } from "@/modules/development/dev-create-booking.service";
import { resetWorkflowTestData } from "@/modules/development/dev-reset.service";

export type ResetWorkflowActionState = {
  message?: string;
  error?: string;
  token?: number;
};

export type CreateTestBookingActionState = {
  message?: string;
  error?: string;
  token?: number;
};

export async function createTestBookingAction(): Promise<CreateTestBookingActionState> {
  try {
    await createDevelopmentTestBooking();
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to create test booking",
      token: Date.now(),
    };
  }

  revalidatePath("/bookings");
  revalidatePath("/calendar");
  revalidatePath("/bookings/new");
  redirect("/bookings");
}

export async function resetWorkflowAction(): Promise<ResetWorkflowActionState> {
  try {
    await resetWorkflowTestData();
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to reset workflow test data",
      token: Date.now(),
    };
  }

  revalidatePath("/bookings");
  revalidatePath("/orders");
  revalidatePath("/invoices");
  revalidatePath("/calendar");

  return { message: "Workflow test data reset.", token: Date.now() };
}
