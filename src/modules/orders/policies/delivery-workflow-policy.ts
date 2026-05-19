import {
  OrderDeliveryStatus,
  OrderProductionStatus,
  OrderStatus,
} from "@prisma/client";
import { ORDER_WORKFLOW_TRANSITIONS } from "@/modules/orders/order.constants";
import {
  WorkflowGuardError,
  type WorkflowGuardErrorCode,
} from "@/modules/orders/order.errors";
import type { UpdateOrderDeliveryWorkflowInput } from "@/modules/orders/order.schema";
import { FINANCIAL_CASE_PAYMENT_STATUS_LABELS } from "@/modules/financial-cases/financial-case-summary.constants";
import type {
  FinancialCasePaymentStatus,
  FinancialCaseSummary,
} from "@/modules/financial-cases/financial-case-summary.types";

export type WorkflowActionIntent =
  | "primary"
  | "secondary"
  | "warning"
  | "destructive";

export type DeliveryWorkflowActionKey =
  UpdateOrderDeliveryWorkflowInput["action"];

export type DeliveryPaymentSettlementStatus =
  | FinancialCasePaymentStatus
  | "BOOKING_STAGE"
  | "MISSING_SUMMARY";

export type DeliveryPaymentSettlementContext = {
  status: DeliveryPaymentSettlementStatus;
  label: string;
  settled: boolean;
  summaryAvailable: boolean;
};

export type DeliveryWorkflowBlockedReason =
  | "ORDER_CANCELLED"
  | "ORDER_DELIVERED"
  | "PICKUP_NOT_READY"
  | "PRODUCTION_NOT_READY"
  | "PAYMENT_SUMMARY_MISSING"
  | "INVALID_STATUS_TRANSITION";

export type DeliveryWorkflowAction = {
  key: DeliveryWorkflowActionKey;
  label: string;
  intent: WorkflowActionIntent;
  available: boolean;
  disabled: boolean;
  blockedReason: DeliveryWorkflowBlockedReason | null;
  blockerMessages: string[];
  confirmationMessage: string | null;
  requiresManagerOverride: boolean;
  nextDeliveryStatus: OrderDeliveryStatus | null;
  completesOrder: boolean;
};

export type DeliveryWorkflowPaymentOverridePolicy = {
  required: boolean;
  checkboxLabel: string;
  blockerMessage: string | null;
  reasonLabel: string;
  notAllowedMessage: string;
  reasonRequiredMessage: string;
};

export type DeliveryWorkflowPolicy = {
  deliveryStatus: OrderDeliveryStatus;
  productionStatus: OrderProductionStatus;
  paymentStatus: DeliveryPaymentSettlementStatus;
  paymentStatusLabel: string;
  paymentSettled: boolean;
  actions: DeliveryWorkflowAction[];
  blockers: string[];
  paymentOverride: DeliveryWorkflowPaymentOverridePolicy;
  canRecordNotification: boolean;
  canMarkPickedUp: boolean;
  requiresPaymentOverride: boolean;
};

export type BuildDeliveryWorkflowPolicyInput = {
  orderStatus: OrderStatus;
  deliveryStatus: OrderDeliveryStatus;
  productionStatus: OrderProductionStatus;
  payment: DeliveryPaymentSettlementContext;
};

type DeliveryActionDefinition = {
  key: DeliveryWorkflowActionKey;
  label: string;
  intent: WorkflowActionIntent;
  nextDeliveryStatus: OrderDeliveryStatus | null;
  completesOrder: boolean;
};

