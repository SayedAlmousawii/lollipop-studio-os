import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  OrderDeliveryStatus,
  OrderEditingStatus,
  OrderProductionSectionStatus,
  OrderProductionStatus,
  OrderStatus,
} from "@prisma/client";
import {
  assertProductionAssemblyDependencyPolicy,
  assertProductionReadyForPickupPolicy,
  assertProductionWorkflowWritablePolicy,
  buildProductionWorkflowPolicy,
  guardCodeForProductionReadyError,
  PRODUCTION_WORKFLOW_MESSAGES,
  type BuildProductionWorkflowPolicyInput,
  type ProductionWorkflowActionKey,
  type ProductionWorkflowSectionKey,
} from "@/modules/orders/policies/production-workflow-policy";

const ROOT = process.cwd();

const baseInput: BuildProductionWorkflowPolicyInput = {
  orderStatus: OrderStatus.PRODUCTION,
  editingStatus: OrderEditingStatus.COMPLETED,
  productionStatus: OrderProductionStatus.IN_PROGRESS,
  deliveryStatus: OrderDeliveryStatus.NOT_READY,
  albumDesignStatus: OrderProductionSectionStatus.NOT_STARTED,
  printingStatus: OrderProductionSectionStatus.NOT_STARTED,
  assemblyStatus: OrderProductionSectionStatus.NOT_STARTED,
  vendorStatus: OrderProductionSectionStatus.NOT_STARTED,
  framedPrintsStatus: OrderProductionSectionStatus.NOT_STARTED,
  finalStatus: OrderProductionSectionStatus.NOT_STARTED,
};

test("R10c production policy exposes one entry for each submitted production action", () => {
  const policy = buildProductionWorkflowPolicy(baseInput);

  assert.deepEqual(
    policy.actions.map((item) => item.key),
    [
      "markAlbumDesignStarted",
      "markAlbumDesignCompleted",
      "markSentToPrint",
      "markAssemblyStarted",
      "markAssemblyCompleted",
      "markVendorInProgress",
      "markVendorCompleted",
      "markPrintsReady",
      "markProductionReadyForPickup",
    ] satisfies ProductionWorkflowActionKey[]
  );
});

test("R10c production policy owns section action selection and labels", () => {
  const policy = buildProductionWorkflowPolicy({
    ...baseInput,
    albumDesignStatus: OrderProductionSectionStatus.IN_PROGRESS,
    printingStatus: OrderProductionSectionStatus.IN_PROGRESS,
    vendorStatus: OrderProductionSectionStatus.IN_PROGRESS,
    framedPrintsStatus: OrderProductionSectionStatus.IN_PROGRESS,
  });

  assert.equal(sectionAction(policy, "albumDesign")?.key, "markAlbumDesignCompleted");
  assert.equal(sectionAction(policy, "albumDesign")?.label, "Complete");
  assert.equal(sectionAction(policy, "printing")?.key, "markPrintsReady");
  assert.equal(sectionAction(policy, "printing")?.label, "Prints ready");
  assert.equal(sectionAction(policy, "vendor")?.key, "markVendorCompleted");
  assert.equal(sectionAction(policy, "vendor")?.label, "Vendor complete");
  assert.equal(sectionAction(policy, "framedPrints")?.key, "markPrintsReady");

  const completedPolicy = buildProductionWorkflowPolicy({
    ...baseInput,
    albumDesignStatus: OrderProductionSectionStatus.COMPLETED,
    printingStatus: OrderProductionSectionStatus.COMPLETED,
    assemblyStatus: OrderProductionSectionStatus.COMPLETED,
    vendorStatus: OrderProductionSectionStatus.COMPLETED,
    framedPrintsStatus: OrderProductionSectionStatus.COMPLETED,
  });

  assert.equal(sectionAction(completedPolicy, "albumDesign"), null);
  assert.equal(sectionAction(completedPolicy, "printing"), null);
  assert.equal(sectionAction(completedPolicy, "assembly"), null);
  assert.equal(sectionAction(completedPolicy, "vendor"), null);
  assert.equal(sectionAction(completedPolicy, "framedPrints"), null);
});

