import type {
  HandlerResult,
  POSAddOnHandlers,
  POSCompositionHandlers,
} from "@/modules/orders/pos-handlers.types";
import {
  stageMarketplaceAddOnAction,
  stageMarketplaceAddOnQuantityAction,
  stageMarketplaceAddOnRemovalAction,
  stagePackageItemUpgradeAction,
  stagePackageTierChangeAction,
  stageSelectedPhotoCountChangeAction,
} from "./actions";

export function createWorkspaceCompositionHandlers(
  orderId: string,
  workspaceId: string
): POSCompositionHandlers {
  assertWorkspaceHandlerIds(
    "createWorkspaceCompositionHandlers",
    orderId,
    workspaceId
  );

  async function changePackageTier(input: {
    orderPackageId: string;
    toPackageRefId: string;
  }): Promise<HandlerResult> {
    "use server";

    try {
      return await stagePackageTierChangeAction(orderId, workspaceId, input);
    } catch (error) {
      return workspaceHandlerError("changePackageTier", error);
    }
  }

  async function upgradePackageItem(input: {
    orderPackageId: string;
    packageItemId: string;
    toProductId: string;
    quantity: number;
  }): Promise<HandlerResult> {
    "use server";

    try {
      return await stagePackageItemUpgradeAction(orderId, workspaceId, input);
    } catch (error) {
      return workspaceHandlerError("upgradePackageItem", error);
    }
  }

  async function changeSelectedPhotoCount(input: {
    orderPackageId: string;
    selectedPhotoCount: number;
    extraDigitalCount: number;
    extraPrintCount: number;
  }): Promise<HandlerResult> {
    "use server";

    try {
      return await stageSelectedPhotoCountChangeAction(orderId, workspaceId, input);
    } catch (error) {
      return workspaceHandlerError("changeSelectedPhotoCount", error);
    }
  }

  return {
    changePackageTier,
    upgradePackageItem,
    changeSelectedPhotoCount,
    shouldPromptInlineApproval: false,
  };
}

export function createWorkspaceAddOnHandlers(
  orderId: string,
  workspaceId: string
): POSAddOnHandlers {
  assertWorkspaceHandlerIds("createWorkspaceAddOnHandlers", orderId, workspaceId);

  async function addAddOn(input: {
    productId: string;
    quantity: number;
  }): Promise<HandlerResult> {
    "use server";

    return retryWorkspaceHandler("addAddOn", () =>
      stageMarketplaceAddOnAction(orderId, workspaceId, input)
    );
  }

  async function removeAddOn(input: { addOnId: string }): Promise<HandlerResult> {
    "use server";

    return retryWorkspaceHandler("removeAddOn", () =>
      stageMarketplaceAddOnRemovalAction(orderId, workspaceId, input)
    );
  }

  async function changeAddOnQuantity(input: {
    addOnId: string;
    quantity: number;
  }): Promise<HandlerResult> {
    "use server";

    return retryWorkspaceHandler("changeAddOnQuantity", () =>
      stageMarketplaceAddOnQuantityAction(orderId, workspaceId, input)
    );
  }

  return {
    addAddOn,
    removeAddOn,
    changeAddOnQuantity,
    shouldPromptInlineApproval: false,
  };
}

function assertWorkspaceHandlerIds(
  factoryName: string,
  orderId: string,
  workspaceId: string
): void {
  if (typeof orderId !== "string" || orderId.trim().length === 0) {
    throw new Error(`${factoryName}: invalid orderId`);
  }
  if (typeof workspaceId !== "string" || workspaceId.trim().length === 0) {
    throw new Error(`${factoryName}: invalid workspaceId`);
  }
}

function workspaceHandlerError(handlerName: string, error: unknown): HandlerResult {
  console.error("Adjustment workspace POS handler failed", {
    handlerName,
    error,
  });
  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : "Unable to stage workspace edit";
  return {
    ok: false,
    errors: { _global: [message] },
  };
}

async function retryWorkspaceHandler(
  handlerName: string,
  action: () => Promise<HandlerResult>
): Promise<HandlerResult> {
  try {
    return await action();
  } catch (error) {
    console.error("Adjustment workspace POS handler attempt failed", {
      handlerName,
      error,
    });
    try {
      return await action();
    } catch (retryError) {
      return workspaceHandlerError(handlerName, retryError);
    }
  }
}
