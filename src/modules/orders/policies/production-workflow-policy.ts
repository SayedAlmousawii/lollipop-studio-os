import {
  OrderDeliveryStatus,
  OrderEditingStatus,
  OrderProductionSectionStatus,
  OrderProductionStatus,
  OrderStatus,
} from "@prisma/client";
import {
  ORDER_PRODUCTION_SECTION_STATUS_LABELS,
  ORDER_WORKFLOW_TRANSITIONS,
} from "@/modules/orders/order.constants";
import type { UpdateOrderProductionWorkflowInput } from "@/modules/orders/order.schema";

export type WorkflowActionIntent =
  | "primary"
  | "secondary"
  | "warning"
  | "destructive";

export type ProductionWorkflowActionKey =
  UpdateOrderProductionWorkflowInput["action"];

export type ProductionWorkflowSectionKey =
  | "albumDesign"
  | "printing"
  | "assembly"
  | "vendor"
  | "framedPrints"
  | "finalReadiness";

export type ProductionWorkflowBlockedReason =
  | "ORDER_CANCELLED"
  | "ORDER_DELIVERED"
  | "ALBUM_DESIGN_INCOMPLETE"
  | "EDITING_INCOMPLETE"
  | "PRODUCTION_ALREADY_READY"
  | "PRODUCTION_ALREADY_COMPLETED"
  | "INVALID_STATUS_TRANSITION";

export type ProductionWorkflowAction = {
  key: ProductionWorkflowActionKey;
  label: string;
  intent: WorkflowActionIntent;
  available: boolean;
  disabled: boolean;
  blockedReason: ProductionWorkflowBlockedReason | null;
  blockerMessages: string[];
  confirmationMessage: string | null;
  requiresManagerOverride: boolean;
  nextProductionStatus: OrderProductionStatus | null;
  nextDeliveryStatus: OrderDeliveryStatus | null;
  sectionKey: ProductionWorkflowSectionKey;
};

export type ProductionWorkflowSectionPolicy = {
  key: ProductionWorkflowSectionKey;
  title: string;
  description: string;
  status: string;
  action: ProductionWorkflowAction | null;
};

export type ProductionWorkflowPolicy = {
  productionStatus: OrderProductionStatus;
  deliveryStatus: OrderDeliveryStatus;
  sections: ProductionWorkflowSectionPolicy[];
  actions: ProductionWorkflowAction[];
  finalReadinessAction: ProductionWorkflowAction;
  blockers: string[];
  readinessWarning: string | null;
  canUpdateProduction: boolean;
  canMarkReadyForPickup: boolean;
};

export type BuildProductionWorkflowPolicyInput = {
  orderStatus: OrderStatus;
  editingStatus: OrderEditingStatus;
  productionStatus: OrderProductionStatus;
  deliveryStatus: OrderDeliveryStatus;
  albumDesignStatus: OrderProductionSectionStatus;
  printingStatus: OrderProductionSectionStatus;
  assemblyStatus: OrderProductionSectionStatus;
  vendorStatus: OrderProductionSectionStatus;
  framedPrintsStatus: OrderProductionSectionStatus;
  finalStatus: OrderProductionSectionStatus;
};

type ProductionActionDefinition = {
  key: ProductionWorkflowActionKey;
  label: string;
  intent: WorkflowActionIntent;
  sectionKey: ProductionWorkflowSectionKey;
  nextProductionStatus: (
    input: BuildProductionWorkflowPolicyInput
  ) => OrderProductionStatus | null;
  nextDeliveryStatus?: OrderDeliveryStatus;
};

type ProductionSectionDefinition = {
  key: ProductionWorkflowSectionKey;
  title: string;
  description: string;
  status: (input: BuildProductionWorkflowPolicyInput) => OrderProductionSectionStatus;
  startAction: ProductionWorkflowActionKey | null;
  completeAction: ProductionWorkflowActionKey;
};