test("R10c production policy represents the album assembly dependency", () => {
  const blocked = buildProductionWorkflowPolicy({
    ...baseInput,
    assemblyStatus: OrderProductionSectionStatus.IN_PROGRESS,
  });

  assert.equal(sectionAction(blocked, "assembly"), null);
  assert.equal(
    action(blocked, "markAssemblyCompleted").blockedReason,
    "ALBUM_DESIGN_INCOMPLETE"
  );
  assert.deepEqual(action(blocked, "markAssemblyCompleted").blockerMessages, [
    PRODUCTION_WORKFLOW_MESSAGES.assemblyCompleteBlocked,
  ]);
  assert.equal(
    action(blocked, "markProductionReadyForPickup").blockedReason,
    "ALBUM_DESIGN_INCOMPLETE"
  );
  assert.equal(
    blocked.readinessWarning,
    PRODUCTION_WORKFLOW_MESSAGES.assemblyDependencyWarning
  );

  const unblocked = buildProductionWorkflowPolicy({
    ...blockedInput(blocked),
    albumDesignStatus: OrderProductionSectionStatus.COMPLETED,
  });

  assert.equal(sectionAction(unblocked, "assembly")?.key, "markAssemblyCompleted");
  assert.equal(action(unblocked, "markAssemblyCompleted").available, true);
});

test("R10c production policy owns final-readiness blockers", () => {
  const editingIncomplete = buildProductionWorkflowPolicy({
    ...baseInput,
    editingStatus: OrderEditingStatus.IN_PROGRESS,
  });
  assert.equal(editingIncomplete.finalReadinessAction.disabled, true);
  assert.equal(
    editingIncomplete.finalReadinessAction.blockedReason,
    "EDITING_INCOMPLETE"
  );
  assert.deepEqual(editingIncomplete.finalReadinessAction.blockerMessages, [
    PRODUCTION_WORKFLOW_MESSAGES.editingIncompleteGuard,
  ]);

  const ready = buildProductionWorkflowPolicy({
    ...baseInput,
    productionStatus: OrderProductionStatus.READY_FOR_PICKUP,
  });
  assert.equal(
    ready.finalReadinessAction.blockedReason,
    "PRODUCTION_ALREADY_READY"
  );
  assert.equal(sectionAction(ready, "finalReadiness"), null);

  const completed = buildProductionWorkflowPolicy({
    ...baseInput,
    productionStatus: OrderProductionStatus.COMPLETED,
  });
  assert.equal(
    completed.finalReadinessAction.blockedReason,
    "PRODUCTION_ALREADY_COMPLETED"
  );
});

test("R10c production policy blocks cancelled and delivered orders", () => {
  for (const [orderStatus, reason, message] of [
    [
      OrderStatus.CANCELLED,
      "ORDER_CANCELLED",
      PRODUCTION_WORKFLOW_MESSAGES.orderCancelled,
    ],
    [
      OrderStatus.DELIVERED,
      "ORDER_DELIVERED",
      PRODUCTION_WORKFLOW_MESSAGES.orderDelivered,
    ],
  ] as const) {
    const policy = buildProductionWorkflowPolicy({
      ...baseInput,
      orderStatus,
    });

    assert.deepEqual(enabledActions(policy), []);
    assert.ok(policy.actions.every((item) => item.blockedReason === reason));
    assert.deepEqual(policy.blockers, [message]);
    assert.equal(sectionAction(policy, "albumDesign"), null);
    assert.equal(sectionAction(policy, "finalReadiness"), null);
  }
});

