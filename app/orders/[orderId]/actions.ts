"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createInvoiceForOrder } from "@/modules/invoices/invoice.service";
import {
  updateOrderEditingWorkflowSchema,
  updateOrderSelectionWorkflowSchema,
} from "@/modules/orders/order.schema";
import {
  updateOrderEditingWorkflow,
  updateOrderSelectionWorkflow,
} from "@/modules/orders/order.service";

export type UpdateSelectionActionState = {
  errors?: Partial<Record<string, string[]>>;
};

export type UpdateEditingActionState = {
  errors?: Partial<Record<string, string[]>>;
};

export async function createOrderInvoiceAction(orderId: string): Promise<void> {
  const invoice = await createInvoiceForOrder(orderId);
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/invoices");
  redirect(`/invoices/${invoice.id}`);
}

export async function updateSelectionWorkflowAction(
  orderId: string,
  _prev: UpdateSelectionActionState,
  formData: FormData
): Promise<UpdateSelectionActionState> {
  const addOnOptionIds = formData.getAll("addOnOptionId");
  const addOns = addOnOptionIds.flatMap((optionId) => {
    const safeOptionId = typeof optionId === "string" ? optionId.trim() : "";
    if (!safeOptionId) return [];

    return [{ optionId: safeOptionId, name: "Selected add-on", price: 0 }];
  });

  const parsed = updateOrderSelectionWorkflowSchema.safeParse({
    finalPackageId: formData.get("finalPackageId"),
    extraPhotos: formData.get("extraPhotos"),
    addOns,
    notes: formData.get("notes") || undefined,
    completeSelection: formData.get("completeSelection") === "true",
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  try {
    await updateOrderSelectionWorkflow(orderId, parsed.data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update selection workflow";
    return { errors: { _global: [message] } };
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/invoices");
  return {};
}

export async function updateEditingWorkflowAction(
  orderId: string,
  _prev: UpdateEditingActionState,
  formData: FormData
): Promise<UpdateEditingActionState> {
  const estimatedCompletionValue = formData.get("estimatedEditingCompletionAt");
  const parsed = updateOrderEditingWorkflowSchema.safeParse({
    action: formData.get("action"),
    assignedEditorId: formData.get("assignedEditorId") || undefined,
    editedPhotoCount: formData.get("editedPhotoCount") || undefined,
    estimatedEditingCompletionAt:
      typeof estimatedCompletionValue === "string" && estimatedCompletionValue
        ? estimatedCompletionValue
        : undefined,
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  try {
    await updateOrderEditingWorkflow(orderId, parsed.data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update editing workflow";
    return { errors: { _global: [message] } };
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return {};
}
