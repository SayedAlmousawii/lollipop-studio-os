import type {
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
  async function changePackageTier(input: {
    orderPackageId: string;
    toPackageRefId: string;
  }) {
    "use server";

    return stagePackageTierChangeAction(orderId, workspaceId, input);
  }

  async function upgradePackageItem(input: {
    orderPackageId: string;
    packageItemId: string;
    toProductId: string;
    quantity: number;
  }) {
    "use server";

    return stagePackageItemUpgradeAction(orderId, workspaceId, input);
  }

  async function changeSelectedPhotoCount(input: {
    orderPackageId: string;
    selectedPhotoCount: number;
    extraDigitalCount: number;
    extraPrintCount: number;
  }) {
    "use server";

    return stageSelectedPhotoCountChangeAction(orderId, workspaceId, input);
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
  async function addAddOn(input: { productId: string; quantity: number }) {
    "use server";

    return stageMarketplaceAddOnAction(orderId, workspaceId, input);
  }

  async function removeAddOn(input: { addOnId: string }) {
    "use server";

    return stageMarketplaceAddOnRemovalAction(orderId, workspaceId, input);
  }

  async function changeAddOnQuantity(input: { addOnId: string; quantity: number }) {
    "use server";

    return stageMarketplaceAddOnQuantityAction(orderId, workspaceId, input);
  }

  return {
    addAddOn,
    removeAddOn,
    changeAddOnQuantity,
    shouldPromptInlineApproval: false,
  };
}
