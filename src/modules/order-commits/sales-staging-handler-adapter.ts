import {
  ORDER_COMMIT_DRAFT_STAGING_DOMAIN,
} from "./order-commit-draft.constants";
import type {
  OrderCommitDraftLineTarget,
  OrderCommitDraftStagingChange,
} from "./order-commit-draft.types";
import type {
  HandlerResult,
  POSAddOnHandlers,
  POSCompositionHandlers,
  POSMutationActionState,
} from "@/modules/orders/pos-handlers.types";

export type StageSalesChangeAction = (
  orderId: string,
  expectedVersion: number,
  change: OrderCommitDraftStagingChange
) => Promise<POSMutationActionState>;

export type OrderCommitSalesStagingHandlerInput = {
  orderId: string;
  expectedVersion: number;
  stageSalesChangeAction: StageSalesChangeAction;
};

export function createOrderCommitSalesCompositionHandlers({
  orderId,
  expectedVersion,
  stageSalesChangeAction,
}: OrderCommitSalesStagingHandlerInput): POSCompositionHandlers {
  async function changePackageTier(input: {
    orderPackageId: string;
    toPackageRefId: string;
  }): Promise<HandlerResult> {
    "use server";

    return handlerResultFromActionState(
      await stageSalesChangeAction(orderId, expectedVersion, {
        domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE,
        action: "CHANGE_PACKAGE",
        target: packageTarget(input.orderPackageId),
        packageId: input.toPackageRefId,
      })
    );
  }

  async function upgradePackageItem(): Promise<HandlerResult> {
    "use server";

    return unsupportedHandlerResult(
      "Package item staging needs package-item scope before it can be staged."
    );
  }

  async function changeSelectedPhotoCount(input: {
    orderPackageId: string;
    selectedPhotoCount: number;
    extraDigitalCount: number;
    extraPrintCount: number;
  }): Promise<HandlerResult> {
    "use server";

    return handlerResultFromActionState(
      await stageSalesChangeAction(orderId, expectedVersion, {
        domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PHOTO,
        action: "SET_COUNTS",
        target: packageTarget(input.orderPackageId),
        selectedPhotoCount: input.selectedPhotoCount,
        extraDigitalCount: input.extraDigitalCount,
        extraPrintCount: input.extraPrintCount,
      })
    );
  }

  return {
    changePackageTier,
    upgradePackageItem,
    changeSelectedPhotoCount,
    shouldPromptInlineApproval: false,
  };
}

export function createOrderCommitSalesAddOnHandlers({
  orderId,
  expectedVersion,
  stageSalesChangeAction,
}: OrderCommitSalesStagingHandlerInput): POSAddOnHandlers {
  async function addAddOn(input: {
    productId: string;
    quantity: number;
  }): Promise<HandlerResult> {
    "use server";

    return handlerResultFromActionState(
      await stageSalesChangeAction(orderId, expectedVersion, {
        domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
        action: "ADD",
        productId: input.productId,
        quantity: input.quantity,
      })
    );
  }

  async function removeAddOn(input: {
    addOnId: string;
    currentQuantity?: number;
  }): Promise<HandlerResult> {
    "use server";

    return handlerResultFromActionState(
      await stageSalesChangeAction(
        orderId,
        expectedVersion,
        input.currentQuantity !== undefined && input.currentQuantity > 1
          ? {
              domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
              action: "UPDATE_QUANTITY",
              target: addOnTarget(input.addOnId),
              quantity: input.currentQuantity - 1,
            }
          : {
              domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
              action: "REMOVE",
              target: addOnTarget(input.addOnId),
            }
      )
    );
  }

  return {
    addAddOn,
    removeAddOn,
    shouldPromptInlineApproval: false,
  };
}

function packageTarget(orderPackageId: string): OrderCommitDraftLineTarget {
  return {
    stableKey: `order-package:${orderPackageId}`,
    orderEntityId: orderPackageId,
  };
}

function addOnTarget(orderAddOnId: string): OrderCommitDraftLineTarget {
  return {
    stableKey: `order-add-on:${orderAddOnId}`,
    orderEntityId: orderAddOnId,
  };
}

function handlerResultFromActionState(
  state: POSMutationActionState
): HandlerResult {
  if (state.kind === "success") {
    return { ok: true };
  }

  return {
    ok: false,
    errors: normalizeActionErrors(state.errors),
    approval: state.kind === "approval-required" ? state.payload : undefined,
  };
}

function normalizeActionErrors(
  errors: POSMutationActionState["errors"]
): Record<string, string[]> {
  if (!errors) {
    return {};
  }

  const normalized: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(errors)) {
    if (messages?.length) {
      normalized[field] = messages;
    }
  }
  return normalized;
}

function unsupportedHandlerResult(message: string): HandlerResult {
  return {
    ok: false,
    errors: { _global: [message] },
  };
}
