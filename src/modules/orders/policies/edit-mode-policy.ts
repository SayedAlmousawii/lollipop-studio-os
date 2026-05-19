import { OrderStatus, SessionConfigurationFinancialBehavior } from "@prisma/client";

export const ORDER_EDIT_KIND = {
  PACKAGE_TIER_CHANGE: "package_tier_change",
  PACKAGE_ITEM_UPGRADE: "package_item_upgrade",
  SELECTED_PHOTO_COUNT_CHANGE: "selected_photo_count_change",
  ADD_ON_ADD: "add_on_add",
  ADD_ON_REMOVE: "add_on_remove",
  SESSION_CONFIGURATION_OPERATIONAL_EDIT:
    "session_configuration_operational_edit",
  SESSION_CONFIGURATION_FINANCIAL_EDIT: "session_configuration_financial_edit",
} as const;

export type OrderEditKind = (typeof ORDER_EDIT_KIND)[keyof typeof ORDER_EDIT_KIND];

export type OrderEditMode = "draft" | "locked" | "adjustment";

export type OrderEditBlockedReason =
  | "ORDER_DELIVERED"
  | "LOCKED_DIRECT_POS_REQUIRES_WORKSPACE"
  | "OPEN_WORKSPACE_REQUIRES_WORKSPACE";

export type OrderEditRouteTarget = {
  href: string;
  label: string;
};

export type OrderEditModePolicy = {
  mode: OrderEditMode;
  editKind: OrderEditKind;
  canEditDirectly: boolean;
  isInteractive: boolean;
  shouldOpenAdjustmentWorkspace: boolean;
  requiresManagerApproval: boolean;
  openWorkspaceIsActive: boolean;
  blockedReason: OrderEditBlockedReason | null;
  routeTarget: OrderEditRouteTarget | null;
  userFacingMessage: string;
};

export type OrderEditModePolicyContext = {
  orderId: string;
  mode: OrderEditMode;
  orderStatus: OrderStatus;
  finalInvoiceIsLocked: boolean;
  openAdjustmentWorkspaceId?: string | null;
};

export type BuildOrderEditModePolicyInput = OrderEditModePolicyContext & {
  editKind: OrderEditKind;
  sessionConfigurationFinancialBehavior?: SessionConfigurationFinancialBehavior;
  affectedConfigurationNames?: string[];
};

export type POSPackageCompositionEditPolicies = {
  packageTierChange: OrderEditModePolicy;
  packageItemUpgrade: OrderEditModePolicy;
  selectedPhotoCountChange: OrderEditModePolicy;
  sessionConfigurationOperationalEdit: OrderEditModePolicy;
  sessionConfigurationFinancialEdit: OrderEditModePolicy;
};

export type POSAddOnEditPolicies = {
  addAddOn: OrderEditModePolicy;
  removeAddOn: OrderEditModePolicy;
};

export type POSFinancialSidebarEditPolicies = {
  invoiceLocked: OrderEditModePolicy;
};

export const ORDER_EDIT_MODE_MESSAGES = {
  deliveredOrder: "Delivered orders cannot be edited",
  lockedDirectPOS:
    "Locked invoices can only be changed through an Adjustment Workspace.",
  openWorkspace:
    "An Adjustment Workspace is open. Continue this edit there.",
  draftDirect: "This edit saves directly to the sales workspace.",
  lockedOperationalSessionConfiguration:
    "Operational session settings can be saved directly and will be audit logged.",
  adjustmentWorkspace:
    "Changes are staged in this Adjustment Workspace; manager approval is checked when finalizing.",
  directReductiveApproval:
    "Reductions may require manager confirmation before the direct edit can be saved.",
} as const;

export function buildOrderEditModePolicy(
  input: BuildOrderEditModePolicyInput
): OrderEditModePolicy {
  const routeTarget = adjustmentWorkspaceRoute(input.orderId);
  const isDelivered = input.orderStatus === OrderStatus.DELIVERED;
  const isLocked = input.finalInvoiceIsLocked;
  const hasOpenWorkspace = Boolean(input.openAdjustmentWorkspaceId);

  if (isDelivered) {
    return {
      mode: input.mode,
      editKind: input.editKind,
      canEditDirectly: false,
      isInteractive: false,
      shouldOpenAdjustmentWorkspace: false,
      requiresManagerApproval: false,
      openWorkspaceIsActive: false,
      blockedReason: "ORDER_DELIVERED",
      routeTarget: null,
      userFacingMessage: ORDER_EDIT_MODE_MESSAGES.deliveredOrder,
    };
  }

  if (input.mode === "adjustment") {
    return {
      mode: input.mode,
      editKind: input.editKind,
      canEditDirectly: false,
      isInteractive: true,
      shouldOpenAdjustmentWorkspace: false,
      requiresManagerApproval: false,
      openWorkspaceIsActive: false,
      blockedReason: null,
      routeTarget: null,
      userFacingMessage: ORDER_EDIT_MODE_MESSAGES.adjustmentWorkspace,
    };
  }

  if (input.mode === "locked" || isLocked) {
    if (isOperationalSessionConfiguration(input)) {
      return {
        mode: "locked",
        editKind: input.editKind,
        canEditDirectly: true,
        isInteractive: true,
        shouldOpenAdjustmentWorkspace: false,
        requiresManagerApproval: false,
        openWorkspaceIsActive: false,
        blockedReason: null,
        routeTarget: null,
        userFacingMessage:
          ORDER_EDIT_MODE_MESSAGES.lockedOperationalSessionConfiguration,
      };
    }

    return {
      mode: "locked",
      editKind: input.editKind,
      canEditDirectly: false,
      isInteractive: false,
      shouldOpenAdjustmentWorkspace: true,
      requiresManagerApproval: false,
      openWorkspaceIsActive: hasOpenWorkspace,
      blockedReason: hasOpenWorkspace
        ? "OPEN_WORKSPACE_REQUIRES_WORKSPACE"
        : "LOCKED_DIRECT_POS_REQUIRES_WORKSPACE",
      routeTarget,
      userFacingMessage: hasOpenWorkspace
        ? ORDER_EDIT_MODE_MESSAGES.openWorkspace
        : financialSessionConfigurationMessage(input) ??
          ORDER_EDIT_MODE_MESSAGES.lockedDirectPOS,
    };
  }

  return {
    mode: "draft",
    editKind: input.editKind,
    canEditDirectly: true,
    isInteractive: true,
    shouldOpenAdjustmentWorkspace: false,
    requiresManagerApproval: isDirectReductiveEdit(input.editKind),
    openWorkspaceIsActive: false,
    blockedReason: null,
    routeTarget: null,
    userFacingMessage: isDirectReductiveEdit(input.editKind)
      ? ORDER_EDIT_MODE_MESSAGES.directReductiveApproval
      : ORDER_EDIT_MODE_MESSAGES.draftDirect,
  };
}

