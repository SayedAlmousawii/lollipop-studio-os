import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import { OrderEditingStatus, OrderStatus } from "@prisma/client";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OrderEditingWorkflow } from "@/modules/orders/order.types";
import { buildEditingWorkflowPolicy } from "@/modules/orders/policies/editing-workflow-policy";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

type EditingWorkflowFormComponent = ComponentType<{
  editing: OrderEditingWorkflow;
}>;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };

test("EditingWorkflowForm renders deposit terminology for the unpaid start gate", async () => {
  const EditingWorkflowForm = await loadEditingWorkflowForm();
  const markup = renderToStaticMarkup(
    createElement(EditingWorkflowForm, {
      editing: editingFixture(),
    })
  );

  assert.match(markup, /deposit exists/i);
  assert.doesNotMatch(markup, /base payment/i);
});

async function loadEditingWorkflowForm(): Promise<EditingWorkflowFormComponent> {
  const originalModuleLoad = moduleWithLoader._load;
  moduleWithLoader._load = function loadWithActionStubs(request, parent, isMain) {
    if (request === "@/app/(app)/orders/[orderId]/actions") {
      return {
        updateEditingWorkflowAction: async () => ({}),
      };
    }
    if (request === "@/components/orders/record-upgrade-payment-dialog") {
      return {
        RecordUpgradePaymentDialog: () => createElement("button", null, "Record Payment"),
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };

  try {
    const formModule = await import(
      "../../src/components/orders/editing-workflow-form.tsx"
    );
    return formModule.EditingWorkflowForm;
  } finally {
    moduleWithLoader._load = originalModuleLoad;
  }
}

function editingFixture(): OrderEditingWorkflow {
  return {
    orderId: "order-1",
    invoiceId: null,
    assignedEditorId: "editor-1",
    assignedEditorName: "Editor One",
    assignedAt: "2026-05-20",
    editingStatus: "ASSIGNED",
    productionStatus: "NOT_STARTED",
    progressPercent: 0,
    editedPhotoCount: 0,
    targetPhotoCount: 12,
    revisionCount: 0,
    revisionState: "No revisions",
    approvalState: "Pending approval",
    estimatedCompletionDate: null,
    estimatedCompletionDateInput: "",
    startedAt: null,
    completedAt: null,
    customerApprovedAt: null,
    sentToProductionAt: null,
    basePaymentVerified: false,
    outstandingBalanceAmount: null,
    outstandingBalanceLabel: null,
    canAssignEditor: true,
    canMarkStarted: false,
    canRequestRevision: false,
    canMarkComplete: false,
    canMarkApproved: false,
    canSendToProduction: false,
    workflowPolicy: buildEditingWorkflowPolicy({
      orderStatus: OrderStatus.SELECTION_COMPLETED,
      selectionStatus: "COMPLETED",
      editingStatus: OrderEditingStatus.ASSIGNED,
      assignedEditorId: "editor-1",
      hasEditorOptions: true,
      basePaymentVerified: false,
      hasOutstandingBalance: false,
    }),
    editorOptions: [{ id: "editor-1", name: "Editor One" }],
  };
}
