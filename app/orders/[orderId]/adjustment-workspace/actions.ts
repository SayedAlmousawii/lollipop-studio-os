"use server";

import type { HandlerResult } from "@/modules/orders/pos-handlers.types";

const ADJUSTMENT_WORKSPACE_RETIRED_MESSAGE =
  "Adjustment Workspace is retired — use POS";

class AdjustmentWorkspaceRetiredError extends Error {
  constructor() {
    super(ADJUSTMENT_WORKSPACE_RETIRED_MESSAGE);
    this.name = "AdjustmentWorkspaceRetiredError";
  }
}

function refuseAdjustmentWorkspaceRoute(...args: unknown[]): never {
  void args;
  throw new AdjustmentWorkspaceRetiredError();
}

export async function openAdjustmentWorkspaceAction(
  orderId: string,
  invoiceId: string
) {
  refuseAdjustmentWorkspaceRoute(orderId, invoiceId);
}

export async function takeOverAdjustmentWorkspaceAction(
  orderId: string,
  workspaceId: string
) {
  refuseAdjustmentWorkspaceRoute(orderId, workspaceId);
}

export async function addWorkspaceLineAction(
  orderId: string,
  workspaceId: string,
  formData: FormData
) {
  refuseAdjustmentWorkspaceRoute(orderId, workspaceId, formData);
}

export async function removeWorkspaceLineAction(
  orderId: string,
  workspaceId: string,
  formData: FormData
) {
  refuseAdjustmentWorkspaceRoute(orderId, workspaceId, formData);
}

export async function modifyWorkspaceLineQuantityAction(
  orderId: string,
  workspaceId: string,
  formData: FormData
) {
  refuseAdjustmentWorkspaceRoute(orderId, workspaceId, formData);
}

export async function swapWorkspacePackageAction(
  orderId: string,
  workspaceId: string,
  formData: FormData
) {
  refuseAdjustmentWorkspaceRoute(orderId, workspaceId, formData);
}

export async function stagePackageTierChangeAction(
  orderId: string,
  workspaceId: string,
  input: {
    version?: number;
    orderPackageId: string;
    toPackageRefId: string;
  }
): Promise<HandlerResult> {
  refuseAdjustmentWorkspaceRoute(orderId, workspaceId, input);
}

export async function stagePackageItemUpgradeAction(
  orderId: string,
  workspaceId: string,
  input: {
    version?: number;
    orderPackageId: string;
    packageItemId: string;
    toProductId: string;
    quantity: number;
  }
): Promise<HandlerResult> {
  refuseAdjustmentWorkspaceRoute(orderId, workspaceId, input);
}

export async function stageSelectedPhotoCountChangeAction(
  orderId: string,
  workspaceId: string,
  input: {
    version?: number;
    orderPackageId: string;
    selectedPhotoCount: number;
    extraDigitalCount: number;
    extraPrintCount: number;
  }
): Promise<HandlerResult> {
  refuseAdjustmentWorkspaceRoute(orderId, workspaceId, input);
}

export async function stageMarketplaceAddOnAction(
  orderId: string,
  workspaceId: string,
  input: { version?: number; productId: string; quantity: number }
): Promise<HandlerResult> {
  refuseAdjustmentWorkspaceRoute(orderId, workspaceId, input);
}

export async function stageMarketplaceAddOnRemovalAction(
  orderId: string,
  workspaceId: string,
  input: { version?: number; addOnId: string }
): Promise<HandlerResult> {
  refuseAdjustmentWorkspaceRoute(orderId, workspaceId, input);
}

export async function stageMarketplaceAddOnQuantityAction(
  orderId: string,
  workspaceId: string,
  input: { version?: number; addOnId: string; quantity: number }
): Promise<HandlerResult> {
  refuseAdjustmentWorkspaceRoute(orderId, workspaceId, input);
}

export async function removeWorkspaceEditAction(
  orderId: string,
  workspaceId: string,
  formData: FormData
) {
  refuseAdjustmentWorkspaceRoute(orderId, workspaceId, formData);
}

export async function cancelAdjustmentWorkspaceAction(
  orderId: string,
  workspaceId: string,
  formData: FormData
) {
  refuseAdjustmentWorkspaceRoute(orderId, workspaceId, formData);
}

export async function finalizeAdjustmentWorkspaceAction(
  orderId: string,
  workspaceId: string,
  formData: FormData
) {
  refuseAdjustmentWorkspaceRoute(orderId, workspaceId, formData);
}
