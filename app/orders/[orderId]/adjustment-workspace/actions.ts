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
  getAdjustmentWorkspaceView,
  openWorkspace,
  removeEdit,
  takeOverWorkspace,
} from "@/modules/adjustment-workspace/adjustment-workspace.service";
import { adjustmentWorkspaceVersionSchema } from "@/modules/adjustment-workspace/adjustment-workspace.schema";
import type { AdjustmentWorkspaceEdit } from "@/modules/adjustment-workspace/adjustment-workspace.types";
import type { HandlerResult } from "@/modules/orders/pos-handlers.types";

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

const stagePackageTierChangeSchema = adjustmentWorkspaceVersionSchema.extend({
  orderPackageId: z.string().trim().min(1, "Package line is required"),
  toPackageRefId: z.string().trim().min(1, "Replacement package is required"),
});

const stagePackageItemUpgradeSchema = adjustmentWorkspaceVersionSchema.extend({
  orderPackageId: z.string().trim().min(1, "Package line is required"),
  packageItemId: z.string().trim().min(1, "Package item is required"),
  toProductId: z.string().trim().min(1, "Replacement product is required"),
  quantity: z.coerce.number().int().positive("Quantity must be at least 1"),
});

const stageSelectedPhotoCountSchema = adjustmentWorkspaceVersionSchema.extend({
  orderPackageId: z.string().trim().min(1, "Package line is required"),
  selectedPhotoCount: z.coerce
    .number()
    .int()
    .min(0, "Selected photos cannot be negative"),
  extraDigitalCount: z.coerce
    .number()
    .int()
    .min(0, "Digital extras cannot be negative"),
  extraPrintCount: z.coerce
    .number()
    .int()
    .min(0, "Print extras cannot be negative"),
});

const stageMarketplaceAddOnSchema = adjustmentWorkspaceVersionSchema.extend({
  productId: z.string().trim().min(1, "Add-on is required"),
  quantity: z.coerce.number().int().positive("Quantity must be at least 1"),
});

const stageMarketplaceAddOnRemovalSchema = adjustmentWorkspaceVersionSchema.extend({
  addOnId: z.string().trim().min(1, "Add-on is required"),
});