export const DELIVERY_WORKFLOW_MESSAGES = {
  orderCancelled: "Cancelled orders cannot be moved through delivery",
  orderDelivered: "Delivered orders cannot be moved through delivery",
  notificationReady:
    "Customer notification can only be recorded after pickup readiness",
  pickupReady: "Pickup can only be recorded after delivery is ready",
  productionReady:
    "Order cannot be completed until production is ready for pickup or completed",
  paymentOverride:
    "Payment needs manager/admin override before pickup completion.",
  paymentOverrideNotAllowed:
    "Payment must be settled or explicitly overridden by an authorized manager or admin",
  paymentOverrideReasonMissing:
    "Override reason is required when payment is not settled",
  paymentSummaryMissing:
    "Payment summary is unavailable. Resolve the linked financial case before completing pickup.",
  actorMissing:
    "A linked authenticated staff user is required to complete delivery",
  invalidStatusTransition:
    "This delivery action is not available for the current status.",
} as const;

const ACTION_DEFINITIONS: readonly DeliveryActionDefinition[] = [
  {
    key: "recordCustomerNotification",
    label: "Notify",
    intent: "secondary",
    nextDeliveryStatus: OrderDeliveryStatus.CUSTOMER_NOTIFIED,
    completesOrder: false,
  },
  {
    key: "markPickedUp",
    label: "Picked up",
    intent: "primary",
    nextDeliveryStatus: OrderDeliveryStatus.COMPLETED,
    completesOrder: true,
  },
] as const;

export function buildDeliveryWorkflowPolicy(
  input: BuildDeliveryWorkflowPolicyInput
): DeliveryWorkflowPolicy {
  const actions = ACTION_DEFINITIONS.map((definition) =>
    buildDeliveryWorkflowAction(input, definition)
  );
  const notificationAction = findAction(actions, "recordCustomerNotification");
  const pickupAction = findAction(actions, "markPickedUp");
  const requiresPaymentOverride =
    input.payment.summaryAvailable && !input.payment.settled;
  const paymentOverride = buildPaymentOverridePolicy(requiresPaymentOverride);

  return {
    deliveryStatus: input.deliveryStatus,
    productionStatus: input.productionStatus,
    paymentStatus: input.payment.status,
    paymentStatusLabel: input.payment.label,
    paymentSettled: input.payment.settled,
    actions,
    blockers: uniqueMessages([
      ...pickupAction.blockerMessages,
      ...(paymentOverride.blockerMessage ? [paymentOverride.blockerMessage] : []),
    ]),
    paymentOverride,
    canRecordNotification: notificationAction.available,
    canMarkPickedUp: pickupAction.available,
    requiresPaymentOverride,
  };
}

export function buildDeliveryPaymentSettlementContext(
  summary: FinancialCaseSummary | null
): DeliveryPaymentSettlementContext {
  if (!summary) {
    return {
      status: "MISSING_SUMMARY",
      label: "Payment summary unavailable",
      settled: false,
      summaryAvailable: false,
    };
  }

  if (summary.stage !== "active") {
    return {
      status: "BOOKING_STAGE",
      label: "Final invoice pending",
      settled: false,
      summaryAvailable: false,
    };
  }

  return {
    status: summary.paymentStatusEnum,
    label: FINANCIAL_CASE_PAYMENT_STATUS_LABELS[summary.paymentStatusEnum],
    settled:
      summary.paymentStatusEnum === "PAID" ||
      summary.paymentStatusEnum === "OVERPAID",
    summaryAvailable: true,
  };
}

export function assertDeliveryWorkflowWritablePolicy(status: OrderStatus): void {
  const blocker = terminalOrderBlocker(status);
  if (blocker) {
    throw new Error(messageForBlocker(blocker, "markPickedUp"));
  }
}

export function assertDeliveryNotificationReadyPolicy(
  input: Pick<BuildDeliveryWorkflowPolicyInput, "deliveryStatus">
): void {
  if (input.deliveryStatus !== OrderDeliveryStatus.READY_FOR_PICKUP) {
    throw new Error(DELIVERY_WORKFLOW_MESSAGES.notificationReady);
  }
}

