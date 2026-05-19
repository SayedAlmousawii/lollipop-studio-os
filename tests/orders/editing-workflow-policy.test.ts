import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  OrderEditingStatus,
  OrderSelectionStatus,
  OrderStatus,
} from "@prisma/client";
import {
  assertEditingReadyToStartPolicy,
  buildEditingWorkflowPolicy,
  EDITING_WORKFLOW_MESSAGES,
  type BuildEditingWorkflowPolicyInput,
  type EditingWorkflowActionKey,
} from "@/modules/orders/policies/editing-workflow-policy";

const ROOT = process.cwd();

const baseInput: BuildEditingWorkflowPolicyInput = {
  orderStatus: OrderStatus.SELECTION_COMPLETED,
  selectionStatus: OrderSelectionStatus.COMPLETED,
  editingStatus: OrderEditingStatus.ASSIGNED,
  assignedEditorId: "editor-1",
  hasEditorOptions: true,
  basePaymentVerified: true,
  hasOutstandingBalance: false,
};

test("R10b editing policy exposes the existing editing action matrix", () => {
  const cases: Array<{
    status: OrderEditingStatus;
    enabled: EditingWorkflowActionKey[];
  }> = [
    {
      status: OrderEditingStatus.NOT_STARTED,
      enabled: ["assignEditor"],
    },
    {
      status: OrderEditingStatus.ASSIGNED,
      enabled: ["assignEditor", "markStarted"],
    },
    {
      status: OrderEditingStatus.IN_PROGRESS,
      enabled: ["assignEditor", "markComplete"],
    },
    {
      status: OrderEditingStatus.REVISION_REQUESTED,
      enabled: ["assignEditor", "markStarted", "markComplete"],
    },
    {
      status: OrderEditingStatus.AWAITING_APPROVAL,
      enabled: ["assignEditor", "requestRevision", "markApproved"],
    },
    {
      status: OrderEditingStatus.APPROVED,
      enabled: ["assignEditor", "sendToProduction"],
    },
    {
      status: OrderEditingStatus.COMPLETED,
      enabled: [],
    },
  ];

  for (const { status, enabled } of cases) {
    const policy = buildEditingWorkflowPolicy({
      ...baseInput,
      editingStatus: status,
    });

    assert.deepEqual(
      enabledActions(policy),
      enabled,
      `enabled actions for ${status}`
    );
  }
});

test("R10b editing policy owns start blockers in guard order", () => {
  const cases: Array<{
    name: string;
    input: Partial<BuildEditingWorkflowPolicyInput>;
    blocker: string;
    message: string;
  }> = [
    {
      name: "selection incomplete",
      input: { selectionStatus: OrderSelectionStatus.IN_PROGRESS },
      blocker: "SELECTION_INCOMPLETE",
      message: EDITING_WORKFLOW_MESSAGES.selectionIncomplete,
    },
    {
      name: "deposit unsettled",
      input: { basePaymentVerified: false },
      blocker: "DEPOSIT_UNSETTLED",
      message: EDITING_WORKFLOW_MESSAGES.basePaymentRequired,
    },
    {
      name: "final balance unsettled",
      input: { hasOutstandingBalance: true },
      blocker: "FINAL_BALANCE_UNSETTLED",
      message: EDITING_WORKFLOW_MESSAGES.finalBalanceRequired,
    },
    {
      name: "editor missing",
      input: { assignedEditorId: null },
      blocker: "MISSING_EDITOR",
      message: "Assign an editor before starting editing",
    },
  ];

  for (const { name, input, blocker, message } of cases) {
    const policy = buildEditingWorkflowPolicy({
      ...baseInput,
      ...input,
    });
    const start = action(policy, "markStarted");

    assert.equal(start.available, false, name);
    assert.equal(start.disabled, true, name);
    assert.equal(start.blockedReason, blocker, name);
    assert.deepEqual(start.blockerMessages, [message], name);
  }
});

