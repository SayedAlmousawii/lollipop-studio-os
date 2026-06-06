import type { SalesPageDraftOwnership } from "./sales-page-view.types";
import type {
  OrderEditModePolicy,
  POSAddOnEditPolicies,
  POSFinancialSidebarEditPolicies,
  POSPackageCompositionEditPolicies,
} from "@/modules/orders/policies/edit-mode-policy";

const BLOCKED_BY_OWNER_MESSAGE =
  "Another user owns this Sales draft. Refresh or coordinate before editing.";
const ORDER_COMMIT_SALES_STAGING_MESSAGE =
  "This edit stages in the Sales draft and is applied when changes are committed.";

export function applyOrderCommitSalesSurfaceToPackagePolicies(
  policies: POSPackageCompositionEditPolicies
): POSPackageCompositionEditPolicies {
  return {
    packageTierChange: enableOrderCommitStagingPolicy(policies.packageTierChange),
    packageItemUpgrade: enableOrderCommitStagingPolicy(
      policies.packageItemUpgrade
    ),
    selectedPhotoCountChange: enableOrderCommitStagingPolicy(
      policies.selectedPhotoCountChange
    ),
    sessionConfigurationOperationalEdit: enableOrderCommitStagingPolicy(
      policies.sessionConfigurationOperationalEdit
    ),
    sessionConfigurationFinancialEdit: enableOrderCommitStagingPolicy(
      policies.sessionConfigurationFinancialEdit
    ),
  };
}

export function applyOrderCommitSalesSurfaceToAddOnPolicies(
  policies: POSAddOnEditPolicies
): POSAddOnEditPolicies {
  return {
    addAddOn: enableOrderCommitStagingPolicy(policies.addAddOn),
    removeAddOn: enableOrderCommitStagingPolicy(policies.removeAddOn),
  };
}

export function applyOrderCommitSalesSurfaceToFinancialPolicies(
  policies: POSFinancialSidebarEditPolicies
): POSFinancialSidebarEditPolicies {
  return {
    invoiceLocked: enableOrderCommitStagingPolicy(policies.invoiceLocked),
  };
}

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

function enableOrderCommitStagingPolicy(
  policy: OrderEditModePolicy
): OrderEditModePolicy {
  if (policy.blockedReason === "ORDER_DELIVERED") return policy;

  return {
    ...policy,
    canEditDirectly: true,
    isInteractive: true,
    blockedReason: null,
    routeTarget: null,
    userFacingMessage: ORDER_COMMIT_SALES_STAGING_MESSAGE,
  };
}