export const PRODUCTION_WORKFLOW_MESSAGES = {
  orderCancelled: "Cancelled orders cannot be moved through production",
  orderDelivered: "Delivered orders cannot be moved through production",
  editingIncompleteWarning:
    "Editing must be approved or completed before production can be marked ready for pickup.",
  editingIncompleteGuard:
    "Production cannot be marked ready for pickup until editing is approved or completed",
  assemblyDependencyWarning:
    "Album assembly is in progress but album design is not yet completed. Complete album design first.",
  assemblyStartBlocked:
    "Album assembly cannot be started until album design is completed",
  assemblyCompleteBlocked:
    "Album assembly cannot be completed until album design is completed",
  readinessAssemblyBlocked:
    "Album design must be completed before assembly can contribute to production readiness",
  readyWithOpenSections:
    "Production is marked ready while one or more section checks are still open.",
  alreadyReady: "Production is already ready for pickup.",
  alreadyCompleted: "Production is already completed.",
  invalidStatusTransition:
    "This production action is not available for the current status.",
} as const;

const SECTION_DEFINITIONS: readonly ProductionSectionDefinition[] = [
  {
    key: "albumDesign",
    title: "Album Design",
    description: "Layout and customer album design preparation.",
    status: (input) => input.albumDesignStatus,
    startAction: "markAlbumDesignStarted",
    completeAction: "markAlbumDesignCompleted",
  },
  {
    key: "printing",
    title: "Printing",
    description: "Album pages and print items sent to production.",
    status: (input) => input.printingStatus,
    startAction: "markSentToPrint",
    completeAction: "markPrintsReady",
  },
  {
    key: "assembly",
    title: "Album Assembly",
    description: "Final album build, binding, and finishing.",
    status: (input) => input.assemblyStatus,
    startAction: "markAssemblyStarted",
    completeAction: "markAssemblyCompleted",
  },
  {
    key: "vendor",
    title: "Vendor / Outsource",
    description: "Outsourced production work and vendor handoff.",
    status: (input) => input.vendorStatus,
    startAction: "markVendorInProgress",
    completeAction: "markVendorCompleted",
  },
  {
    key: "framedPrints",
    title: "Framed Prints",
    description: "Frames, enlargements, and standalone print deliverables.",
    status: (input) => input.framedPrintsStatus,
    startAction: null,
    completeAction: "markPrintsReady",
  },
  {
    key: "finalReadiness",
    title: "Final Production Readiness",
    description: "Final production check before pickup handoff.",
    status: (input) => input.finalStatus,
    startAction: "markProductionReadyForPickup",
    completeAction: "markProductionReadyForPickup",
  },
] as const;

const ACTION_DEFINITIONS: readonly ProductionActionDefinition[] = [
  sectionAction("markAlbumDesignStarted", "Start", "albumDesign"),
  sectionAction("markAlbumDesignCompleted", "Complete", "albumDesign"),
  sectionAction("markSentToPrint", "Send to print", "printing"),
  sectionAction("markAssemblyStarted", "Start", "assembly"),
  sectionAction("markAssemblyCompleted", "Complete", "assembly"),
  {
    key: "markVendorInProgress",
    label: "Vendor in progress",
    intent: "secondary",
    sectionKey: "vendor",
    nextProductionStatus: () => OrderProductionStatus.WAITING_FOR_VENDOR,
  },
  sectionAction("markVendorCompleted", "Vendor complete", "vendor"),
  sectionAction("markPrintsReady", "Prints ready", "printing"),
  {
    key: "markProductionReadyForPickup",
    label: "Ready for pickup",
    intent: "primary",
    sectionKey: "finalReadiness",
    nextProductionStatus: () => OrderProductionStatus.READY_FOR_PICKUP,
    nextDeliveryStatus: OrderDeliveryStatus.READY_FOR_PICKUP,
  },
] as const;

