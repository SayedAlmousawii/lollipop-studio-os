"use server";

import { revalidatePath } from "next/cache";
import {
  InvoiceType,
  OrderSelectionStatus,
  OrderStatus,
  PaymentType,
} from "@prisma/client";
import { z } from "zod";
import { PERMISSIONS, requireCurrentAppUserPermission } from "@/lib/permissions";
import { PendingCreditNoteApprovalError } from "@/modules/financial/edit-classifier";
import {
  addOrderProductAddOnSchema,
  removeOrderAddOnSchema,
  updateOrderPackageSchema,
  updateOrderSelectedPhotoCountSchema,
  upgradeOrderPackageItemSchema,
} from "@/modules/orders/order.schema";
import {
  addOrderProductAddOn,
  getPOSWorkspace,
  removeOrderAddOn,
  recordPOSPaymentForOrder,
  updateOrderPackage,
  updateOrderSelectedPhotoCount,
  upgradeOrderPackageItem,
} from "@/modules/orders/order.service";
import { recordPaymentSchema } from "@/modules/payments/payment.schema";
import type {
  POSApprovalPayload,
  POSMutationActionState,
} from "@/modules/orders/pos-handlers.types";

export type PendingCreditNoteApprovalPayload = POSApprovalPayload;

export type ReductiveEditAction =
  | "update-package"
  | "upgrade-package-item"
  | "remove-add-on"
  | "update-selected-photo-count";

export type POSCompositionActionState = POSMutationActionState;

export type POSRecordPaymentActionState = {
  errors?: Partial<Record<string, string[]>>;
  success?: string;
};

const posPaymentDateTimeSchema = z.object({
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Payment date is required"),
  paidTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Payment time is required"),
});
const posPaymentSelectionSchema = z.object({
  selectionStatus: z.nativeEnum(OrderSelectionStatus, {
    error: "Selection status is required",
  }),
});

export async function updateOrderPackageAction(
  orderId: string,
  _prev: POSCompositionActionState,
  formData: FormData
): Promise<POSCompositionActionState> {
  const parsed = updateOrderPackageSchema.safeParse({
    orderPackageId: formData.get("orderPackageId"),
    packageId: formData.get("packageId"),
  });

  if (!parsed.success) {
    return { kind: "error", errors: parsed.error.flatten().fieldErrors };
  }

  try {
    const appUser = await requireCurrentAppUserPermission(
      PERMISSIONS.ORDER_FINANCIAL_UPDATE
    );
    await updateOrderPackage(orderId, parsed.data, {
      actorUserId: appUser.id,
      actorRole: appUser.role,
    });
  } catch (error) {
    if (error instanceof PendingCreditNoteApprovalError) {
      return serializePendingCreditNoteAction(error);
    }
    return { kind: "error", errors: { _global: [posActionErrorMessage(error)] } };
  }

  revalidatePOSPaths(orderId);
  return { kind: "success" };
}

export async function upgradeOrderPackageItemAction(
  orderId: string,
  _prev: POSCompositionActionState,
  formData: FormData
): Promise<POSCompositionActionState> {
  const parsed = upgradeOrderPackageItemSchema.safeParse({
    orderPackageId: formData.get("orderPackageId"),
    packageItemId: formData.get("packageItemId"),
    newProductId: formData.get("newProductId"),
  });

  if (!parsed.success) {
    return { kind: "error", errors: parsed.error.flatten().fieldErrors };
  }

  try {
    const appUser = await requireCurrentAppUserPermission(
      PERMISSIONS.ORDER_FINANCIAL_UPDATE
    );
    await upgradeOrderPackageItem(orderId, parsed.data, {
      actorUserId: appUser.id,
      actorRole: appUser.role,
    });
  } catch (error) {
    if (error instanceof PendingCreditNoteApprovalError) {
      return serializePendingCreditNoteAction(error);
    }
    return {
      kind: "error",
      errors: {
        _global: [posActionErrorMessage(error)],
      },
    };
  }

  revalidatePOSPaths(orderId);
  return { kind: "success" };
}

