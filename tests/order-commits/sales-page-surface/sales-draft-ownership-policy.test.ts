import assert from "node:assert/strict";
import test from "node:test";
import {
  applySalesDraftOwnershipToAddOnPolicies,
  applySalesDraftOwnershipToPackagePolicies,
  type SalesPageDraftOwnership,
} from "@/modules/order-commits/projections";
import type {
  OrderEditKind,
  OrderEditModePolicy,
  POSAddOnEditPolicies,
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

function packagePoliciesFixture(): POSPackageCompositionEditPolicies {
  return {
    packageTierChange: policy("package_tier_change"),
    packageItemUpgrade: policy("package_item_upgrade"),
    selectedPhotoCountChange: policy("selected_photo_count_change"),
    sessionConfigurationOperationalEdit: policy(
      "session_configuration_operational_edit"
    ),
    sessionConfigurationFinancialEdit: policy(
      "session_configuration_financial_edit"
    ),
  };
}

function addOnPoliciesFixture(): POSAddOnEditPolicies {
  return {
    addAddOn: policy("add_on_add"),
    removeAddOn: policy("add_on_remove"),
  };
}

function policy(editKind: OrderEditKind): OrderEditModePolicy {
  return {
    mode: "draft",
    editKind,
    canEditDirectly: true,
    isInteractive: true,
    shouldOpenAdjustmentWorkspace: false,
    requiresManagerApproval: false,
    openWorkspaceIsActive: false,
    blockedReason: null,
    routeTarget: null,
    userFacingMessage: "Allowed",
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
