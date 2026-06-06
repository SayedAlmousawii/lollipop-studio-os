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
  assert.equal(policy.isInteractive, true);
  assert.equal(policy.requiresManagerApproval, false);
  assert.equal(policy.blockedReason, null);
  assert.equal(policy.routeTarget, null);
});

test("OrderEditModePolicy marks direct reductive sales edits as manager-approval candidates", () => {
  const policy = buildOrderEditModePolicy({
    ...base,
    mode: "draft",
    finalInvoiceIsLocked: false,
    editKind: ORDER_EDIT_KIND.ADD_ON_REMOVE,
  });

  assert.equal(policy.canEditDirectly, true);
  assert.equal(policy.isInteractive, true);
  assert.equal(policy.requiresManagerApproval, true);
  assert.equal(
    policy.userFacingMessage,
    ORDER_EDIT_MODE_MESSAGES.directReductiveApproval
  );
});

test("OrderEditModePolicy blocks locked sales composition edits without a route target", () => {
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
    assert.equal(policy.isInteractive, false);
    assert.equal(policy.requiresManagerApproval, false);
    assert.equal(policy.blockedReason, "LOCKED_DIRECT_POS_REQUIRES_COMMIT");
    assert.equal(policy.routeTarget, null);
    assert.equal(policy.userFacingMessage, ORDER_EDIT_MODE_MESSAGES.lockedDirectPOS);
    assert.doesNotMatch(policy.userFacingMessage, /Adjustment Workspace/);
  }
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
  assert.equal(operational.isInteractive, true);
  assert.equal(operational.blockedReason, null);
  assert.equal(financial.canEditDirectly, false);
  assert.equal(financial.isInteractive, false);
  assert.equal(financial.blockedReason, "LOCKED_DIRECT_POS_REQUIRES_COMMIT");
  assert.equal(
    financial.userFacingMessage,
    "Change Keepsake Box through the Sales draft and commit from POS."
  );
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
  assert.equal(policy.isInteractive, false);
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

test("OrderEditModePolicy source no longer exposes Adjustment Workspace affordances", () => {
  for (const value of Object.values(ORDER_EDIT_MODE_MESSAGES)) {
    assert.doesNotMatch(value, /Adjustment Workspace/);
  }
});