export async function addOrderProductAddOnAction(
  orderId: string,
  _prev: POSCompositionActionState,
  formData: FormData
): Promise<POSCompositionActionState> {
  const parsed = addOrderProductAddOnSchema.safeParse({
    productId: formData.get("productId"),
  });

  if (!parsed.success) {
    return { kind: "error", errors: parsed.error.flatten().fieldErrors };
  }

  try {
    const appUser = await requireCurrentAppUserPermission(
      PERMISSIONS.ORDER_FINANCIAL_UPDATE
    );
    await addOrderProductAddOn(orderId, parsed.data, {
      actorUserId: appUser.id,
      actorRole: appUser.role,
    });
  } catch (error) {
    return { kind: "error", errors: { _global: [posActionErrorMessage(error)] } };
  }

  revalidatePOSPaths(orderId);
  return { kind: "success" };
}

export async function removeOrderAddOnAction(
  orderId: string,
  _prev: POSCompositionActionState,
  formData: FormData
): Promise<POSCompositionActionState> {
  const parsed = removeOrderAddOnSchema.safeParse({
    addOnId: formData.get("addOnId"),
  });

  if (!parsed.success) {
    return { kind: "error", errors: parsed.error.flatten().fieldErrors };
  }

  try {
    const appUser = await requireCurrentAppUserPermission(
      PERMISSIONS.ORDER_FINANCIAL_UPDATE
    );
    await removeOrderAddOn(orderId, parsed.data, {
      actorUserId: appUser.id,
      actorRole: appUser.role,
    });
  } catch (error) {
    if (error instanceof PendingCreditNoteApprovalError) {
      return serializePendingCreditNoteAction(error);
    }
    return {
      kind: "error",
      errors: {
        _global: [posActionErrorMessage(error)],
      },
    };
  }

  revalidatePOSPaths(orderId);
  return { kind: "success" };
}

export async function updateOrderSelectedPhotoCountAction(
  orderId: string,
  _prev: POSCompositionActionState,
  formData: FormData
): Promise<POSCompositionActionState> {
  const parsed = updateOrderSelectedPhotoCountSchema.safeParse({
    orderPackageId: formData.get("orderPackageId"),
    selectedPhotoCount: formData.get("selectedPhotoCount"),
    extraDigitalCount: formData.get("extraDigitalCount"),
    extraPrintCount: formData.get("extraPrintCount"),
  });

  if (!parsed.success) {
    return { kind: "error", errors: parsed.error.flatten().fieldErrors };
  }

  try {
    const appUser = await requireCurrentAppUserPermission(
      PERMISSIONS.ORDER_FINANCIAL_UPDATE
    );
    await updateOrderSelectedPhotoCount(orderId, parsed.data, {
      actorUserId: appUser.id,
      actorRole: appUser.role,
    });
  } catch (error) {
    if (error instanceof PendingCreditNoteApprovalError) {
      return serializePendingCreditNoteAction(error);
    }
    return {
      kind: "error",
      errors: {
        _global: [posActionErrorMessage(error)],
      },
    };
  }

  revalidatePOSPaths(orderId);
  return { kind: "success" };
}

export async function confirmReductiveEditWithApproval(
  orderId: string,
  _prev: POSCompositionActionState,
  formData: FormData
): Promise<POSCompositionActionState> {
  const action = formData.get("reductiveAction");
  if (!isReductiveEditAction(action)) {
    return {
      kind: "error",
      errors: { _global: ["Reduction action is required"] },
    };
  }

  const approval = parseReductionApproval(formData);
  if (!approval.managerApprovedReductionByUserId) {
    return {
      kind: "error",
      errors: { managerApprovedReductionByUserId: ["Manager approval is required"] },
    };
  }

  try {
    const appUser = await requireCurrentAppUserPermission(
      PERMISSIONS.ORDER_FINANCIAL_UPDATE
    );
    await executeReductiveEdit(action, orderId, formData, approval, {
      actorUserId: appUser.id,
      actorRole: appUser.role,
    });
  } catch (error) {
    console.error("Approved reductive POS edit failed", error);
    return { kind: "error", errors: { _global: [posActionErrorMessage(error)] } };
  }

  revalidatePOSPaths(orderId);
  return { kind: "success" };
}

