"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PaymentType } from "@prisma/client";
import {
  PERMISSIONS,
  requireCurrentAppUserPermission,
} from "@/lib/permissions";
import { createInvoiceForOrder } from "@/modules/invoices/invoice.service";
import { recordPaymentSchema } from "@/modules/payments/payment.schema";
import { recordPayment } from "@/modules/payments/payment.service";
import {
  updateOrderDeliveryWorkflowSchema,
  updateOrderEditingWorkflowSchema,
  updateOrderProductionWorkflowSchema,
  updateOrderSelectionWorkflowSchema,
} from "@/modules/orders/order.schema";
import {
  updateOrderDeliveryWorkflow,
  updateOrderEditingWorkflow,
  updateOrderProductionWorkflow,
  updateOrderSelectionWorkflow,
} from "@/modules/orders/order.service";
import {
  WorkflowGuardError,
  type WorkflowGuardErrorCode,
} from "@/modules/orders/order.errors";

export type UpdateSelectionActionState = {
  errors?: Partial<Record<string, string[]>>;
};

export type UpdateEditingActionState = {
  errors?: Partial<Record<string, string[]>>;
};

export type RecordUpgradePaymentActionState = {
  errors?: Partial<Record<string, string[]>>;
};

export type UpdateProductionActionState = {
  errors?: Partial<Record<string, string[]>>;
};

export type UpdateDeliveryActionState = {
  errors?: Partial<Record<string, string[]>>;
  errorCode?: WorkflowGuardErrorCode;
};

export async function createOrderInvoiceAction(orderId: string): Promise<void> {
  const appUser = await requireCurrentAppUserPermission(PERMISSIONS.INVOICE_CREATE);
  const invoice = await createInvoiceForOrder(orderId, {
    actorUserId: appUser.id, actorRole: appUser.role,
  });
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
    const appUser = await requireCurrentAppUserPermission(
      PERMISSIONS.ORDER_FINANCIAL_UPDATE
    );
    await updateOrderSelectionWorkflow(orderId, parsed.data, {
      actorUserId: appUser.id, actorRole: appUser.role,
    });
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

  const appUser = await requireCurrentAppUserPermission(
    PERMISSIONS.WORKFLOW_EDITING_UPDATE
  );

  try {
    await updateOrderEditingWorkflow(orderId, parsed.data, {
      actorUserId: appUser.id, actorRole: appUser.role,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update editing workflow";
    return { errors: { _global: [message] } };
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return {};
}

export async function recordUpgradePaymentAction(
  orderId: string,
  invoiceId: string,
  _prev: RecordUpgradePaymentActionState,
  formData: FormData
): Promise<RecordUpgradePaymentActionState> {
  const parsed = recordPaymentSchema.safeParse({
    amount: formData.get("amount"),
    method: formData.get("method"),
    paymentType: PaymentType.UPGRADE,
    reference: formData.get("reference") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  try {
    const appUser = await requireCurrentAppUserPermission(PERMISSIONS.PAYMENT_CREATE);
    await recordPayment(invoiceId, parsed.data, { actorUserId: appUser.id });
  } catch (error) {
    if (error instanceof Error && "digest" in error) throw error;
    const message =
      error instanceof Error ? error.message : "Unable to record upgrade payment";
    return { errors: { _global: [message] } };
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  redirect(`/orders/${orderId}`);
}

export async function updateProductionWorkflowAction(
  orderId: string,
  _prev: UpdateProductionActionState,
  formData: FormData
): Promise<UpdateProductionActionState> {
  const parsed = updateOrderProductionWorkflowSchema.safeParse({
    action: formData.get("action"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const appUser = await requireCurrentAppUserPermission(
    PERMISSIONS.WORKFLOW_PRODUCTION_UPDATE
  );

  try {
    await updateOrderProductionWorkflow(orderId, parsed.data, {
      actorUserId: appUser.id, actorRole: appUser.role,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update production workflow";
    return { errors: { _global: [message] } };
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return {};
}

export async function updateDeliveryWorkflowAction(
  orderId: string,
  _prev: UpdateDeliveryActionState,
  formData: FormData
): Promise<UpdateDeliveryActionState> {
  const parsed = updateOrderDeliveryWorkflowSchema.safeParse({
    action: formData.get("action"),
    pickupNotes: formData.get("pickupNotes") || undefined,
    completedById: formData.get("completedById") || undefined,
    allowPaymentOverride: formData.get("allowPaymentOverride") === "true",
    overrideReason: formData.get("overrideReason") || undefined,
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  try {
    const basePermission =
      parsed.data.action === "markPickedUp"
        ? PERMISSIONS.DELIVERY_COMPLETE
        : PERMISSIONS.DELIVERY_UPDATE;
    const appUser = await requireCurrentAppUserPermission(basePermission);

    if (parsed.data.allowPaymentOverride) {
      await requireCurrentAppUserPermission(PERMISSIONS.DELIVERY_PAYMENT_OVERRIDE);
    }

    await updateOrderDeliveryWorkflow(orderId, parsed.data, {
      actorUserId: appUser.id, actorRole: appUser.role,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update delivery workflow";
    const errorCode = error instanceof WorkflowGuardError ? error.code : undefined;
    return { errors: { _global: [message] }, ...(errorCode ? { errorCode } : {}) };
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return {};
}