test("R10c production policy guard helpers align with service guard messages", () => {
  assert.throws(
    () => assertProductionWorkflowWritablePolicy(OrderStatus.CANCELLED),
    { message: PRODUCTION_WORKFLOW_MESSAGES.orderCancelled }
  );
  assert.throws(
    () =>
      assertProductionAssemblyDependencyPolicy(
        { albumDesignStatus: OrderProductionSectionStatus.NOT_STARTED },
        "markAssemblyStarted"
      ),
    { message: PRODUCTION_WORKFLOW_MESSAGES.assemblyStartBlocked }
  );
  assert.throws(
    () =>
      assertProductionReadyForPickupPolicy({
        editingStatus: OrderEditingStatus.IN_PROGRESS,
        albumDesignStatus: OrderProductionSectionStatus.COMPLETED,
        assemblyStatus: OrderProductionSectionStatus.NOT_STARTED,
      }),
    { message: PRODUCTION_WORKFLOW_MESSAGES.editingIncompleteGuard }
  );
  assert.throws(
    () =>
      assertProductionReadyForPickupPolicy({
        editingStatus: OrderEditingStatus.COMPLETED,
        albumDesignStatus: OrderProductionSectionStatus.NOT_STARTED,
        assemblyStatus: OrderProductionSectionStatus.IN_PROGRESS,
      }),
    { message: PRODUCTION_WORKFLOW_MESSAGES.readinessAssemblyBlocked }
  );
});

test("R10c production readiness guard-code mapping is explicit", () => {
  assert.equal(
    guardCodeForProductionReadyError(
      PRODUCTION_WORKFLOW_MESSAGES.editingIncompleteGuard
    ),
    "EDITING_INCOMPLETE"
  );
  assert.equal(
    guardCodeForProductionReadyError(
      PRODUCTION_WORKFLOW_MESSAGES.readinessAssemblyBlocked
    ),
    "ALBUM_DESIGN_INCOMPLETE"
  );
  assert.throws(
    () => guardCodeForProductionReadyError("Unexpected readiness condition"),
    {
      message:
        "Unexpected production readiness guard message: Unexpected readiness condition",
    }
  );
});

test("R10c ProductionWorkflowForm renders from policy output instead of local can flags", () => {
  const componentSource = readFileSync(
    `${ROOT}/src/components/orders/production-workflow-form.tsx`,
    "utf8"
  );
  const serviceSource = readFileSync(
    `${ROOT}/src/modules/orders/order.service.ts`,
    "utf8"
  );

  assert.match(componentSource, /workflowPolicy\.sections\.map/);
  assert.match(componentSource, /workflowPolicy\.finalReadinessAction/);
  assert.match(componentSource, /section\.action\.label/);
  assert.match(componentSource, /section\.action\.disabled/);
  assert.doesNotMatch(componentSource, /production\.sections\.map/);
  assert.doesNotMatch(componentSource, /production\.canUpdateProduction/);
  assert.doesNotMatch(componentSource, /production\.canMarkReadyForPickup/);
  assert.match(serviceSource, /buildProductionWorkflowPolicy/);
  assert.match(serviceSource, /assertProductionReadyForPickupPolicy/);
  assert.match(serviceSource, /assertProductionAssemblyDependencyPolicy/);
});

function enabledActions(policy: ReturnType<typeof buildProductionWorkflowPolicy>) {
  return policy.actions
    .filter((item) => item.available)
    .map((item) => item.key);
}

function sectionAction(
  policy: ReturnType<typeof buildProductionWorkflowPolicy>,
  key: ProductionWorkflowSectionKey
) {
  const section = policy.sections.find((item) => item.key === key);
  assert.ok(section);
  return section.action;
}

function action(
  policy: ReturnType<typeof buildProductionWorkflowPolicy>,
  key: ProductionWorkflowActionKey
) {
  const item = policy.actions.find((entry) => entry.key === key);
  assert.ok(item);
  return item;
}

function blockedInput(
  policy: ReturnType<typeof buildProductionWorkflowPolicy>
): BuildProductionWorkflowPolicyInput {
  return {
    ...baseInput,
    productionStatus: policy.productionStatus,
    deliveryStatus: policy.deliveryStatus,
    assemblyStatus: OrderProductionSectionStatus.IN_PROGRESS,
  };
}
