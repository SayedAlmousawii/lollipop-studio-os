import {
  OrderDeliveryStatus,
  OrderEditingStatus,
  OrderProductionSectionStatus,
  OrderProductionStatus,
  OrderSelectionStatus,
} from "@prisma/client";

export const ORDER_SELECTION_STATUS_LABELS = {
  [OrderSelectionStatus.PENDING]: "Pending",
  [OrderSelectionStatus.IN_PROGRESS]: "In progress",
  [OrderSelectionStatus.COMPLETED]: "Completed",
} as const satisfies Record<OrderSelectionStatus, string>;

export const ORDER_EDITING_STATUS_LABELS = {
  [OrderEditingStatus.NOT_STARTED]: "Not started",
  [OrderEditingStatus.ASSIGNED]: "Assigned",
  [OrderEditingStatus.IN_PROGRESS]: "In progress",
  [OrderEditingStatus.REVISION_REQUESTED]: "Revision requested",
  [OrderEditingStatus.AWAITING_APPROVAL]: "Awaiting approval",
  [OrderEditingStatus.APPROVED]: "Approved",
  [OrderEditingStatus.COMPLETED]: "Completed",
} as const satisfies Record<OrderEditingStatus, string>;

export const ORDER_PRODUCTION_STATUS_LABELS = {
  [OrderProductionStatus.NOT_STARTED]: "Not started",
  [OrderProductionStatus.WAITING_FOR_EDITING]: "Waiting for editing",
  [OrderProductionStatus.IN_PROGRESS]: "In progress",
  [OrderProductionStatus.WAITING_FOR_VENDOR]: "Waiting for vendor",
  [OrderProductionStatus.READY_FOR_PICKUP]: "Ready for pickup",
  [OrderProductionStatus.COMPLETED]: "Completed",
} as const satisfies Record<OrderProductionStatus, string>;

export const ORDER_PRODUCTION_SECTION_STATUS_LABELS = {
  [OrderProductionSectionStatus.NOT_STARTED]: "Not started",
  [OrderProductionSectionStatus.IN_PROGRESS]: "In progress",
  [OrderProductionSectionStatus.COMPLETED]: "Completed",
} as const satisfies Record<OrderProductionSectionStatus, string>;

export const ORDER_DELIVERY_STATUS_LABELS = {
  [OrderDeliveryStatus.NOT_READY]: "Not ready",
  [OrderDeliveryStatus.READY_FOR_PICKUP]: "Ready for pickup",
  [OrderDeliveryStatus.CUSTOMER_NOTIFIED]: "Customer notified",
  [OrderDeliveryStatus.PICKED_UP]: "Picked up",
  [OrderDeliveryStatus.COMPLETED]: "Completed",
} as const satisfies Record<OrderDeliveryStatus, string>;

export const ORDER_SELECTION_STATUS_VALUES = [
  OrderSelectionStatus.PENDING,
  OrderSelectionStatus.IN_PROGRESS,
  OrderSelectionStatus.COMPLETED,
] as const;

export const ORDER_EDITING_STATUS_VALUES = [
  OrderEditingStatus.NOT_STARTED,
  OrderEditingStatus.ASSIGNED,
  OrderEditingStatus.IN_PROGRESS,
  OrderEditingStatus.REVISION_REQUESTED,
  OrderEditingStatus.AWAITING_APPROVAL,
  OrderEditingStatus.APPROVED,
  OrderEditingStatus.COMPLETED,
] as const;

export const ORDER_PRODUCTION_STATUS_VALUES = [
  OrderProductionStatus.NOT_STARTED,
  OrderProductionStatus.WAITING_FOR_EDITING,
  OrderProductionStatus.IN_PROGRESS,
  OrderProductionStatus.WAITING_FOR_VENDOR,
  OrderProductionStatus.READY_FOR_PICKUP,
  OrderProductionStatus.COMPLETED,
] as const;

export const ORDER_PRODUCTION_SECTION_STATUS_VALUES = [
  OrderProductionSectionStatus.NOT_STARTED,
  OrderProductionSectionStatus.IN_PROGRESS,
  OrderProductionSectionStatus.COMPLETED,
] as const;

export const ORDER_DELIVERY_STATUS_VALUES = [
  OrderDeliveryStatus.NOT_READY,
  OrderDeliveryStatus.READY_FOR_PICKUP,
  OrderDeliveryStatus.CUSTOMER_NOTIFIED,
  OrderDeliveryStatus.PICKED_UP,
  OrderDeliveryStatus.COMPLETED,
] as const;

