import type {
  DraftPOSCompositionProjection,
  POSCompositionAddOnProjection,
} from "./to-draft-pos-composition";

export type POSAddOnMarketplaceCurrentAddOnProjection = {
  id: string;
  orderAddOnId: string | null;
  productId: string | null;
  name: string;
  unitAmount: number;
};

export type POSAddOnMarketplaceProductStateProjection = {
  productId: string;
  count: number;
  removalOrderAddOnId: string | null;
};

export type POSAddOnMarketplaceProjection = {
  orderId: string;
  currentAddOns: POSAddOnMarketplaceCurrentAddOnProjection[];
  productStates: POSAddOnMarketplaceProductStateProjection[];
};

export function toPOSAddOnMarketplace(
  composition: DraftPOSCompositionProjection
): POSAddOnMarketplaceProjection {
  const currentAddOns = composition.addOns.flatMap(projectCurrentAddOnRows);
  const stateByProductId = new Map<
    string,
    POSAddOnMarketplaceProductStateProjection
  >();

  for (const addOn of currentAddOns) {
    if (!addOn.productId) continue;
    const state = stateByProductId.get(addOn.productId) ?? {
      productId: addOn.productId,
      count: 0,
      removalOrderAddOnId: addOn.orderAddOnId,
    };
    state.count += 1;
    state.removalOrderAddOnId ??= addOn.orderAddOnId;
    stateByProductId.set(addOn.productId, state);
  }

  return {
    orderId: composition.orderId,
    currentAddOns,
    productStates: [...stateByProductId.values()],
  };
}

function projectCurrentAddOnRows(
  addOn: POSCompositionAddOnProjection
): POSAddOnMarketplaceCurrentAddOnProjection[] {
  const quantity = Math.max(0, Math.trunc(addOn.quantity));
  if (quantity === 0) return [];

  return Array.from({ length: quantity }, (_, index) => ({
    id: quantity === 1 ? addOn.id : `${addOn.id}:${index + 1}`,
    orderAddOnId: addOn.orderAddOnId,
    productId: addOn.productId,
    name: addOn.name,
    unitAmount: addOn.unitAmount,
  }));
}
