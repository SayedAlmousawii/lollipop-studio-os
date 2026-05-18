"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PaymentType } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  PERMISSIONS,
  requireCurrentAppUserPermission,
} from "@/lib/permissions";
import { createInvoiceForOrder } from "@/modules/invoices/invoice.service";
import { getInvoiceById } from "@/modules/invoices/invoice.service";
import { SessionConfigurationRequiredSelectionMissingError } from "@/modules/session-configurations/session-configuration-resolver";
import {
  SessionConfigurationSelectionConfigurationNotFoundError,
  SessionConfigurationSelectionInputMismatchError,
  SessionConfigurationSelectionLockedError,
  SessionConfigurationSelectionOptionMismatchError,
  writeOrderPackageSelections,
} from "@/modules/session-configurations/session-configuration-selection.service";
import { writeSelectionsPayloadSchema } from "@/modules/session-configurations/session-configuration-selection.schema";
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

export type CreateOrderInvoiceActionState = {
  errors?: Partial<Record<string, string[]>>;
};

export type ConfigureSessionActionState = {
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
  prevOrFormData?: CreateOrderInvoiceActionState | FormData,
  maybeFormData?: FormData
): Promise<CreateOrderInvoiceActionState> {
  const formData =
    prevOrFormData instanceof FormData ? prevOrFormData : maybeFormData;
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
      return {
        errors: {
          _global: [await missingSessionConfigurationMessage(error)],
        },
      };
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

export async function configureSessionAction(
  orderId: string,
  _prev: ConfigureSessionActionState,
  formData: FormData
): Promise<ConfigureSessionActionState> {
  const parsedSelections = parseSelectionsJson(formData.get("selections"));
  if (!parsedSelections.success) {
    return { errors: { selections: [parsedSelections.error] } };
  }

  const parsed = writeSelectionsPayloadSchema.safeParse({
    orderPackageId: formData.get("orderPackageId"),
    selections: parsedSelections.value,
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const appUser = await requireCurrentAppUserPermission(
    PERMISSIONS.ORDER_FINANCIAL_UPDATE
  );

  try {
    await writeOrderPackageSelections(parsed.data.orderPackageId, parsed.data.selections, {
      id: appUser.id,
      role: appUser.role,
    });
  } catch (error) {
    return { errors: { _global: [messageForConfigureSessionError(error)] } };
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}/sales`);
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

function parseSelectionsJson(
  value: FormDataEntryValue | null
): { success: true; value: unknown } | { success: false; error: string } {
  if (typeof value !== "string") {
    return { success: false, error: "Selections payload is required." };
  }

  try {
    return { success: true, value: JSON.parse(value) };
  } catch {
    return { success: false, error: "Selections payload is invalid." };
  }
}

function messageForConfigureSessionError(error: unknown): string {
  if (error instanceof SessionConfigurationSelectionLockedError) {
    return "Order is locked. Edit configurations through the Adjustment Workspace.";
  }
  if (error instanceof SessionConfigurationSelectionConfigurationNotFoundError) {
    return "One of the session settings is no longer available. Refresh and try again.";
  }
  if (error instanceof SessionConfigurationSelectionOptionMismatchError) {
    return "One of the selected options is no longer available. Refresh and try again.";
  }
  if (error instanceof SessionConfigurationSelectionInputMismatchError) {
    return "One of the session settings has an invalid value. Review the panel and try again.";
  }
  if (error instanceof z.ZodError) {
    return "Review the session configuration values and try again.";
  }
  return error instanceof Error
    ? error.message
    : "Unable to save session configuration.";
}

async function missingSessionConfigurationMessage(
  error: SessionConfigurationRequiredSelectionMissingError
): Promise<string> {
  const missingCodes = [
    ...new Set(error.details.flatMap((detail) => detail.missingConfigurationCodes)),
  ];
  const configurations = await db.sessionConfiguration.findMany({
    where: { code: { in: missingCodes } },
    select: { code: true, name: true },
  });
  const nameByCode = new Map(
    configurations.map((configuration) => [
      configuration.code,
      configuration.name,
    ])
  );
  const packageIds = error.details.map((detail) => detail.orderPackageId);
  const packages = await db.orderPackage.findMany({
    where: { id: { in: packageIds } },
    select: {
      id: true,
      package: { select: { name: true } },
    },
  });
  const packageNameById = new Map(
    packages.map((orderPackage) => [orderPackage.id, orderPackage.package.name])
  );
  const missingLabels = error.details.map((detail) => {
    const names = detail.missingConfigurationCodes.map(
      (code) => nameByCode.get(code) ?? code
    );
    const packageName = packageNameById.get(detail.orderPackageId);
    return packageName ? `${names.join(", ")} (${packageName})` : names.join(", ");
  });

  return `Configure the missing session settings before generating the invoice: ${missingLabels.join("; ")}.`;
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