export const ORDER_WORKFLOW_TRANSITIONS = {
  selectionStatus: {
    [OrderSelectionStatus.PENDING]: [
      OrderSelectionStatus.PENDING,
      OrderSelectionStatus.IN_PROGRESS,
    ],
    [OrderSelectionStatus.IN_PROGRESS]: [
      OrderSelectionStatus.IN_PROGRESS,
      OrderSelectionStatus.COMPLETED,
    ],
    [OrderSelectionStatus.COMPLETED]: [OrderSelectionStatus.COMPLETED],
  },
  editingStatus: {
    [OrderEditingStatus.NOT_STARTED]: [
      OrderEditingStatus.NOT_STARTED,
      OrderEditingStatus.ASSIGNED,
      OrderEditingStatus.IN_PROGRESS,
    ],
    [OrderEditingStatus.ASSIGNED]: [
      OrderEditingStatus.ASSIGNED,
      OrderEditingStatus.IN_PROGRESS,
    ],
    [OrderEditingStatus.IN_PROGRESS]: [
      OrderEditingStatus.IN_PROGRESS,
      OrderEditingStatus.REVISION_REQUESTED,
      OrderEditingStatus.AWAITING_APPROVAL,
    ],
    [OrderEditingStatus.REVISION_REQUESTED]: [
      OrderEditingStatus.REVISION_REQUESTED,
      OrderEditingStatus.IN_PROGRESS,
      OrderEditingStatus.AWAITING_APPROVAL,
    ],
    [OrderEditingStatus.AWAITING_APPROVAL]: [
      OrderEditingStatus.AWAITING_APPROVAL,
      OrderEditingStatus.APPROVED,
      OrderEditingStatus.REVISION_REQUESTED,
    ],
    [OrderEditingStatus.APPROVED]: [
      OrderEditingStatus.APPROVED,
      OrderEditingStatus.COMPLETED,
    ],
    [OrderEditingStatus.COMPLETED]: [OrderEditingStatus.COMPLETED],
  },
  productionStatus: {
    [OrderProductionStatus.NOT_STARTED]: [
      OrderProductionStatus.NOT_STARTED,
      OrderProductionStatus.WAITING_FOR_EDITING,
      OrderProductionStatus.IN_PROGRESS,
      OrderProductionStatus.READY_FOR_PICKUP,
    ],
    [OrderProductionStatus.WAITING_FOR_EDITING]: [
      OrderProductionStatus.WAITING_FOR_EDITING,
      OrderProductionStatus.IN_PROGRESS,
      OrderProductionStatus.READY_FOR_PICKUP,
    ],
    [OrderProductionStatus.IN_PROGRESS]: [
      OrderProductionStatus.IN_PROGRESS,
      OrderProductionStatus.WAITING_FOR_VENDOR,
      OrderProductionStatus.READY_FOR_PICKUP,
      OrderProductionStatus.COMPLETED,
    ],
    [OrderProductionStatus.WAITING_FOR_VENDOR]: [
      OrderProductionStatus.WAITING_FOR_VENDOR,
      OrderProductionStatus.IN_PROGRESS,
      OrderProductionStatus.READY_FOR_PICKUP,
    ],
    [OrderProductionStatus.READY_FOR_PICKUP]: [
      OrderProductionStatus.READY_FOR_PICKUP,
      OrderProductionStatus.COMPLETED,
    ],
    [OrderProductionStatus.COMPLETED]: [OrderProductionStatus.COMPLETED],
  },
  deliveryStatus: {
    [OrderDeliveryStatus.NOT_READY]: [
      OrderDeliveryStatus.NOT_READY,
      OrderDeliveryStatus.READY_FOR_PICKUP,
    ],
    [OrderDeliveryStatus.READY_FOR_PICKUP]: [
      OrderDeliveryStatus.READY_FOR_PICKUP,
      OrderDeliveryStatus.CUSTOMER_NOTIFIED,
      OrderDeliveryStatus.PICKED_UP,
      OrderDeliveryStatus.COMPLETED,
    ],
    [OrderDeliveryStatus.CUSTOMER_NOTIFIED]: [
      OrderDeliveryStatus.CUSTOMER_NOTIFIED,
      OrderDeliveryStatus.PICKED_UP,
      OrderDeliveryStatus.COMPLETED,
    ],
    [OrderDeliveryStatus.PICKED_UP]: [
      OrderDeliveryStatus.PICKED_UP,
      OrderDeliveryStatus.COMPLETED,
    ],
    [OrderDeliveryStatus.COMPLETED]: [OrderDeliveryStatus.COMPLETED],
  },
} as const;