export function assertDeliveryPickupReadyPolicy(
  input: Pick<BuildDeliveryWorkflowPolicyInput, "deliveryStatus" | "productionStatus">
): void {
  if (!isPickupStatus(input.deliveryStatus)) {
    throw new Error(DELIVERY_WORKFLOW_MESSAGES.pickupReady);
  }
  if (!isProductionReadyForDelivery(input.productionStatus)) {
    throw new Error(DELIVERY_WORKFLOW_MESSAGES.productionReady);
  }
}

export function resolveDeliveryPaymentOverridePolicy(input: {
  payment: DeliveryPaymentSettlementContext;
  allowPaymentOverride?: boolean;
  overrideReason?: string | null;
}): { paymentOverrideUsed: boolean } {
  if (!input.payment.summaryAvailable) {
    throw workflowGuardError("PAYMENT_SUMMARY_MISSING");
  }

  const paymentOverrideUsed = !input.payment.settled;
  if (paymentOverrideUsed && !input.allowPaymentOverride) {
    throw workflowGuardError("PAYMENT_OVERRIDE_NOT_ALLOWED");
  }
  if (paymentOverrideUsed && !input.overrideReason?.trim()) {
    throw workflowGuardError("PAYMENT_OVERRIDE_REASON_MISSING");
  }
  return { paymentOverrideUsed };
}

export function messageForDeliveryGuardCode(
  code: Extract<
    WorkflowGuardErrorCode,
    | "PAYMENT_SUMMARY_MISSING"
    | "PAYMENT_OVERRIDE_NOT_ALLOWED"
    | "PAYMENT_OVERRIDE_REASON_MISSING"
  >
): string {
  switch (code) {
    case "PAYMENT_SUMMARY_MISSING":
      return DELIVERY_WORKFLOW_MESSAGES.paymentSummaryMissing;
    case "PAYMENT_OVERRIDE_NOT_ALLOWED":
      return DELIVERY_WORKFLOW_MESSAGES.paymentOverrideNotAllowed;
    case "PAYMENT_OVERRIDE_REASON_MISSING":
      return DELIVERY_WORKFLOW_MESSAGES.paymentOverrideReasonMissing;
  }
}

function buildDeliveryWorkflowAction(
  input: BuildDeliveryWorkflowPolicyInput,
  definition: DeliveryActionDefinition
): DeliveryWorkflowAction {
  const actionBlocker = actionSpecificBlocker(input, definition);
  const blockerMessages = actionBlocker
    ? [messageForBlocker(actionBlocker, definition.key)]
    : [];
  const requiresManagerOverride =
    definition.key === "markPickedUp" &&
    input.payment.summaryAvailable &&
    !input.payment.settled;

  return {
    key: definition.key,
    label: definition.label,
    intent: definition.intent,
    available: !actionBlocker,
    disabled: Boolean(actionBlocker),
    blockedReason: actionBlocker,
    blockerMessages,
    confirmationMessage: definition.completesOrder
      ? "Recording pickup will also complete the order."
      : null,
    requiresManagerOverride,
    nextDeliveryStatus: definition.nextDeliveryStatus,
    completesOrder: definition.completesOrder,
  };
}

function actionSpecificBlocker(
  input: BuildDeliveryWorkflowPolicyInput,
  definition: DeliveryActionDefinition
): DeliveryWorkflowBlockedReason | null {
  const terminalBlocker = terminalOrderBlocker(input.orderStatus);
  if (terminalBlocker) return terminalBlocker;

  if (definition.key === "recordCustomerNotification") {
    if (input.deliveryStatus !== OrderDeliveryStatus.READY_FOR_PICKUP) {
      return "PICKUP_NOT_READY";
    }
  }

  if (definition.key === "markPickedUp") {
    if (!isPickupStatus(input.deliveryStatus)) {
      return "PICKUP_NOT_READY";
    }
    if (!isProductionReadyForDelivery(input.productionStatus)) {
      return "PRODUCTION_NOT_READY";
    }
    if (!input.payment.summaryAvailable) {
      return "PAYMENT_SUMMARY_MISSING";
    }
  }

  if (
    definition.nextDeliveryStatus &&
    !canTransition(input.deliveryStatus, definition.nextDeliveryStatus)
  ) {
    return "INVALID_STATUS_TRANSITION";
  }

  return null;
}