export function buildProductionWorkflowPolicy(
  input: BuildProductionWorkflowPolicyInput
): ProductionWorkflowPolicy {
  const actions = ACTION_DEFINITIONS.map((definition) =>
    buildProductionWorkflowAction(input, definition)
  );
  const finalReadinessAction = findAction(actions, "markProductionReadyForPickup");

  return {
    productionStatus: input.productionStatus,
    deliveryStatus: input.deliveryStatus,
    sections: SECTION_DEFINITIONS.map((definition) =>
      buildProductionWorkflowSection(input, actions, definition)
    ),
    actions,
    finalReadinessAction,
    blockers: uniqueMessages(
      actions.flatMap((action) => action.blockerMessages)
    ),
    readinessWarning: resolveProductionReadinessWarningFromPolicy(input),
    canUpdateProduction: !terminalOrderBlocker(input.orderStatus),
    canMarkReadyForPickup: finalReadinessAction.available,
  };
}

export function assertProductionWorkflowWritablePolicy(status: OrderStatus): void {
  const blocker = terminalOrderBlocker(status);
  if (blocker) {
    throw new Error(messageForBlocker(blocker, "markProductionReadyForPickup"));
  }
}

export function assertProductionAssemblyDependencyPolicy(
  input: Pick<BuildProductionWorkflowPolicyInput, "albumDesignStatus">,
  action: Extract<
    ProductionWorkflowActionKey,
    "markAssemblyStarted" | "markAssemblyCompleted"
  >
): void {
  if (input.albumDesignStatus === OrderProductionSectionStatus.COMPLETED) return;
  throw new Error(
    action === "markAssemblyStarted"
      ? PRODUCTION_WORKFLOW_MESSAGES.assemblyStartBlocked
      : PRODUCTION_WORKFLOW_MESSAGES.assemblyCompleteBlocked
  );
}

export function assertProductionReadyForPickupPolicy(
  input: Pick<
    BuildProductionWorkflowPolicyInput,
    "editingStatus" | "albumDesignStatus" | "assemblyStatus"
  >
): void {
  if (
    input.editingStatus !== OrderEditingStatus.APPROVED &&
    input.editingStatus !== OrderEditingStatus.COMPLETED
  ) {
    throw new Error(PRODUCTION_WORKFLOW_MESSAGES.editingIncompleteGuard);
  }
  if (hasBlockingAssemblyDependency(input)) {
    throw new Error(PRODUCTION_WORKFLOW_MESSAGES.readinessAssemblyBlocked);
  }
}

function buildProductionWorkflowSection(
  input: BuildProductionWorkflowPolicyInput,
  actions: ProductionWorkflowAction[],
  definition: ProductionSectionDefinition
): ProductionWorkflowSectionPolicy {
  const status = definition.status(input);
  const action = visibleActionForSection(input, actions, definition, status);

  return {
    key: definition.key,
    title: definition.title,
    description: definition.description,
    status: ORDER_PRODUCTION_SECTION_STATUS_LABELS[status],
    action,
  };
}

function visibleActionForSection(
  input: BuildProductionWorkflowPolicyInput,
  actions: ProductionWorkflowAction[],
  definition: ProductionSectionDefinition,
  status: OrderProductionSectionStatus
): ProductionWorkflowAction | null {
  if (terminalOrderBlocker(input.orderStatus)) return null;

  if (definition.key === "finalReadiness") {
    if (isProductionReadyOrCompleted(input.productionStatus)) return null;
    return findAction(actions, "markProductionReadyForPickup");
  }

  if (definition.key === "assembly" && input.albumDesignStatus !== OrderProductionSectionStatus.COMPLETED) {
    return null;
  }

  if (status === OrderProductionSectionStatus.NOT_STARTED && definition.startAction) {
    return findAction(actions, definition.startAction);
  }
  if (status === OrderProductionSectionStatus.IN_PROGRESS) {
    return findAction(actions, definition.completeAction);
  }
  return null;
}

function buildProductionWorkflowAction(
  input: BuildProductionWorkflowPolicyInput,
  definition: ProductionActionDefinition
): ProductionWorkflowAction {
  const actionBlocker = actionSpecificBlocker(input, definition);
  const blockerMessages = actionBlocker
    ? [messageForBlocker(actionBlocker, definition.key)]
    : [];

  return {
    key: definition.key,
    label: definition.label,
    intent: definition.intent,
    available: !actionBlocker,
    disabled: Boolean(actionBlocker),
    blockedReason: actionBlocker,
    blockerMessages,
    confirmationMessage: null,
    requiresManagerOverride: false,
    nextProductionStatus: definition.nextProductionStatus(input),
    nextDeliveryStatus: definition.nextDeliveryStatus ?? null,
    sectionKey: definition.sectionKey,
  };
}

