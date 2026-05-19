import type { OrderCompositionViewModel } from "../order-composition.types";

export type ProductionDeliverableRowProjection = {
  id: string;
  orderPackageId: string | null;
  packageName: string | null;
  productId: string | null;
  label: string;
  categoryLabel: string | null;
  quantity: number;
};

export type ProductionDeliverablesProjection = {
  orderId: string;
  jobNumber: string;
  rows: ProductionDeliverableRowProjection[];
};

export function toProductionDeliverables(
  model: OrderCompositionViewModel
): ProductionDeliverablesProjection {
  const packageNameByOrderPackageId = new Map(
    model.effectiveComposition.packageLines.map((line) => [
      line.orderPackageId,
      line.label,
    ])
  );
  const rows = model.effectiveComposition.deliverables.map((line) => {
    const orderPackageId = line.metadata.orderPackageId ?? null;
    return {
      id: line.id,
      orderPackageId,
      packageName: orderPackageId
        ? packageNameByOrderPackageId.get(orderPackageId) ?? null
        : null,
      productId: line.metadata.productId ?? null,
      label: line.label,
      categoryLabel: line.metadata.categoryLabel ?? null,
      quantity: line.quantity,
    };
  });

  return {
    orderId: model.orderId,
    jobNumber: model.jobNumber,
    rows,
  };
}