function buildPaymentOverridePolicy(
  required: boolean
): DeliveryWorkflowPaymentOverridePolicy {
  return {
    required,
    checkboxLabel: "Allow manager/admin payment override",
    blockerMessage: required ? DELIVERY_WORKFLOW_MESSAGES.paymentOverride : null,
    reasonLabel: "Override reason",
    notAllowedMessage:
      "Check the box above to authorize the payment override before recording pickup.",
    reasonRequiredMessage:
      "A reason is required when overriding payment - explain why pickup is being completed without full payment.",
  };
}

function terminalOrderBlocker(
  status: OrderStatus
): DeliveryWorkflowBlockedReason | null {
  if (status === OrderStatus.CANCELLED) return "ORDER_CANCELLED";
  if (status === OrderStatus.DELIVERED) return "ORDER_DELIVERED";
  return null;
}

function isPickupStatus(status: OrderDeliveryStatus): boolean {
  return (
    status === OrderDeliveryStatus.READY_FOR_PICKUP ||
    status === OrderDeliveryStatus.CUSTOMER_NOTIFIED ||
    status === OrderDeliveryStatus.PICKED_UP
  );
}

function isProductionReadyForDelivery(status: OrderProductionStatus): boolean {
  return (
    status === OrderProductionStatus.READY_FOR_PICKUP ||
    status === OrderProductionStatus.COMPLETED
  );
}

function canTransition(
  currentStatus: OrderDeliveryStatus,
  nextStatus: OrderDeliveryStatus
): boolean {
  const allowed = ORDER_WORKFLOW_TRANSITIONS.deliveryStatus[
    currentStatus
  ] as readonly OrderDeliveryStatus[];
  return allowed.includes(nextStatus);
}

function findAction(
  actions: DeliveryWorkflowAction[],
  key: DeliveryWorkflowActionKey
): DeliveryWorkflowAction {
  const action = actions.find((item) => item.key === key);
  if (!action) {
    throw new Error(`Missing delivery workflow action: ${key}`);
  }
  return action;
}

function messageForBlocker(
  reason: DeliveryWorkflowBlockedReason,
  action: DeliveryWorkflowActionKey
): string {
  switch (reason) {
    case "ORDER_CANCELLED":
      return DELIVERY_WORKFLOW_MESSAGES.orderCancelled;
    case "ORDER_DELIVERED":
      return DELIVERY_WORKFLOW_MESSAGES.orderDelivered;
    case "PICKUP_NOT_READY":
      if (action === "recordCustomerNotification") {
        return DELIVERY_WORKFLOW_MESSAGES.notificationReady;
      }
      return DELIVERY_WORKFLOW_MESSAGES.pickupReady;
    case "PRODUCTION_NOT_READY":
      return DELIVERY_WORKFLOW_MESSAGES.productionReady;
    case "PAYMENT_SUMMARY_MISSING":
      return DELIVERY_WORKFLOW_MESSAGES.paymentSummaryMissing;
    case "INVALID_STATUS_TRANSITION":
      return DELIVERY_WORKFLOW_MESSAGES.invalidStatusTransition;
  }
}

function workflowGuardError(
  code: Extract<
    WorkflowGuardErrorCode,
    | "PAYMENT_SUMMARY_MISSING"
    | "PAYMENT_OVERRIDE_NOT_ALLOWED"
    | "PAYMENT_OVERRIDE_REASON_MISSING"
  >
): WorkflowGuardError {
  return new WorkflowGuardError(code, messageForDeliveryGuardCode(code));
}

function uniqueMessages(messages: string[]): string[] {
  return [...new Set(messages)];
}
