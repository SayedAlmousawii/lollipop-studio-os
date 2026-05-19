import {
  OrderEditingStatus,
  OrderSelectionStatus,
  OrderStatus,
} from "@prisma/client";
import { ORDER_WORKFLOW_TRANSITIONS } from "@/modules/orders/order.constants";
import type { UpdateOrderEditingWorkflowInput } from "@/modules/orders/order.schema";

export type WorkflowActionIntent =
  | "primary"
  | "secondary"
  | "warning"
  | "destructive";

export type EditingWorkflowActionKey = UpdateOrderEditingWorkflowInput["action"];

export type EditingWorkflowBlockedReason =
  | "ORDER_CANCELLED"
  | "ORDER_DELIVERED"
  | "NO_EDITOR_OPTIONS"
  | "MISSING_EDITOR"
  | "SELECTION_INCOMPLETE"
  | "DEPOSIT_UNSETTLED"
  | "FINAL_BALANCE_UNSETTLED"
  | "INVALID_STATUS_TRANSITION";

export type EditingWorkflowAction = {
  key: EditingWorkflowActionKey;
  label: string;
  intent: WorkflowActionIntent;
  available: boolean;
  disabled: boolean;
  blockedReason: EditingWorkflowBlockedReason | null;
  blockerMessages: string[];
  confirmationMessage: string | null;
  requiresManagerOverride: boolean;
  nextStatus: OrderEditingStatus | null;
};

export type EditingWorkflowPolicy = {
  status: OrderEditingStatus;
  actions: EditingWorkflowAction[];
  blockers: string[];
};

export type BuildEditingWorkflowPolicyInput = {
  orderStatus: OrderStatus;
  selectionStatus: OrderSelectionStatus;
  editingStatus: OrderEditingStatus;
  assignedEditorId: string | null;
  hasEditorOptions: boolean;
  basePaymentVerified: boolean;
  hasOutstandingBalance: boolean;
};

type EditingActionDefinition = {
  key: EditingWorkflowActionKey;
  label: string;
  intent: WorkflowActionIntent;
  nextStatus: OrderEditingStatus | null;
};

export const EDITING_WORKFLOW_MESSAGES = {
  orderCancelled: "Cancelled orders cannot be moved through editing",
  orderDelivered: "Delivered orders cannot be moved through editing",
  noEditorOptions: "No editor users are available yet.",
  editorRequired: "Editor is required",
  missingEditor: "Assign an editor before starting editing",
  selectionIncomplete: "Editing cannot start until selection is completed",
  basePaymentRequired:
    "Editing cannot start until base package payment is recorded",
  finalBalanceRequired:
    "Editing cannot start until the outstanding invoice balance is paid",
} as const;

const EDITING_ACTIONS: readonly EditingActionDefinition[] = [
  {
    key: "assignEditor",
    label: "Assign",
    intent: "secondary",
    nextStatus: OrderEditingStatus.ASSIGNED,
  },
  {
    key: "markStarted",
    label: "Start",
    intent: "primary",
    nextStatus: OrderEditingStatus.IN_PROGRESS,
  },
  {
    key: "requestRevision",
    label: "Revision",
    intent: "warning",
    nextStatus: OrderEditingStatus.REVISION_REQUESTED,
  },
  {
    key: "markComplete",
    label: "Complete",
    intent: "primary",
    nextStatus: OrderEditingStatus.AWAITING_APPROVAL,
  },
  {
    key: "markApproved",
    label: "Approve",
    intent: "primary",
    nextStatus: OrderEditingStatus.APPROVED,
  },
  {
    key: "sendToProduction",
    label: "Production",
    intent: "primary",
    nextStatus: OrderEditingStatus.COMPLETED,
  },
] as const;

export function buildEditingWorkflowPolicy(
  input: BuildEditingWorkflowPolicyInput
): EditingWorkflowPolicy {
  const actions = EDITING_ACTIONS.map((action) =>
    buildEditingWorkflowAction(input, action)
  );

  return {
    status: input.editingStatus,
    actions,
    blockers: uniqueMessages(
      actions.flatMap((action) => action.blockerMessages)
    ),
  };
}

export function assertEditingReadyToStartPolicy(
  input: Pick<
    BuildEditingWorkflowPolicyInput,
    | "selectionStatus"
    | "assignedEditorId"
    | "basePaymentVerified"
    | "hasOutstandingBalance"
  >
): void {
  if (input.selectionStatus !== OrderSelectionStatus.COMPLETED) {
    throw new Error(EDITING_WORKFLOW_MESSAGES.selectionIncomplete);
  }
  if (!input.basePaymentVerified) {
    throw new Error(EDITING_WORKFLOW_MESSAGES.basePaymentRequired);
  }
  if (input.hasOutstandingBalance) {
    throw new Error(EDITING_WORKFLOW_MESSAGES.finalBalanceRequired);
  }
  if (!input.assignedEditorId) {
    throw new Error(EDITING_WORKFLOW_MESSAGES.missingEditor);
  }
}

