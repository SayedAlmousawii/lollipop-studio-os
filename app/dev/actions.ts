"use server";

import { revalidatePath } from "next/cache";
import { resetWorkflowTestData } from "@/modules/development/dev-reset.service";

export type ResetWorkflowActionState = {
  message?: string;
  error?: string;
};

export async function resetWorkflowAction(): Promise<ResetWorkflowActionState> {
  try {
    await resetWorkflowTestData();
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to reset workflow test data",
    };
  }

  revalidatePath("/bookings");
  revalidatePath("/orders");
  revalidatePath("/invoices");
  revalidatePath("/calendar");

  return { message: "Workflow test data reset." };
}
