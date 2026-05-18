"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PaymentType } from "@prisma/client";
import {
  PERMISSIONS,
  requireCurrentAppUserPermission,
} from "@/lib/permissions";
import { createInvoiceForOrder } from "@/modules/invoices/invoice.service";
import { getInvoiceById } from "@/modules/invoices/invoice.service";
import { SessionConfigurationRequiredSelectionMissingError } from "@/modules/session-configurations/session-configuration-resolver";
import { recordPaymentSchema } from "@/modules/payments/payment.schema";
import { recordPayment } from "@/modules/payments/payment.service";
import {
  updateOrderDeliveryWorkflowSchema,
  updateOrderEditingWorkflowSchema,
  updateOrderProductionWorkflowSchema,
} from "@/modules/orders/order.schema";
import {
  updateOrderDeliveryWorkflow,
  updateOrderEditingWorkflow,
  updateOrderProductionWorkflow,
} from "@/modules/orders/order.service";
import {
  WorkflowGuardError,
  type WorkflowGuardErrorCode,
} from "@/modules/orders/order.errors";

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

export async function createOrderInvoiceAction(
  orderId: string,
  formData?: FormData
): Promise<void> {
  const appUser = await requireCurrentAppUserPermission(PERMISSIONS.INVOICE_CREATE);
  let invoice: { id: string };
  try {
    invoice = await createInvoiceForOrder(orderId, {
      actorUserId: appUser.id, actorRole: appUser.role,
    });
  } catch (error) {
    if (error instanceof SessionConfigurationRequiredSelectionMissingError) {
      console.error(
        JSON.stringify({
          event: "session_configuration_required_selection_missing",
          orderId,
          details: error.details,
        })
      );
    }
    throw error;
  }
  const shouldReturnToSales = formData?.get("returnTo") === "sales";
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  if (shouldReturnToSales) {
    revalidatePath(`/orders/${orderId}/sales`);
  }
  revalidatePath("/invoices");
  if (shouldReturnToSales) {
    redirect(`/orders/${orderId}/sales`);
  }
  redirect(`/invoices/${invoice.id}`);
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
  const submittedAmount = formData.get("amount");
  const parsed = recordPaymentSchema.safeParse({
    amount: submittedAmount,
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
    const invoice = await getInvoiceById(invoiceId);
    if (!invoice) {
      return { errors: { _global: ["Invoice not found."] } };
    }
    if (invoice.orderId !== orderId) {
      return {
        errors: {
          _global: ["Invoice does not belong to this order."],
        },
      };
    }

    const serverAmount = Number(invoice.remainingAmount.replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(serverAmount) || serverAmount <= 0) {
      return {
        errors: {
          _global: ["No outstanding balance remains on this invoice."],
        },
      };
    }

    if (parsed.data.amount.toFixed(3) !== serverAmount.toFixed(3)) {
      return {
        errors: {
          _global: ["Outstanding balance changed. Please reopen the payment dialog and try again."],
        },
      };
    }

    await recordPayment(invoice.id, { ...parsed.data, amount: serverAmount }, {
      actorUserId: appUser.id,
      actorRole: appUser.role,
    });
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
