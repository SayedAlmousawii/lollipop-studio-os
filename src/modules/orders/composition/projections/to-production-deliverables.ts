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
  summaryLabel: string;
  includedPhotoCount: number;
  extraPhotoCount: number;
  rows: ProductionDeliverableRowProjection[];
};

export function emptyProductionDeliverablesProjection(input: {
  orderId: string;
  jobNumber: string;
}): ProductionDeliverablesProjection {
  return {
    orderId: input.orderId,
    jobNumber: input.jobNumber,
    summaryLabel: "No structured deliverables",
    includedPhotoCount: 0,
    extraPhotoCount: 0,
    rows: [],
  };
}

export function toProductionDeliverables(
  model: OrderCompositionViewModel
): ProductionDeliverablesProjection {
  const packageNameByOrderPackageId = new Map(
    model.effectiveComposition.packageLines.map((line) => [
      line.orderPackageId,
      line.label,
    ])
  );
  const deliverableRows = model.effectiveComposition.deliverables
    .filter((line) => line.quantity > 0)
    .map((line) => {
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
  const addOnRows = model.effectiveComposition.addOns
    .filter((line) => line.quantity > 0)
    .map((line) => ({
      id: line.id,
      orderPackageId: line.metadata.orderPackageId ?? null,
      packageName: null,
      productId: line.metadata.productId ?? line.metadata.sourceRefId ?? null,
      label: line.label,
      categoryLabel: line.metadata.categoryLabel ?? null,
      quantity: line.quantity,
    }));
  const rows = [...deliverableRows, ...addOnRows];
  const includedPhotoCount = model.effectiveComposition.packageLines.reduce(
    (sum, line) => sum + line.includedPhotoCount,
    0
  );
  const extraPhotoCount = model.effectiveComposition.packageLines.reduce(
    (sum, line) => sum + line.extraPhotoCount,
    0
  );

  return {
    orderId: model.orderId,
    jobNumber: model.jobNumber,
    summaryLabel: formatProductionSummary({
      packageItemQuantity: totalQuantity(deliverableRows),
      addOnQuantity: totalQuantity(addOnRows),
    }),
    includedPhotoCount,
    extraPhotoCount,
    rows,
  };
}

function formatProductionSummary(input: {
  packageItemQuantity: number;
  addOnQuantity: number;
}): string {
  const parts = [];
  if (input.packageItemQuantity > 0) {
    parts.push(
      `${input.packageItemQuantity} package item${
        input.packageItemQuantity === 1 ? "" : "s"
      }`
    );
  }
  if (input.addOnQuantity > 0) {
    parts.push(
      `${input.addOnQuantity} paid add-on${
        input.addOnQuantity === 1 ? "" : "s"
      }`
    );
  }
  return parts.length > 0 ? parts.join(" · ") : "No structured deliverables";
}

function totalQuantity(rows: ProductionDeliverableRowProjection[]): number {
  return rows.reduce((sum, row) => sum + row.quantity, 0);
}
