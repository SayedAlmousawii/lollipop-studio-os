"use server";

import { revalidatePath } from "next/cache";
import { PaymentType } from "@prisma/client";
import { z } from "zod";
import { PERMISSIONS, requireCurrentAppUserPermission } from "@/lib/permissions";
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
  updateOrderPackage,
  updateOrderSelectedPhotoCount,
  upgradeOrderPackageItem,
} from "@/modules/orders/order.service";
import { recordPaymentSchema } from "@/modules/payments/payment.schema";
import { recordPayment } from "@/modules/payments/payment.service";

export type POSCompositionActionState = {
  errors?: Partial<Record<string, string[]>>;
};

export type POSRecordPaymentActionState = {
  errors?: Partial<Record<string, string[]>>;
  success?: string;
};

const posPaymentDateTimeSchema = z.object({
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Payment date is required"),
  paidTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Payment time is required"),
});

export async function updateOrderPackageAction(
  orderId: string,
  _prev: POSCompositionActionState,
  formData: FormData
): Promise<POSCompositionActionState> {
  const parsed = updateOrderPackageSchema.safeParse({
    packageId: formData.get("packageId"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
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
    return { errors: { _global: [safePOSActionMessage(error, "Unable to update package")] } };
  }

  revalidatePOSPaths(orderId);
  return {};
}

export async function upgradeOrderPackageItemAction(
  orderId: string,
  _prev: POSCompositionActionState,
  formData: FormData
): Promise<POSCompositionActionState> {
  const parsed = upgradeOrderPackageItemSchema.safeParse({
    packageItemId: formData.get("packageItemId"),
    newProductId: formData.get("newProductId"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
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
    return {
      errors: {
        _global: [safePOSActionMessage(error, "Unable to upgrade package item")],
      },
    };
  }

  revalidatePOSPaths(orderId);
  return {};
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
    return { errors: parsed.error.flatten().fieldErrors };
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
    return { errors: { _global: [safePOSActionMessage(error, "Unable to add order add-on")] } };
  }

  revalidatePOSPaths(orderId);
  return {};
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
    return { errors: parsed.error.flatten().fieldErrors };
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
    return {
      errors: {
        _global: [safePOSActionMessage(error, "Unable to remove order add-on")],
      },
    };
  }

  revalidatePOSPaths(orderId);
  return {};
}

export async function updateOrderSelectedPhotoCountAction(
  orderId: string,
  _prev: POSCompositionActionState,
  formData: FormData
): Promise<POSCompositionActionState> {
  const parsed = updateOrderSelectedPhotoCountSchema.safeParse({
    selectedPhotoCount: formData.get("selectedPhotoCount"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
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
    return {
      errors: {
        _global: [safePOSActionMessage(error, "Unable to update selected photos")],
      },
    };
  }

  revalidatePOSPaths(orderId);
  return {};
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

  const parsed = recordPaymentSchema.safeParse({
    amount: formData.get("amount"),
    method: formData.get("method"),
    paymentType: PaymentType.FINAL,
    paidAt,
    reference: formData.get("reference") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  try {
    const appUser = await requireCurrentAppUserPermission(PERMISSIONS.PAYMENT_CREATE);
    const workspace = await getPOSWorkspace(orderId);
    const invoice = workspace?.invoice;
    if (!workspace || !invoice) {
      return { errors: { _global: ["No invoice exists for this order."] } };
    }
    if (invoice.invoiceId !== invoiceId) {
      return { errors: { _global: ["Invoice does not belong to this order."] } };
    }
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

    await recordPayment(invoiceId, parsed.data, {
      actorUserId: appUser.id,
      actorRole: appUser.role,
    });
  } catch (error) {
    return { errors: { _global: [safePOSActionMessage(error, "Unable to record payment")] } };
  }

  revalidatePOSPaymentPaths(orderId, invoiceId);
  return { success: "Payment recorded." };
}

function revalidatePOSPaths(orderId: string): void {
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}/sales`);
  revalidatePath("/invoices");
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

const SAFE_POS_DOMAIN_MESSAGES = new Set([
  "Delivered orders cannot be edited",
  "Invoice is locked. Use the adjustment flow before changing package composition.",
  "Selected package is not available",
  "Package item is not part of the current order package",
  "Replacement product is not available",
  "Replacement product must be in the same category",
  "Replacement product is already included",
  "Invoice is locked. Use the adjustment flow before changing add-ons.",
  "Invoice is locked. Use the adjustment flow before changing selected photos.",
  "Selected add-on product is not available",
  "Selected add-on is not on this order",
  "Selected photos cannot be below included package photos",
  "Use selected photo count for extra photos",
  "No outstanding balance remains on this invoice",
  "Payment amount cannot exceed the remaining invoice balance",
]);

function safePOSActionMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && SAFE_POS_DOMAIN_MESSAGES.has(error.message)) {
    return error.message;
  }

  console.error(fallback, error);
  return fallback;
}
