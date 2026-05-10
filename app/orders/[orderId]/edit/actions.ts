"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  PERMISSIONS,
  requireCurrentAppUserPermission,
} from "@/lib/permissions";
import { updateOrderSchema } from "@/modules/orders/order.schema";
import { updateOrder } from "@/modules/orders/order.service";

export type UpdateOrderActionState = {
  errors?: Partial<Record<string, string[]>>;
};

export async function updateOrderAction(
  orderId: string,
  _prev: UpdateOrderActionState,
  formData: FormData
): Promise<UpdateOrderActionState> {
  const addOnNames = formData.getAll("addOnName");
  const addOnPrices = formData.getAll("addOnPrice");
  const addOns = addOnNames.flatMap((name, index) => {
    const price = addOnPrices[index];
    const addOnName = typeof name === "string" ? name.trim() : "";
    const addOnPrice = typeof price === "string" ? price : "";

    if (!addOnName && !addOnPrice) return [];

    return [{ name: addOnName, price: addOnPrice }];
  });

  const parsed = updateOrderSchema.safeParse({
    finalPackageId: formData.get("finalPackageId"),
    selectedPhotos: formData.get("selectedPhotos"),
    addOns,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  try {
    const appUser = await requireCurrentAppUserPermission(
      PERMISSIONS.ORDER_FINANCIAL_UPDATE
    );
    await updateOrder(orderId, parsed.data, {
      actorUserId: appUser.id, actorRole: appUser.role,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update order";
    return { errors: { _global: [message] } };
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  redirect(`/orders/${orderId}`);
}
