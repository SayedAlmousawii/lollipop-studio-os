"use server";

import { revalidatePath } from "next/cache";
import { PERMISSIONS, requireCurrentAppUserPermission } from "@/lib/permissions";
import {
  updateOrderPackageSchema,
  upgradeOrderPackageItemSchema,
} from "@/modules/orders/order.schema";
import {
  updateOrderPackage,
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
    const message =
      error instanceof Error ? error.message : "Unable to update package";
    return { errors: { _global: [message] } };
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
    const message =
      error instanceof Error ? error.message : "Unable to upgrade package item";
    return { errors: { _global: [message] } };
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
