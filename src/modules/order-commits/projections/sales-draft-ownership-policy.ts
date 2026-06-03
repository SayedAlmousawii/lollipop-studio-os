import type { SalesPageDraftOwnership } from "./sales-page-view.types";
import type {
  OrderEditModePolicy,
  POSAddOnEditPolicies,
  POSPackageCompositionEditPolicies,
} from "@/modules/orders/policies/edit-mode-policy";

const BLOCKED_BY_OWNER_MESSAGE =
  "Another user owns this Sales draft. Refresh or coordinate before editing.";

export function applySalesDraftOwnershipToPackagePolicies(
  policies: POSPackageCompositionEditPolicies,
  ownership: SalesPageDraftOwnership
): POSPackageCompositionEditPolicies {
  if (ownership.canStage) return policies;

  return {
    packageTierChange: blockPolicy(policies.packageTierChange),
    packageItemUpgrade: blockPolicy(policies.packageItemUpgrade),
    selectedPhotoCountChange: blockPolicy(policies.selectedPhotoCountChange),
    sessionConfigurationOperationalEdit: blockPolicy(
      policies.sessionConfigurationOperationalEdit
    ),
    sessionConfigurationFinancialEdit: blockPolicy(
      policies.sessionConfigurationFinancialEdit
    ),
  };
}

export function applySalesDraftOwnershipToAddOnPolicies(
  policies: POSAddOnEditPolicies,
  ownership: SalesPageDraftOwnership
): POSAddOnEditPolicies {
  if (ownership.canStage) return policies;

  return {
    addAddOn: blockPolicy(policies.addAddOn),
    removeAddOn: blockPolicy(policies.removeAddOn),
  };
}

function blockPolicy(policy: OrderEditModePolicy): OrderEditModePolicy {
  return {
    ...policy,
    canEditDirectly: false,
    isInteractive: false,
    requiresManagerApproval: false,
    userFacingMessage: BLOCKED_BY_OWNER_MESSAGE,
  };
}
