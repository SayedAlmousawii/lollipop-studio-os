import type {
  ORDER_COMMIT_KIND,
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
  ORDER_COMMIT_STATUS,
} from "./order-commit.constants";

export type OrderCommitKind =
  (typeof ORDER_COMMIT_KIND)[keyof typeof ORDER_COMMIT_KIND];

export type OrderCommitStatus =
  (typeof ORDER_COMMIT_STATUS)[keyof typeof ORDER_COMMIT_STATUS];

export type OrderCommitSnapshotLineKind =
  (typeof ORDER_COMMIT_SNAPSHOT_LINE_KIND)[keyof typeof ORDER_COMMIT_SNAPSHOT_LINE_KIND];

export type OrderCommitOrderEntityKind =
  (typeof ORDER_COMMIT_ORDER_ENTITY_KIND)[keyof typeof ORDER_COMMIT_ORDER_ENTITY_KIND];

export type OrderCommitPriceSource =
  (typeof ORDER_COMMIT_PRICE_SOURCE)[keyof typeof ORDER_COMMIT_PRICE_SOURCE];

export type OrderCommitSnapshotMoneyTotals = {
  subtotal: number;
  discountTotal: number;
  netTotal: number;
};

export type OrderCommitSnapshotLineV1 = {
  lineId: string;
  lineKind: OrderCommitSnapshotLineKind;
  orderEntityKind: OrderCommitOrderEntityKind;
  orderEntityId: string;
  parentOrderPackageId: string | null;
  catalogEntityId: string | null;
  stableKey: string;
  label: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  priceSource: OrderCommitPriceSource;
  metadata: Record<string, unknown>;
};

export type OrderCommitSnapshotV1 = {
  schemaVersion: "order_commit_snapshot_v1";
  orderId: string;
  financialCaseId: string;
  capturedAt: string;
  currency: "KWD";
  lines: OrderCommitSnapshotLineV1[];
  totals: OrderCommitSnapshotMoneyTotals;
};