function actionSpecificBlocker(
  input: BuildProductionWorkflowPolicyInput,
  definition: ProductionActionDefinition
): ProductionWorkflowBlockedReason | null {
  const terminalBlocker = terminalOrderBlocker(input.orderStatus);
  if (terminalBlocker) return terminalBlocker;

  if (!currentSectionCanSubmitAction(input, definition.key)) {
    return "INVALID_STATUS_TRANSITION";
  }

  if (definition.key === "markAssemblyStarted" || definition.key === "markAssemblyCompleted") {
    if (input.albumDesignStatus !== OrderProductionSectionStatus.COMPLETED) {
      return "ALBUM_DESIGN_INCOMPLETE";
    }
  }

  if (definition.key === "markProductionReadyForPickup") {
    if (input.productionStatus === OrderProductionStatus.READY_FOR_PICKUP) {
      return "PRODUCTION_ALREADY_READY";
    }
    if (input.productionStatus === OrderProductionStatus.COMPLETED) {
      return "PRODUCTION_ALREADY_COMPLETED";
    }
    if (
      input.editingStatus !== OrderEditingStatus.APPROVED &&
      input.editingStatus !== OrderEditingStatus.COMPLETED
    ) {
      return "EDITING_INCOMPLETE";
    }
    if (hasBlockingAssemblyDependency(input)) {
      return "ALBUM_DESIGN_INCOMPLETE";
    }
  }

  const nextProductionStatus = definition.nextProductionStatus(input);
  if (
    nextProductionStatus &&
    !canTransition(input.productionStatus, nextProductionStatus)
  ) {
    return "INVALID_STATUS_TRANSITION";
  }

  return null;
}

function currentSectionCanSubmitAction(
  input: BuildProductionWorkflowPolicyInput,
  action: ProductionWorkflowActionKey
): boolean {
  switch (action) {
    case "markAlbumDesignStarted":
      return input.albumDesignStatus === OrderProductionSectionStatus.NOT_STARTED;
    case "markAlbumDesignCompleted":
      return input.albumDesignStatus === OrderProductionSectionStatus.IN_PROGRESS;
    case "markSentToPrint":
      return input.printingStatus === OrderProductionSectionStatus.NOT_STARTED;
    case "markAssemblyStarted":
      return input.assemblyStatus === OrderProductionSectionStatus.NOT_STARTED;
    case "markAssemblyCompleted":
      return input.assemblyStatus === OrderProductionSectionStatus.IN_PROGRESS;
    case "markVendorInProgress":
      return input.vendorStatus === OrderProductionSectionStatus.NOT_STARTED;
    case "markVendorCompleted":
      return input.vendorStatus === OrderProductionSectionStatus.IN_PROGRESS;
    case "markPrintsReady":
      return (
        input.printingStatus === OrderProductionSectionStatus.IN_PROGRESS ||
        input.framedPrintsStatus === OrderProductionSectionStatus.IN_PROGRESS
      );
    case "markProductionReadyForPickup":
      return true;
  }
}

function resolveProductionReadinessWarningFromPolicy(
  input: BuildProductionWorkflowPolicyInput
): string | null {
  if (
    input.editingStatus !== OrderEditingStatus.APPROVED &&
    input.editingStatus !== OrderEditingStatus.COMPLETED
  ) {
    return PRODUCTION_WORKFLOW_MESSAGES.editingIncompleteWarning;
  }

  if (hasBlockingAssemblyDependency(input)) {
    return PRODUCTION_WORKFLOW_MESSAGES.assemblyDependencyWarning;
  }

  if (
    input.productionStatus === OrderProductionStatus.READY_FOR_PICKUP &&
    hasIncompleteProductionSections(input)
  ) {
    return PRODUCTION_WORKFLOW_MESSAGES.readyWithOpenSections;
  }

  return null;
}