export function buildPOSPackageCompositionEditPolicies(
  context: OrderEditModePolicyContext
): POSPackageCompositionEditPolicies {
  return {
    packageTierChange: buildOrderEditModePolicy({
      ...context,
      editKind: ORDER_EDIT_KIND.PACKAGE_TIER_CHANGE,
    }),
    packageItemUpgrade: buildOrderEditModePolicy({
      ...context,
      editKind: ORDER_EDIT_KIND.PACKAGE_ITEM_UPGRADE,
    }),
    selectedPhotoCountChange: buildOrderEditModePolicy({
      ...context,
      editKind: ORDER_EDIT_KIND.SELECTED_PHOTO_COUNT_CHANGE,
    }),
    sessionConfigurationOperationalEdit: buildOrderEditModePolicy({
      ...context,
      editKind: ORDER_EDIT_KIND.SESSION_CONFIGURATION_OPERATIONAL_EDIT,
      sessionConfigurationFinancialBehavior:
        SessionConfigurationFinancialBehavior.OPERATIONAL,
    }),
    sessionConfigurationFinancialEdit: buildOrderEditModePolicy({
      ...context,
      editKind: ORDER_EDIT_KIND.SESSION_CONFIGURATION_FINANCIAL_EDIT,
      sessionConfigurationFinancialBehavior:
        SessionConfigurationFinancialBehavior.FINANCIAL,
    }),
  };
}

export function buildPOSAddOnEditPolicies(
  context: OrderEditModePolicyContext
): POSAddOnEditPolicies {
  return {
    addAddOn: buildOrderEditModePolicy({
      ...context,
      editKind: ORDER_EDIT_KIND.ADD_ON_ADD,
    }),
    removeAddOn: buildOrderEditModePolicy({
      ...context,
      editKind: ORDER_EDIT_KIND.ADD_ON_REMOVE,
    }),
  };
}

export function buildPOSFinancialSidebarEditPolicies(
  context: OrderEditModePolicyContext
): POSFinancialSidebarEditPolicies {
  return {
    invoiceLocked: buildOrderEditModePolicy({
      ...context,
      editKind: ORDER_EDIT_KIND.PACKAGE_TIER_CHANGE,
    }),
  };
}

export function orderEditModeContextFromWorkspace(input: {
  orderId: string;
  orderStatus: OrderStatus;
  finalInvoiceIsLocked: boolean;
  openAdjustmentWorkspaceId?: string | null;
  persistenceContext: "sales" | "adjustment";
}): OrderEditModePolicyContext {
  return {
    orderId: input.orderId,
    orderStatus: input.orderStatus,
    finalInvoiceIsLocked: input.finalInvoiceIsLocked,
    openAdjustmentWorkspaceId: input.openAdjustmentWorkspaceId ?? null,
    mode:
      input.persistenceContext === "adjustment"
        ? "adjustment"
        : input.finalInvoiceIsLocked
          ? "locked"
          : "draft",
  };
}

function adjustmentWorkspaceRoute(orderId: string): OrderEditRouteTarget {
  return {
    href: `/orders/${orderId}/adjustment-workspace`,
    label: "Edit in Adjustment Workspace",
  };
}

function isOperationalSessionConfiguration(
  input: BuildOrderEditModePolicyInput
): boolean {
  return (
    input.editKind === ORDER_EDIT_KIND.SESSION_CONFIGURATION_OPERATIONAL_EDIT ||
    input.sessionConfigurationFinancialBehavior ===
      SessionConfigurationFinancialBehavior.OPERATIONAL
  );
}

function financialSessionConfigurationMessage(
  input: BuildOrderEditModePolicyInput
): string | null {
  if (input.editKind !== ORDER_EDIT_KIND.SESSION_CONFIGURATION_FINANCIAL_EDIT) {
    return null;
  }
  const names = [...new Set(input.affectedConfigurationNames ?? [])].filter(
    (name) => name.trim().length > 0
  );
  if (names.length === 0) {
    return "Edit financial session settings in the Adjustment Workspace.";
  }
  return `Edit ${names.join(", ")} in the Adjustment Workspace.`;
}

function isDirectReductiveEdit(editKind: OrderEditKind): boolean {
  return editKind === ORDER_EDIT_KIND.ADD_ON_REMOVE;
}
