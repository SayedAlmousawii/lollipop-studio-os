"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PERMISSIONS, requireCurrentAppUserPermission } from "@/lib/permissions";
import {
  AdjustmentWorkspaceApprovalRequiredError,
  applyEdit,
  cancelWorkspace,
  finalizeWorkspace,
  openWorkspace,
  removeEdit,
  takeOverWorkspace,
} from "@/modules/adjustment-workspace/adjustment-workspace.service";
import { adjustmentWorkspaceVersionSchema } from "@/modules/adjustment-workspace/adjustment-workspace.schema";

const addLineFormSchema = adjustmentWorkspaceVersionSchema.extend({
  kind: z.enum(["item", "addon"]),
  refId: z.string().trim().min(1, "Catalog item is required"),
  quantity: z.coerce.number().int().positive("Quantity must be at least 1"),
});

const removeLineFormSchema = adjustmentWorkspaceVersionSchema.extend({
  targetLineId: z.string().trim().min(1, "Line is required"),
});

const modifyQuantityFormSchema = adjustmentWorkspaceVersionSchema.extend({
  targetLineId: z.string().trim().min(1, "Line is required"),
  newQuantity: z.coerce.number().int().min(0, "Quantity cannot be negative"),
});

const swapPackageFormSchema = adjustmentWorkspaceVersionSchema.extend({
  fromPackageRefId: z.string().trim().min(1, "Current package is required"),
  toPackageRefId: z.string().trim().min(1, "Replacement package is required"),
});

const finalizeFormSchema = adjustmentWorkspaceVersionSchema.extend({
  managerApprovedReductionByUserId: z.string().trim().optional(),
  managerApprovedReason: z.string().trim().optional(),
});

export async function openAdjustmentWorkspaceAction(
  orderId: string,
  invoiceId: string
) {
  const appUser = await requireCurrentAppUserPermission(
    PERMISSIONS.ORDER_FINANCIAL_UPDATE
  );
  await openWorkspace(invoiceId, {
    actorUserId: appUser.id,
    actorRole: appUser.role,
  });
  revalidateWorkspacePaths(orderId);
  redirect(`/orders/${orderId}/adjustment-workspace`);
}

export async function takeOverAdjustmentWorkspaceAction(
  orderId: string,
  workspaceId: string
) {
  const appUser = await requireCurrentAppUserPermission(
    PERMISSIONS.ORDER_FINANCIAL_UPDATE
  );
  await takeOverWorkspace(workspaceId, {
    actorUserId: appUser.id,
    actorRole: appUser.role,
  });
  revalidateWorkspacePaths(orderId);
}

export async function addWorkspaceLineAction(
  orderId: string,
  workspaceId: string,
  formData: FormData
) {
  const parsed = addLineFormSchema.parse({
    version: formData.get("version"),
    kind: formData.get("kind"),
    refId: formData.get("refId"),
    quantity: formData.get("quantity"),
  });
  const appUser = await requireCurrentAppUserPermission(
    PERMISSIONS.ORDER_FINANCIAL_UPDATE
  );
  await applyEdit(
    workspaceId,
    {
      version: parsed.version,
      edit: {
        id: crypto.randomUUID(),
        op: "add_line",
        kind: parsed.kind,
        refId: parsed.refId,
        quantity: parsed.quantity,
      },
    },
    { actorUserId: appUser.id, actorRole: appUser.role }
  );
  revalidateWorkspacePaths(orderId);
}

export async function removeWorkspaceLineAction(
  orderId: string,
  workspaceId: string,
  formData: FormData
) {
  const parsed = removeLineFormSchema.parse({
    version: formData.get("version"),
    targetLineId: formData.get("targetLineId"),
  });
  const appUser = await requireCurrentAppUserPermission(
    PERMISSIONS.ORDER_FINANCIAL_UPDATE
  );
  await applyEdit(
    workspaceId,
    {
      version: parsed.version,
      edit: {
        id: crypto.randomUUID(),
        op: "remove_line",
        targetLineId: parsed.targetLineId,
      },
    },
    { actorUserId: appUser.id, actorRole: appUser.role }
  );
  revalidateWorkspacePaths(orderId);
}

