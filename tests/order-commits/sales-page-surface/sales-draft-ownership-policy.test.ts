import assert from "node:assert/strict";
import test from "node:test";
import {
  applySalesDraftOwnershipToAddOnPolicies,
  applySalesDraftOwnershipToPackagePolicies,
  applyOrderCommitSalesSurfaceToAddOnPolicies,
  applyOrderCommitSalesSurfaceToFinancialPolicies,
  applyOrderCommitSalesSurfaceToPackagePolicies,
  type SalesPageDraftOwnership,
} from "@/modules/order-commits/projections";
import type {
  OrderEditKind,
  OrderEditModePolicy,
  POSAddOnEditPolicies,
  POSFinancialSidebarEditPolicies,
  POSPackageCompositionEditPolicies,
} from "@/modules/orders/policies/edit-mode-policy";

test("ownership overlay leaves policies unchanged when actor can stage", () => {
  const packagePolicies = packagePoliciesFixture();
  const addOnPolicies = addOnPoliciesFixture();
  const ownership = ownershipFixture({ canStage: true });

  assert.equal(
    applySalesDraftOwnershipToPackagePolicies(packagePolicies, ownership),
    packagePolicies
  );
  assert.equal(
    applySalesDraftOwnershipToAddOnPolicies(addOnPolicies, ownership),
    addOnPolicies
  );
});

test("ownership overlay disables package, photo, and add-on controls for blocked non-owner", () => {
  const packagePolicies = applySalesDraftOwnershipToPackagePolicies(
    packagePoliciesFixture(),
    ownershipFixture({ canStage: false })
  );
  const addOnPolicies = applySalesDraftOwnershipToAddOnPolicies(
    addOnPoliciesFixture(),
    ownershipFixture({ canStage: false })
  );

  assert.equal(packagePolicies.packageTierChange.isInteractive, false);
  assert.equal(packagePolicies.selectedPhotoCountChange.isInteractive, false);
  assert.equal(packagePolicies.packageItemUpgrade.isInteractive, false);
  assert.equal(addOnPolicies.addAddOn.isInteractive, false);
  assert.equal(addOnPolicies.removeAddOn.isInteractive, false);
  assert.match(
    packagePolicies.packageTierChange.userFacingMessage,
    /Another user owns this Sales draft/
  );
});

test("OrderCommit Sales surface projection enables locked policies without workspace copy", () => {
  const packagePolicies = applyOrderCommitSalesSurfaceToPackagePolicies(
    packagePoliciesFixture({ locked: true })
  );
  const addOnPolicies = applyOrderCommitSalesSurfaceToAddOnPolicies(
    addOnPoliciesFixture({ locked: true })
  );
  const financialPolicies = applyOrderCommitSalesSurfaceToFinancialPolicies(
    financialPoliciesFixture({ locked: true })
  );

  assert.equal(packagePolicies.packageTierChange.isInteractive, true);
  assert.equal(packagePolicies.selectedPhotoCountChange.isInteractive, true);
  assert.equal(addOnPolicies.addAddOn.isInteractive, true);
  assert.equal(financialPolicies.invoiceLocked.isInteractive, true);
  assert.equal(
    packagePolicies.packageTierChange.shouldOpenAdjustmentWorkspace,
    false
  );
  assert.equal(packagePolicies.packageTierChange.routeTarget, null);
  assert.equal(packagePolicies.packageTierChange.blockedReason, null);
  assert.equal(financialPolicies.invoiceLocked.routeTarget, null);
  assert.equal(financialPolicies.invoiceLocked.blockedReason, null);
  assert.match(packagePolicies.packageTierChange.userFacingMessage, /Sales draft/);
  assert.match(financialPolicies.invoiceLocked.userFacingMessage, /Sales draft/);
  assert.doesNotMatch(
    packagePolicies.packageTierChange.userFacingMessage,
    /Adjustment Workspace/
  );
  assert.doesNotMatch(
    financialPolicies.invoiceLocked.userFacingMessage,
    /Adjustment Workspace/
  );
});

function packagePoliciesFixture(
  input: { locked?: boolean } = {}
): POSPackageCompositionEditPolicies {
  return {
    packageTierChange: policy("package_tier_change", input),
    packageItemUpgrade: policy("package_item_upgrade", input),
    selectedPhotoCountChange: policy("selected_photo_count_change", input),
    sessionConfigurationOperationalEdit: policy(
      "session_configuration_operational_edit",
      input
    ),
    sessionConfigurationFinancialEdit: policy(
      "session_configuration_financial_edit",
      input
    ),
  };
}

function addOnPoliciesFixture(
  input: { locked?: boolean } = {}
): POSAddOnEditPolicies {
  return {
    addAddOn: policy("add_on_add", input),
    removeAddOn: policy("add_on_remove", input),
  };
}

function financialPoliciesFixture(
  input: { locked?: boolean } = {}
): POSFinancialSidebarEditPolicies {
  return {
    invoiceLocked: policy("package_tier_change", input),
  };
}

function policy(
  editKind: OrderEditKind,
  input: { locked?: boolean } = {}
): OrderEditModePolicy {
  return {
    mode: input.locked ? "locked" : "draft",
    editKind,
    canEditDirectly: !input.locked,
    isInteractive: !input.locked,
    shouldOpenAdjustmentWorkspace: input.locked ?? false,
    requiresManagerApproval: false,
    openWorkspaceIsActive: input.locked ?? false,
    blockedReason: input.locked ? "LOCKED_DIRECT_POS_REQUIRES_WORKSPACE" : null,
    routeTarget: input.locked
      ? {
          href: "/orders/order-1/adjustment-workspace",
          label: "Edit in Adjustment Workspace",
        }
      : null,
    userFacingMessage: input.locked
      ? "Locked invoices can only be changed through an Adjustment Workspace."
      : "Allowed",
  };
}

function ownershipFixture(
  overrides: Partial<SalesPageDraftOwnership>
): SalesPageDraftOwnership {
  return {
    mode: "owner",
    hasDraft: true,
    isOwner: true,
    isManagerOverride: false,
    canStage: true,
    canDiscard: true,
    canCommit: true,
    ownerUserId: "owner-1",
    openedByUserId: "owner-1",
    lastTouchedByUserId: "owner-1",
    updatedAt: new Date("2026-06-03T10:00:00.000Z"),
    banner: null,
    ...overrides,
  };
}