const stageMarketplaceAddOnQuantitySchema = stageMarketplaceAddOnRemovalSchema.extend({
  quantity: z.coerce.number().int().min(0, "Quantity cannot be negative"),
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

export async function stagePackageTierChangeAction(
  orderId: string,
  workspaceId: string,
  input: {
    version: number;
    orderPackageId: string;
    toPackageRefId: string;
  }
): Promise<HandlerResult> {
  const parsed = stagePackageTierChangeSchema.safeParse(input);
  if (!parsed.success) return zodHandlerError(parsed.error);

  return stageWorkspaceEdit(orderId, workspaceId, parsed.data.version, {
    id: `tier:${parsed.data.orderPackageId}`,
    op: "change_package_tier",
    orderPackageId: parsed.data.orderPackageId,
    toPackageRefId: parsed.data.toPackageRefId,
  });
}

export async function stagePackageItemUpgradeAction(
  orderId: string,
  workspaceId: string,
  input: {
    version: number;
    orderPackageId: string;
    packageItemId: string;
    toProductId: string;
    quantity: number;
  }
): Promise<HandlerResult> {
  const parsed = stagePackageItemUpgradeSchema.safeParse(input);
  if (!parsed.success) return zodHandlerError(parsed.error);

  return stageWorkspaceEdit(orderId, workspaceId, parsed.data.version, {
    id: `upgrade:${parsed.data.orderPackageId}:${parsed.data.packageItemId}`,
    op: "upgrade_package_item",
    orderPackageId: parsed.data.orderPackageId,
    packageItemId: parsed.data.packageItemId,
    toProductId: parsed.data.toProductId,
    quantity: parsed.data.quantity,
  });
}

export async function stageSelectedPhotoCountChangeAction(
  orderId: string,
  workspaceId: string,
  input: {
    version: number;
    orderPackageId: string;
    selectedPhotoCount: number;
    extraDigitalCount: number;
    extraPrintCount: number;
  }
): Promise<HandlerResult> {
  const parsed = stageSelectedPhotoCountSchema.safeParse(input);
  if (!parsed.success) return zodHandlerError(parsed.error);

  return stageWorkspaceEdit(orderId, workspaceId, parsed.data.version, {
    id: `photos:${parsed.data.orderPackageId}`,
    op: "change_selected_photo_count",
    orderPackageId: parsed.data.orderPackageId,
    selectedPhotoCount: parsed.data.selectedPhotoCount,
    extraDigitalCount: parsed.data.extraDigitalCount,
    extraPrintCount: parsed.data.extraPrintCount,
  });
}

export async function stageMarketplaceAddOnAction(
  orderId: string,
  workspaceId: string,
  input: { version: number; productId: string; quantity: number }
): Promise<HandlerResult> {
  const parsed = stageMarketplaceAddOnSchema.safeParse(input);
  if (!parsed.success) return zodHandlerError(parsed.error);

  return stageWorkspaceEdit(orderId, workspaceId, parsed.data.version, {
    id: crypto.randomUUID(),
    op: "add_line",
    kind: "addon",
    refId: parsed.data.productId,
    quantity: parsed.data.quantity,
  });
}

export async function stageMarketplaceAddOnRemovalAction(
  orderId: string,
  workspaceId: string,
  input: { version: number; addOnId: string }
): Promise<HandlerResult> {
  const parsed = stageMarketplaceAddOnRemovalSchema.safeParse(input);
  if (!parsed.success) return zodHandlerError(parsed.error);

  try {
    const workspace = await getAdjustmentWorkspaceView(workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    const line = workspace.proposal.proposed.lines.find(
      (candidate) => candidate.lineId === parsed.data.addOnId
    );
    if (!line) throw new Error("Selected add-on is not in the workspace");
    if (line.lineId.startsWith("edit:")) {
      return decrementStagedAddLine(orderId, workspaceId, parsed.data.version, line);
    }
    if (line.quantity > 1) {
      return stageWorkspaceEdit(orderId, workspaceId, parsed.data.version, {
        id: `qty:${line.lineId}`,
        op: "modify_quantity",
        targetLineId: line.lineId,
        newQuantity: line.quantity - 1,
      });
    }
    return stageWorkspaceEdit(orderId, workspaceId, parsed.data.version, {
      id: `remove:${line.lineId}`,
      op: "remove_line",
      targetLineId: line.lineId,
    });
  } catch (error) {
    return handlerError(error);
  }
}

export async function stageMarketplaceAddOnQuantityAction(
  orderId: string,
  workspaceId: string,
  input: { version: number; addOnId: string; quantity: number }
): Promise<HandlerResult> {
  const parsed = stageMarketplaceAddOnQuantitySchema.safeParse(input);
  if (!parsed.success) return zodHandlerError(parsed.error);

  try {
    const workspace = await getAdjustmentWorkspaceView(workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    const line = workspace.proposal.proposed.lines.find(
      (candidate) => candidate.lineId === parsed.data.addOnId
    );
    if (!line) throw new Error("Selected add-on is not in the workspace");
    if (line.lineId.startsWith("edit:")) {
      return resizeStagedAddLine(
        orderId,
        workspaceId,
        parsed.data.version,
        line,
        parsed.data.quantity
      );
    }
    if (parsed.data.quantity === 0) {
      return stageWorkspaceEdit(orderId, workspaceId, parsed.data.version, {
        id: `remove:${line.lineId}`,
        op: "remove_line",
        targetLineId: line.lineId,
      });
    }

    return stageWorkspaceEdit(orderId, workspaceId, parsed.data.version, {
      id: `qty:${line.lineId}`,
      op: "modify_quantity",
      targetLineId: line.lineId,
      newQuantity: parsed.data.quantity,
    });
  } catch (error) {
    return handlerError(error);
  }
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

async function stageWorkspaceEdit(
  orderId: string,
  workspaceId: string,
  version: number,
  edit: AdjustmentWorkspaceEdit
): Promise<HandlerResult> {
  try {
    const appUser = await requireCurrentAppUserPermission(
      PERMISSIONS.ORDER_FINANCIAL_UPDATE
    );
    await applyEdit(
      workspaceId,
      { version, edit },
      { actorUserId: appUser.id, actorRole: appUser.role }
    );
    revalidateWorkspacePaths(orderId);
    return { ok: true };
  } catch (error) {
    return handlerError(error);
  }
}

async function decrementStagedAddLine(
  orderId: string,
  workspaceId: string,
  version: number,
  line: { lineId: string; quantity: number }
): Promise<HandlerResult> {
  return resizeStagedAddLine(orderId, workspaceId, version, line, line.quantity - 1);
}

async function resizeStagedAddLine(
  orderId: string,
  workspaceId: string,
  version: number,
  line: { lineId: string; quantity: number },
  quantity: number
): Promise<HandlerResult> {
  const editId = line.lineId.slice("edit:".length);
  try {
    const appUser = await requireCurrentAppUserPermission(
      PERMISSIONS.ORDER_FINANCIAL_UPDATE
    );
    if (quantity <= 0) {
      await removeEdit(
        workspaceId,
        { version, editId },
        { actorUserId: appUser.id, actorRole: appUser.role }
      );
    } else {
      const workspace = await getAdjustmentWorkspaceView(workspaceId);
      const edit = workspace?.pendingChanges.edits.find(
        (candidate) => candidate.id === editId && candidate.op === "add_line"
      );
      if (!edit || edit.op !== "add_line") {
        throw new Error("Staged add-on edit was not found");
      }
      await applyEdit(
        workspaceId,
        { version, edit: { ...edit, quantity } },
        { actorUserId: appUser.id, actorRole: appUser.role }
      );
    }
    revalidateWorkspacePaths(orderId);
    return { ok: true };
  } catch (error) {
    return handlerError(error);
  }
}

function zodHandlerError(error: z.ZodError): HandlerResult {
  const fieldErrors = error.flatten().fieldErrors;
  const errors: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (Array.isArray(messages) && messages.length > 0) {
      errors[field] = messages;
    }
  }
  return { ok: false, errors };
}

function handlerError(error: unknown): HandlerResult {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : "Unable to stage workspace edit";
  return { ok: false, errors: { _global: [message] } };
}