export async function modifyWorkspaceLineQuantityAction(
  orderId: string,
  workspaceId: string,
  formData: FormData
) {
  const parsed = modifyQuantityFormSchema.parse({
    version: formData.get("version"),
    targetLineId: formData.get("targetLineId"),
    newQuantity: formData.get("newQuantity"),
  });
  const appUser = await requireCurrentAppUserPermission(
    PERMISSIONS.ORDER_FINANCIAL_UPDATE
  );
  await applyEdit(
    workspaceId,
    {
      version: parsed.version,
      edit: {
        id: `qty:${parsed.targetLineId}`,
        op: "modify_quantity",
        targetLineId: parsed.targetLineId,
        newQuantity: parsed.newQuantity,
      },
    },
    { actorUserId: appUser.id, actorRole: appUser.role }
  );
  revalidateWorkspacePaths(orderId);
}

export async function swapWorkspacePackageAction(
  orderId: string,
  workspaceId: string,
  formData: FormData
) {
  const parsed = swapPackageFormSchema.parse({
    version: formData.get("version"),
    fromPackageRefId: formData.get("fromPackageRefId"),
    toPackageRefId: formData.get("toPackageRefId"),
  });
  const appUser = await requireCurrentAppUserPermission(
    PERMISSIONS.ORDER_FINANCIAL_UPDATE
  );
  await applyEdit(
    workspaceId,
    {
      version: parsed.version,
      edit: {
        id: `swap-package:${parsed.fromPackageRefId}`,
        op: "swap_package",
        fromPackageRefId: parsed.fromPackageRefId,
        toPackageRefId: parsed.toPackageRefId,
      },
    },
    { actorUserId: appUser.id, actorRole: appUser.role }
  );
  revalidateWorkspacePaths(orderId);
}

export async function removeWorkspaceEditAction(
  orderId: string,
  workspaceId: string,
  formData: FormData
) {
  const parsed = z.object({
    version: z.coerce.number().int().min(0),
    editId: z.string().trim().min(1),
  }).parse({
    version: formData.get("version"),
    editId: formData.get("editId"),
  });
  const appUser = await requireCurrentAppUserPermission(
    PERMISSIONS.ORDER_FINANCIAL_UPDATE
  );
  await removeEdit(
    workspaceId,
    { version: parsed.version, editId: parsed.editId },
    { actorUserId: appUser.id, actorRole: appUser.role }
  );
  revalidateWorkspacePaths(orderId);
}

export async function cancelAdjustmentWorkspaceAction(
  orderId: string,
  workspaceId: string,
  formData: FormData
) {
  const parsed = adjustmentWorkspaceVersionSchema.parse({
    version: formData.get("version"),
  });
  const appUser = await requireCurrentAppUserPermission(
    PERMISSIONS.ORDER_FINANCIAL_UPDATE
  );
  await cancelWorkspace(
    workspaceId,
    { version: parsed.version, reason: "cancelled_by_user" },
    { actorUserId: appUser.id, actorRole: appUser.role }
  );
  revalidateWorkspacePaths(orderId);
  redirect(`/orders/${orderId}/sales`);
}

export async function finalizeAdjustmentWorkspaceAction(
  orderId: string,
  workspaceId: string,
  formData: FormData
) {
  const parsed = finalizeFormSchema.parse({
    version: formData.get("version"),
    managerApprovedReductionByUserId:
      formData.get("managerApprovedReductionByUserId") || undefined,
    managerApprovedReason: formData.get("managerApprovedReason") || undefined,
  });
  const appUser = await requireCurrentAppUserPermission(
    PERMISSIONS.ORDER_FINANCIAL_UPDATE
  );

  try {
    await finalizeWorkspace(
      workspaceId,
      parsed,
      { actorUserId: appUser.id, actorRole: appUser.role }
    );
  } catch (error) {
    if (error instanceof AdjustmentWorkspaceApprovalRequiredError) {
      throw new Error("Manager approval is required to finalize this workspace.");
    }
    throw error;
  }

  revalidateWorkspacePaths(orderId);
  redirect(`/orders/${orderId}/sales`);
}

function revalidateWorkspacePaths(orderId: string): void {
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}/sales`);
  revalidatePath(`/orders/${orderId}/adjustment-workspace`);
  revalidatePath("/invoices");
}