function terminalOrderBlocker(
  status: OrderStatus
): ProductionWorkflowBlockedReason | null {
  if (status === OrderStatus.CANCELLED) return "ORDER_CANCELLED";
  if (status === OrderStatus.DELIVERED) return "ORDER_DELIVERED";
  return null;
}

function hasBlockingAssemblyDependency(
  input: Pick<BuildProductionWorkflowPolicyInput, "albumDesignStatus" | "assemblyStatus">
): boolean {
  return (
    input.assemblyStatus !== OrderProductionSectionStatus.NOT_STARTED &&
    input.albumDesignStatus !== OrderProductionSectionStatus.COMPLETED
  );
}

function hasIncompleteProductionSections(
  input: Pick<
    BuildProductionWorkflowPolicyInput,
    | "albumDesignStatus"
    | "printingStatus"
    | "assemblyStatus"
    | "vendorStatus"
    | "framedPrintsStatus"
  >
): boolean {
  return [
    input.albumDesignStatus,
    input.printingStatus,
    input.assemblyStatus,
    input.vendorStatus,
    input.framedPrintsStatus,
  ].some((status) => status !== OrderProductionSectionStatus.COMPLETED);
}

function isProductionReadyOrCompleted(status: OrderProductionStatus): boolean {
  return (
    status === OrderProductionStatus.READY_FOR_PICKUP ||
    status === OrderProductionStatus.COMPLETED
  );
}

function nextInProgressStatus(
  input: BuildProductionWorkflowPolicyInput
): OrderProductionStatus {
  return isProductionReadyOrCompleted(input.productionStatus)
    ? input.productionStatus
    : OrderProductionStatus.IN_PROGRESS;
}

function sectionAction(
  key: ProductionWorkflowActionKey,
  label: string,
  sectionKey: ProductionWorkflowSectionKey
): ProductionActionDefinition {
  return {
    key,
    label,
    intent: "primary",
    sectionKey,
    nextProductionStatus: nextInProgressStatus,
  };
}

function canTransition(
  currentStatus: OrderProductionStatus,
  nextStatus: OrderProductionStatus
): boolean {
  const allowed = ORDER_WORKFLOW_TRANSITIONS.productionStatus[
    currentStatus
  ] as readonly OrderProductionStatus[];
  return allowed.includes(nextStatus);
}

function findAction(
  actions: ProductionWorkflowAction[],
  key: ProductionWorkflowActionKey
): ProductionWorkflowAction {
  const action = actions.find((item) => item.key === key);
  if (!action) {
    throw new Error(`Missing production workflow action: ${key}`);
  }
  return action;
}

function messageForBlocker(
  reason: ProductionWorkflowBlockedReason,
  action: ProductionWorkflowActionKey
): string {
  switch (reason) {
    case "ORDER_CANCELLED":
      return PRODUCTION_WORKFLOW_MESSAGES.orderCancelled;
    case "ORDER_DELIVERED":
      return PRODUCTION_WORKFLOW_MESSAGES.orderDelivered;
    case "ALBUM_DESIGN_INCOMPLETE":
      if (action === "markAssemblyStarted") {
        return PRODUCTION_WORKFLOW_MESSAGES.assemblyStartBlocked;
      }
      if (action === "markAssemblyCompleted") {
        return PRODUCTION_WORKFLOW_MESSAGES.assemblyCompleteBlocked;
      }
      return PRODUCTION_WORKFLOW_MESSAGES.readinessAssemblyBlocked;
    case "EDITING_INCOMPLETE":
      return PRODUCTION_WORKFLOW_MESSAGES.editingIncompleteGuard;
    case "PRODUCTION_ALREADY_READY":
      return PRODUCTION_WORKFLOW_MESSAGES.alreadyReady;
    case "PRODUCTION_ALREADY_COMPLETED":
      return PRODUCTION_WORKFLOW_MESSAGES.alreadyCompleted;
    case "INVALID_STATUS_TRANSITION":
      return PRODUCTION_WORKFLOW_MESSAGES.invalidStatusTransition;
  }
}

function uniqueMessages(messages: string[]): string[] {
  return [...new Set(messages)];
}
