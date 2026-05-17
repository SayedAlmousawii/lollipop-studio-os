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
  workspaceId: string,
  version: number
): POSCompositionHandlers {
  async function changePackageTier(input: {
    orderPackageId: string;
    toPackageRefId: string;
  }) {
    "use server";

    return stagePackageTierChangeAction(orderId, workspaceId, {
      version,
      ...input,
    });
  }

  async function upgradePackageItem(input: {
    orderPackageId: string;
    packageItemId: string;
    toProductId: string;
    quantity: number;
  }) {
    "use server";

    return stagePackageItemUpgradeAction(orderId, workspaceId, {
      version,
      ...input,
    });
  }

  async function changeSelectedPhotoCount(input: {
    orderPackageId: string;
    selectedPhotoCount: number;
    extraDigitalCount: number;
    extraPrintCount: number;
  }) {
    "use server";

    return stageSelectedPhotoCountChangeAction(orderId, workspaceId, {
      version,
      ...input,
    });
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
  workspaceId: string,
  version: number
): POSAddOnHandlers {
  async function addAddOn(input: { productId: string; quantity: number }) {
    "use server";

    return stageMarketplaceAddOnAction(orderId, workspaceId, {
      version,
      ...input,
    });
  }

  async function removeAddOn(input: { addOnId: string }) {
    "use server";

    return stageMarketplaceAddOnRemovalAction(orderId, workspaceId, {
      version,
      ...input,
    });
  }

  async function changeAddOnQuantity(input: { addOnId: string; quantity: number }) {
    "use server";

    return stageMarketplaceAddOnQuantityAction(orderId, workspaceId, {
      version,
      ...input,
    });
  }

  return {
    addAddOn,
    removeAddOn,
    changeAddOnQuantity,
    shouldPromptInlineApproval: false,
  };
}
