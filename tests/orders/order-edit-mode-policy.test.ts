import assert from "node:assert/strict";
import test from "node:test";
import {
  OrderStatus,
  SessionConfigurationFinancialBehavior,
} from "@prisma/client";
import {
  buildOrderEditModePolicy,
  ORDER_EDIT_KIND,
  ORDER_EDIT_MODE_MESSAGES,
} from "@/modules/orders/policies/edit-mode-policy";

const base = {
  orderId: "order-1",
  orderStatus: OrderStatus.WAITING_SELECTION,
  openAdjustmentWorkspaceId: null,
};

test("OrderEditModePolicy allows unlocked sales edits directly", () => {
  const policy = buildOrderEditModePolicy({
    ...base,
    mode: "draft",
    finalInvoiceIsLocked: false,
    editKind: ORDER_EDIT_KIND.ADD_ON_ADD,
  });

  assert.equal(policy.mode, "draft");
  assert.equal(policy.canEditDirectly, true);
  assert.equal(policy.shouldOpenAdjustmentWorkspace, false);
  assert.equal(policy.requiresManagerApproval, false);
  assert.equal(policy.blockedReason, null);
});

test("OrderEditModePolicy marks direct reductive sales edits as manager-approval candidates", () => {
  const policy = buildOrderEditModePolicy({
    ...base,
    mode: "draft",
    finalInvoiceIsLocked: false,
    editKind: ORDER_EDIT_KIND.ADD_ON_REMOVE,
  });

  assert.equal(policy.canEditDirectly, true);
  assert.equal(policy.requiresManagerApproval, true);
  assert.equal(
    policy.userFacingMessage,
    ORDER_EDIT_MODE_MESSAGES.directReductiveApproval
  );
});

test("OrderEditModePolicy routes locked sales composition edits to workspace", () => {
  for (const editKind of [
    ORDER_EDIT_KIND.PACKAGE_TIER_CHANGE,
    ORDER_EDIT_KIND.PACKAGE_ITEM_UPGRADE,
    ORDER_EDIT_KIND.SELECTED_PHOTO_COUNT_CHANGE,
    ORDER_EDIT_KIND.ADD_ON_ADD,
    ORDER_EDIT_KIND.ADD_ON_REMOVE,
  ]) {
    const policy = buildOrderEditModePolicy({
      ...base,
      mode: "locked",
      finalInvoiceIsLocked: true,
      editKind,
    });

    assert.equal(policy.canEditDirectly, false);
    assert.equal(policy.shouldOpenAdjustmentWorkspace, true);
    assert.equal(policy.requiresManagerApproval, false);
    assert.equal(policy.blockedReason, "LOCKED_DIRECT_POS_REQUIRES_WORKSPACE");
    assert.equal(policy.routeTarget?.href, "/orders/order-1/adjustment-workspace");
    assert.equal(policy.userFacingMessage, ORDER_EDIT_MODE_MESSAGES.lockedDirectPOS);
  }
});

test("OrderEditModePolicy uses open-workspace messaging for locked sales", () => {
  const policy = buildOrderEditModePolicy({
    ...base,
    mode: "locked",
    finalInvoiceIsLocked: true,
    openAdjustmentWorkspaceId: "workspace-1",
    editKind: ORDER_EDIT_KIND.PACKAGE_TIER_CHANGE,
  });

  assert.equal(policy.shouldOpenAdjustmentWorkspace, true);
  assert.equal(policy.blockedReason, "OPEN_WORKSPACE_REQUIRES_WORKSPACE");
  assert.equal(policy.userFacingMessage, ORDER_EDIT_MODE_MESSAGES.openWorkspace);
});

test("OrderEditModePolicy distinguishes operational and financial locked configuration edits", () => {
  const operational = buildOrderEditModePolicy({
    ...base,
    mode: "locked",
    finalInvoiceIsLocked: true,
    editKind: ORDER_EDIT_KIND.SESSION_CONFIGURATION_OPERATIONAL_EDIT,
    sessionConfigurationFinancialBehavior:
      SessionConfigurationFinancialBehavior.OPERATIONAL,
  });
  const financial = buildOrderEditModePolicy({
    ...base,
    mode: "locked",
    finalInvoiceIsLocked: true,
    editKind: ORDER_EDIT_KIND.SESSION_CONFIGURATION_FINANCIAL_EDIT,
    sessionConfigurationFinancialBehavior:
      SessionConfigurationFinancialBehavior.FINANCIAL,
    affectedConfigurationNames: ["Keepsake Box"],
  });

  assert.equal(operational.canEditDirectly, true);
  assert.equal(operational.shouldOpenAdjustmentWorkspace, false);
  assert.equal(financial.canEditDirectly, false);
  assert.equal(financial.shouldOpenAdjustmentWorkspace, true);
  assert.equal(financial.userFacingMessage, "Edit Keepsake Box in the Adjustment Workspace.");
});

test("OrderEditModePolicy treats adjustment workspace edits as staged edits", () => {
  const policy = buildOrderEditModePolicy({
    ...base,
    mode: "adjustment",
    finalInvoiceIsLocked: true,
    openAdjustmentWorkspaceId: "workspace-1",
    editKind: ORDER_EDIT_KIND.SELECTED_PHOTO_COUNT_CHANGE,
  });

  assert.equal(policy.canEditDirectly, false);
  assert.equal(policy.shouldOpenAdjustmentWorkspace, false);
  assert.equal(policy.requiresManagerApproval, false);
  assert.equal(policy.blockedReason, null);
  assert.equal(policy.userFacingMessage, ORDER_EDIT_MODE_MESSAGES.adjustmentWorkspace);
});

test("OrderEditModePolicy blocks delivered orders before edit-mode routing", () => {
  const policy = buildOrderEditModePolicy({
    ...base,
    orderStatus: OrderStatus.DELIVERED,
    mode: "draft",
    finalInvoiceIsLocked: false,
    editKind: ORDER_EDIT_KIND.ADD_ON_ADD,
  });

  assert.equal(policy.canEditDirectly, false);
  assert.equal(policy.shouldOpenAdjustmentWorkspace, false);
  assert.equal(policy.blockedReason, "ORDER_DELIVERED");
  assert.equal(policy.userFacingMessage, ORDER_EDIT_MODE_MESSAGES.deliveredOrder);
});

test("direct POS guard locked message and policy locked message stay aligned", () => {
  const policy = buildOrderEditModePolicy({
    ...base,
    mode: "locked",
    finalInvoiceIsLocked: true,
    editKind: ORDER_EDIT_KIND.ADD_ON_ADD,
  });

  assert.equal(policy.userFacingMessage, ORDER_EDIT_MODE_MESSAGES.lockedDirectPOS);
});
