"use server";

import { revalidatePath } from "next/cache";
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
  removeOrderAddOn,
  updateOrderPackage,
  updateOrderSelectedPhotoCount,
  upgradeOrderPackageItem,
} from "@/modules/orders/order.service";

export type POSCompositionActionState = {
  errors?: Partial<Record<string, string[]>>;
};

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

function revalidatePOSPaths(orderId: string): void {
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}/sales`);
  revalidatePath("/invoices");
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
]);

function safePOSActionMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && SAFE_POS_DOMAIN_MESSAGES.has(error.message)) {
    return error.message;
  }

  console.error(fallback, error);
  return fallback;
}