export async function recordPOSPaymentAction(
  orderId: string,
  invoiceId: string,
  _prev: POSRecordPaymentActionState,
  formData: FormData
): Promise<POSRecordPaymentActionState> {
  const parsedDateTime = posPaymentDateTimeSchema.safeParse({
    paidDate: formData.get("paidDate"),
    paidTime: formData.get("paidTime"),
  });

  if (!parsedDateTime.success) {
    return { errors: parsedDateTime.error.flatten().fieldErrors };
  }

  const paidAt = combineLocalDateTime(
    parsedDateTime.data.paidDate,
    parsedDateTime.data.paidTime
  );
  if (!paidAt) {
    return { errors: { paidAt: ["Payment date and time are invalid"] } };
  }

  const workspace = await getPOSWorkspace(orderId);
  const invoice = findPOSPayableInvoice(workspace, invoiceId);
  if (!workspace || !invoice) {
    return { errors: { _global: ["No invoice exists for this order."] } };
  }

  const parsed = recordPaymentSchema.safeParse({
    amount: formData.get("amount"),
    method: formData.get("method"),
    paymentType:
      invoice.invoiceType === InvoiceType.ADJUSTMENT
        ? PaymentType.ADJUSTMENT
        : PaymentType.FINAL,
    paidAt,
    reference: formData.get("reference") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  try {
    const appUser = await requireCurrentAppUserPermission(PERMISSIONS.PAYMENT_CREATE);
    if (invoice.remainingAmount <= 0) {
      return { errors: { _global: ["No outstanding balance remains on this invoice."] } };
    }
    if (parsed.data.amount > invoice.remainingAmount) {
      return {
        errors: {
          amount: ["Payment amount cannot exceed the remaining invoice balance."],
        },
      };
    }

    const selectionStatus =
      invoice.invoiceType === InvoiceType.FINAL &&
      workspace.orderStatusRaw === OrderStatus.WAITING_SELECTION
        ? parseRequiredSelectionStatus(formData)
        : undefined;
    if (selectionStatus instanceof Error) {
      return { errors: { selectionStatus: [selectionStatus.message] } };
    }

    await recordPOSPaymentForOrder(orderId, invoiceId, {
      payment: parsed.data,
      selectionStatus,
    }, {
      actorUserId: appUser.id,
      actorRole: appUser.role,
    });
  } catch (error) {
    return { errors: { _global: [posActionErrorMessage(error)] } };
  }

  revalidatePOSPaymentPaths(orderId, invoiceId);
  return { success: "Payment recorded." };
}

function findPOSPayableInvoice(
  workspace: Awaited<ReturnType<typeof getPOSWorkspace>>,
  invoiceId: string
) {
  if (!workspace) return null;
  const invoices = [
    ...(workspace.invoice ? [workspace.invoice] : []),
    ...workspace.adjustmentInvoices,
  ];

  return invoices.find((invoice) => invoice.invoiceId === invoiceId) ?? null;
}

function revalidatePOSPaths(orderId: string): void {
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}/sales`);
  revalidatePath("/invoices");
}

function parseReductionApproval(formData: FormData): {
  managerApprovedReductionByUserId?: string;
  managerApprovedReason?: string;
} {
  const managerValue = formData.get("managerApprovedReductionByUserId");
  const reasonValue = formData.get("managerApprovedReason");

  return {
    managerApprovedReductionByUserId:
      typeof managerValue === "string" && managerValue.trim()
        ? managerValue.trim()
        : undefined,
    managerApprovedReason:
      typeof reasonValue === "string" && reasonValue.trim()
        ? reasonValue.trim()
        : undefined,
  };
}

async function executeReductiveEdit(
  action: ReductiveEditAction,
  orderId: string,
  formData: FormData,
  approval: {
    managerApprovedReductionByUserId?: string;
    managerApprovedReason?: string;
  },
  actor: { actorUserId: string; actorRole: Awaited<ReturnType<typeof requireCurrentAppUserPermission>>["role"] }
): Promise<void> {
  if (action === "update-package") {
    const parsed = updateOrderPackageSchema.safeParse({
      orderPackageId: formData.get("orderPackageId"),
      packageId: formData.get("packageId"),
      ...approval,
    });
    if (!parsed.success) {
      throw new Error(firstZodError(parsed.error) ?? "Unable to update package");
    }
    await updateOrderPackage(orderId, parsed.data, actor);
    return;
  }

  if (action === "upgrade-package-item") {
    const parsed = upgradeOrderPackageItemSchema.safeParse({
      orderPackageId: formData.get("orderPackageId"),
      packageItemId: formData.get("packageItemId"),
      newProductId: formData.get("newProductId"),
      ...approval,
    });
    if (!parsed.success) {
      throw new Error(firstZodError(parsed.error) ?? "Unable to upgrade package item");
    }
    await upgradeOrderPackageItem(orderId, parsed.data, actor);
    return;
  }

  if (action === "remove-add-on") {
    const parsed = removeOrderAddOnSchema.safeParse({
      addOnId: formData.get("addOnId"),
      ...approval,
    });
    if (!parsed.success) {
      throw new Error(firstZodError(parsed.error) ?? "Unable to remove add-on");
    }
    await removeOrderAddOn(orderId, parsed.data, actor);
    return;
  }

  const parsed = updateOrderSelectedPhotoCountSchema.safeParse({
    orderPackageId: formData.get("orderPackageId"),
    selectedPhotoCount: formData.get("selectedPhotoCount"),
    extraDigitalCount: formData.get("extraDigitalCount"),
    extraPrintCount: formData.get("extraPrintCount"),
    ...approval,
  });
  if (!parsed.success) {
    throw new Error(firstZodError(parsed.error) ?? "Unable to update selected photos");
  }
  await updateOrderSelectedPhotoCount(orderId, parsed.data, actor);
}

function serializePendingCreditNoteAction(
  error: PendingCreditNoteApprovalError
): POSCompositionActionState {
  return {
    kind: "approval-required",
    payload: serializePendingCreditNote(error),
  };
}

function serializePendingCreditNote(error: PendingCreditNoteApprovalError) {
  return {
    reductions: error.reductions.map((reduction) => ({
      lineName: reduction.lineSnapshot.name,
      amount: reduction.amount.toFixed(3),
      reason: reduction.reason,
    })),
    adjustmentLines: error.adjustmentLines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice.toFixed(3),
    })),
  };
}

function isReductiveEditAction(value: FormDataEntryValue | null): value is ReductiveEditAction {
  return (
    value === "update-package" ||
    value === "upgrade-package-item" ||
    value === "remove-add-on" ||
    value === "update-selected-photo-count"
  );
}

function firstZodError(error: z.ZodError): string | null {
  return error.issues[0]?.message ?? null;
}

function revalidatePOSPaymentPaths(orderId: string, invoiceId: string): void {
  revalidatePOSPaths(orderId);
  revalidatePath(`/invoices/${invoiceId}`);
}

function combineLocalDateTime(dateValue: string, timeValue: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeValue);
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const monthIndex = Number(dateMatch[2]) - 1;
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const paidAt = new Date(year, monthIndex, day, hour, minute);

  if (
    paidAt.getFullYear() !== year ||
    paidAt.getMonth() !== monthIndex ||
    paidAt.getDate() !== day ||
    paidAt.getHours() !== hour ||
    paidAt.getMinutes() !== minute
  ) {
    return null;
  }

  return paidAt;
}

function parseRequiredSelectionStatus(
  formData: FormData
): OrderSelectionStatus | Error {
  const parsed = posPaymentSelectionSchema.safeParse({
    selectionStatus: formData.get("selectionStatus"),
  });
  if (!parsed.success) {
    return new Error("Selection status is required");
  }

  return parsed.data.selectionStatus;
}

const SAFE_POS_ERROR_MESSAGES = new Set([
  "Delivered orders cannot be edited",
  "Digital and print extra allocations must equal the derived extra-photo count.",
  "Invoice is locked. Use the adjustment flow before changing add-ons.",
  "Invoice is locked. Use the adjustment flow before changing package composition.",
  "Invoice is locked. Use the adjustment flow before changing selected photos.",
  "Locked invoices can only be changed through an Adjustment Workspace.",
  "Invoice does not belong to this order",
  "Manager permission is required to issue a credit note",
  "Manager permission is required to issue an adjustment invoice",
  "No outstanding balance remains on this invoice",
  "Package item is not part of the current order package",
  "Package line not found on this order",
  "Payment amount cannot exceed the remaining invoice balance",
  "Replacement product is already included",
  "Replacement product is not available",
  "Replacement product must be in the same category",
  "Selected add-on is not on this order",
  "Selected add-on product is not available",
  "Selected package is not available",
  "Selected photos cannot be below included package photos",
  "Use selected photo count for extra photos",
]);

function posActionErrorMessage(error: unknown): string {
  console.error("Unknown POS action error", error);

  if (
    error instanceof Error &&
    SAFE_POS_ERROR_MESSAGES.has(error.message.trim())
  ) {
    return error.message;
  }

  return "Unable to save POS changes";
}