test("R10b editing policy covers assignment edge cases and terminal order blockers", () => {
  const noEditors = buildEditingWorkflowPolicy({
    ...baseInput,
    hasEditorOptions: false,
  });
  assert.equal(action(noEditors, "assignEditor").blockedReason, "NO_EDITOR_OPTIONS");
  assert.deepEqual(action(noEditors, "assignEditor").blockerMessages, [
    EDITING_WORKFLOW_MESSAGES.noEditorOptions,
  ]);

  for (const [orderStatus, reason, message] of [
    [
      OrderStatus.CANCELLED,
      "ORDER_CANCELLED",
      EDITING_WORKFLOW_MESSAGES.orderCancelled,
    ],
    [
      OrderStatus.DELIVERED,
      "ORDER_DELIVERED",
      EDITING_WORKFLOW_MESSAGES.orderDelivered,
    ],
  ] as const) {
    const policy = buildEditingWorkflowPolicy({
      ...baseInput,
      orderStatus,
    });

    assert.deepEqual(enabledActions(policy), []);
    assert.ok(policy.actions.every((item) => item.blockedReason === reason));
    assert.deepEqual(policy.blockers, [message]);
  }
});

test("R10b editing policy keeps start guard messages aligned", () => {
  assert.throws(
    () =>
      assertEditingReadyToStartPolicy({
        selectionStatus: OrderSelectionStatus.PENDING,
        assignedEditorId: "editor-1",
        basePaymentVerified: true,
        hasOutstandingBalance: false,
      }),
    { message: EDITING_WORKFLOW_MESSAGES.selectionIncomplete }
  );

  assert.throws(
    () =>
      assertEditingReadyToStartPolicy({
        selectionStatus: OrderSelectionStatus.COMPLETED,
        assignedEditorId: "editor-1",
        basePaymentVerified: false,
        hasOutstandingBalance: false,
      }),
    { message: EDITING_WORKFLOW_MESSAGES.basePaymentRequired }
  );

  assert.throws(
    () =>
      assertEditingReadyToStartPolicy({
        selectionStatus: OrderSelectionStatus.COMPLETED,
        assignedEditorId: "editor-1",
        basePaymentVerified: true,
        hasOutstandingBalance: true,
      }),
    { message: EDITING_WORKFLOW_MESSAGES.finalBalanceRequired }
  );

  assert.throws(
    () =>
      assertEditingReadyToStartPolicy({
        selectionStatus: OrderSelectionStatus.COMPLETED,
        assignedEditorId: null,
        basePaymentVerified: true,
        hasOutstandingBalance: false,
      }),
    { message: "Assign an editor before starting editing" }
  );
});

test("R10b EditingWorkflowForm renders from policy actions instead of local can flags", () => {
  const componentSource = readFileSync(
    `${ROOT}/src/components/orders/editing-workflow-form.tsx`,
    "utf8"
  );
  const serviceSource = readFileSync(
    `${ROOT}/src/modules/orders/order.service.ts`,
    "utf8"
  );

  assert.match(componentSource, /workflowPolicy\.actions\.map/);
  assert.match(componentSource, /action\.label/);
  assert.match(componentSource, /action\.disabled/);
  assert.doesNotMatch(componentSource, /editing\.canAssignEditor/);
  assert.doesNotMatch(componentSource, /editing\.canMarkStarted/);
  assert.doesNotMatch(componentSource, /editing\.canRequestRevision/);
  assert.doesNotMatch(componentSource, /editing\.canMarkComplete/);
  assert.doesNotMatch(componentSource, /editing\.canMarkApproved/);
  assert.doesNotMatch(componentSource, /editing\.canSendToProduction/);
  assert.match(serviceSource, /buildEditingWorkflowPolicy/);
  assert.match(serviceSource, /assertEditingReadyToStartPolicy/);
});

function enabledActions(policy: ReturnType<typeof buildEditingWorkflowPolicy>) {
  return policy.actions
    .filter((item) => item.available)
    .map((item) => item.key);
}

function action(
  policy: ReturnType<typeof buildEditingWorkflowPolicy>,
  key: EditingWorkflowActionKey
) {
  const item = policy.actions.find((entry) => entry.key === key);
  assert.ok(item);
  return item;
}