function buildEditingWorkflowAction(
  input: BuildEditingWorkflowPolicyInput,
  definition: EditingActionDefinition
): EditingWorkflowAction {
  const terminalBlocker = terminalOrderBlocker(input.orderStatus);
  const actionBlocker = terminalBlocker ?? actionSpecificBlocker(input, definition);
  const blockerMessages = actionBlocker ? [messageForBlocker(actionBlocker)] : [];

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
    nextStatus: nextStatusFor(input.editingStatus, definition),
  };
}

function actionSpecificBlocker(
  input: BuildEditingWorkflowPolicyInput,
  definition: EditingActionDefinition
): EditingWorkflowBlockedReason | null {
  if (definition.key === "assignEditor") {
    if (!input.hasEditorOptions) return "NO_EDITOR_OPTIONS";
    return input.editingStatus === OrderEditingStatus.COMPLETED
      ? "INVALID_STATUS_TRANSITION"
      : null;
  }

  if (definition.key === "markStarted") {
    if (input.selectionStatus !== OrderSelectionStatus.COMPLETED) {
      return "SELECTION_INCOMPLETE";
    }
    if (!input.basePaymentVerified) return "DEPOSIT_UNSETTLED";
    if (input.hasOutstandingBalance) return "FINAL_BALANCE_UNSETTLED";
    if (!input.assignedEditorId) return "MISSING_EDITOR";
    if (
      input.editingStatus !== OrderEditingStatus.ASSIGNED &&
      input.editingStatus !== OrderEditingStatus.REVISION_REQUESTED
    ) {
      return "INVALID_STATUS_TRANSITION";
    }
  }

  if (!currentStatusCanSubmitAction(input.editingStatus, definition.key)) {
    return "INVALID_STATUS_TRANSITION";
  }

  if (!definition.nextStatus) return null;
  return canTransition(input.editingStatus, definition.nextStatus)
    ? null
    : "INVALID_STATUS_TRANSITION";
}

function currentStatusCanSubmitAction(
  status: OrderEditingStatus,
  action: EditingWorkflowActionKey
): boolean {
  switch (action) {
    case "assignEditor":
      return status !== OrderEditingStatus.COMPLETED;
    case "markStarted":
      return (
        status === OrderEditingStatus.ASSIGNED ||
        status === OrderEditingStatus.REVISION_REQUESTED
      );
    case "requestRevision":
      return status === OrderEditingStatus.AWAITING_APPROVAL;
    case "markComplete":
      return (
        status === OrderEditingStatus.IN_PROGRESS ||
        status === OrderEditingStatus.REVISION_REQUESTED
      );
    case "markApproved":
      return status === OrderEditingStatus.AWAITING_APPROVAL;
    case "sendToProduction":
      return status === OrderEditingStatus.APPROVED;
  }
}

function nextStatusFor(
  currentStatus: OrderEditingStatus,
  definition: EditingActionDefinition
): OrderEditingStatus | null {
  if (definition.key === "assignEditor") {
    return currentStatus === OrderEditingStatus.NOT_STARTED
      ? OrderEditingStatus.ASSIGNED
      : currentStatus;
  }
  return definition.nextStatus;
}

function canTransition(
  currentStatus: OrderEditingStatus,
  nextStatus: OrderEditingStatus
): boolean {
  const allowed = ORDER_WORKFLOW_TRANSITIONS.editingStatus[
    currentStatus
  ] as readonly OrderEditingStatus[];
  return allowed.includes(nextStatus);
}

function terminalOrderBlocker(
  status: OrderStatus
): EditingWorkflowBlockedReason | null {
  if (status === OrderStatus.CANCELLED) return "ORDER_CANCELLED";
  if (status === OrderStatus.DELIVERED) return "ORDER_DELIVERED";
  return null;
}

function messageForBlocker(reason: EditingWorkflowBlockedReason): string {
  switch (reason) {
    case "ORDER_CANCELLED":
      return EDITING_WORKFLOW_MESSAGES.orderCancelled;
    case "ORDER_DELIVERED":
      return EDITING_WORKFLOW_MESSAGES.orderDelivered;
    case "NO_EDITOR_OPTIONS":
      return EDITING_WORKFLOW_MESSAGES.noEditorOptions;
    case "MISSING_EDITOR":
      return EDITING_WORKFLOW_MESSAGES.missingEditor;
    case "SELECTION_INCOMPLETE":
      return EDITING_WORKFLOW_MESSAGES.selectionIncomplete;
    case "DEPOSIT_UNSETTLED":
      return EDITING_WORKFLOW_MESSAGES.basePaymentRequired;
    case "FINAL_BALANCE_UNSETTLED":
      return EDITING_WORKFLOW_MESSAGES.finalBalanceRequired;
    case "INVALID_STATUS_TRANSITION":
      return "This editing action is not available for the current status.";
  }
}

function uniqueMessages(messages: string[]): string[] {
  return [...new Set(messages)];
}
