import type { ActorContext } from "@/lib/auth/actor-context";
import type { FinancialCaseSummary } from "@/modules/financial-cases/financial-case-summary.types";
import type { OrderCompositionViewModel } from "@/modules/orders/composition/order-composition.types";
import type { DraftPOSCompositionProjection } from "@/modules/orders/composition/projections/to-draft-pos-composition";
import type { POSWorkspace } from "@/modules/orders/order.types";
import type { OrderCommitDraftState } from "../order-commit.service";
import type { OrderCommitPreview } from "../order-commit-preview.types";
import { toSalesPageComposition } from "./to-sales-page-composition";
import { toSalesPageFinancialPreview } from "./to-sales-page-financial-preview";
import { toSalesPageStagedChanges } from "./to-sales-page-staged-changes";
import type {
  SalesPageDraftState,
  SalesPagePermissionFlags,
  SalesPageView,
} from "./sales-page-view.types";

export type GetSalesPageViewInput = {
  orderId: string;
  actorContext: ActorContext;
  dependencies?: Partial<SalesPageViewLoaderDependencies>;
};

export type SalesPageViewLoaderDependencies = {
  getPOSWorkspace: (orderId: string) => Promise<POSWorkspace | null>;
  getDraftOrderCompositionViewModel: (
    orderId: string
  ) => Promise<OrderCompositionViewModel | null>;
  getLockedOrderCompositionViewModel: (
    input: { invoiceId: string }
  ) => Promise<OrderCompositionViewModel>;
  toDraftPOSComposition: (
    model: OrderCompositionViewModel
  ) => DraftPOSCompositionProjection;
  getOrderCommitDraft: (input: {
    orderId: string;
  }) => Promise<OrderCommitDraftState | null>;
  getOrderCommitPreview: (input: { orderId: string }) => Promise<OrderCommitPreview>;
  getFinancialCaseSummary: (input: {
    orderId: string;
  }) => Promise<FinancialCaseSummary | null>;
  hasPermission?: SalesPageHasPermission;
  permissions?: SalesPagePermissionNames;
};

type SalesPagePermissionName =
  | "order:read"
  | "order:financial-update"
  | "payment:create"
  | "invoice:create"
  | "credit-note:issue"
  | "refund:issue";

type SalesPagePermissionNames = {
  ORDER_READ: SalesPagePermissionName;
  ORDER_FINANCIAL_UPDATE: SalesPagePermissionName;
  PAYMENT_CREATE: SalesPagePermissionName;
  INVOICE_CREATE: SalesPagePermissionName;
  CREDIT_NOTE_ISSUE: SalesPagePermissionName;
  REFUND_ISSUE: SalesPagePermissionName;
};

type SalesPageHasPermission = (
  actor: { role: ActorContext["actorRole"] },
  permission: SalesPagePermissionName
) => boolean;

type SalesPageResolvedPermissionHelpers = {
  hasPermission: SalesPageHasPermission;
  permissions: SalesPagePermissionNames;
};

const FALLBACK_PERMISSION_NAMES: SalesPagePermissionNames = {
  ORDER_READ: "order:read",
  ORDER_FINANCIAL_UPDATE: "order:financial-update",
  PAYMENT_CREATE: "payment:create",
  INVOICE_CREATE: "invoice:create",
  CREDIT_NOTE_ISSUE: "credit-note:issue",
  REFUND_ISSUE: "refund:issue",
};

export async function getSalesPageView({
  orderId,
  actorContext,
  dependencies,
}: GetSalesPageViewInput): Promise<SalesPageView> {
  const deps = await resolveReadDependencies(dependencies);
  const permissionHelpers = await resolvePermissionHelpers(deps);
  const workspace = await deps.getPOSWorkspace(orderId);
  if (!workspace) {
    throw new Error(`Sales page view failed: order ${orderId} was not found.`);
  }

  const financialCase = await deps.getFinancialCaseSummary({ orderId });
  if (!financialCase) {
    throw new Error(
      `Sales page view failed: FinancialCase summary for order ${orderId} was not found.`
    );
  }

  const currentComposition = await loadCurrentComposition({
    workspace,
    dependencies: deps,
  });
  const draft = await deps.getOrderCommitDraft({ orderId });
  const preview = draft
    ? await deps.getOrderCommitPreview({ orderId })
    : null;
  const composition = toSalesPageComposition({
    draftSnapshot: draft?.pendingSnapshot ?? null,
    currentComposition,
  });
  const stagedChanges = toSalesPageStagedChanges({ preview });
  const financialPreview = toSalesPageFinancialPreview({
    preview,
    financialCase,
  });

  return {
    order: {
      orderId: workspace.orderId,
      jobNumber: workspace.jobNumber,
      orderStatusRaw: workspace.orderStatusRaw,
      selectionStatus: workspace.selectionStatus,
      sessionDate: workspace.sessionDate,
      customerName: workspace.customerName,
      customerPhone: workspace.customerPhone,
      photographerName: workspace.photographerName ?? null,
      invoiceId: workspace.invoice?.invoiceId ?? null,
      invoiceNumber: workspace.invoice?.invoiceNumber ?? null,
    },
    composition,
    draft: draft ? toSalesPageDraftState(draft) : null,
    preview,
    stagedChanges,
    financialPreview,
    financialCase,
    permissions: buildSalesPagePermissionFlags(actorContext, permissionHelpers),
    isLocked:
      financialCase.stage === "active" && financialCase.finalInvoice.isLocked,
  };
}

async function resolveReadDependencies(
  dependencies: Partial<SalesPageViewLoaderDependencies> | undefined
): Promise<SalesPageViewLoaderDependencies> {
  if (hasReadDependencies(dependencies)) {
    return dependencies;
  }

  const [
    orderService,
    compositionService,
    draftProjection,
    orderCommitService,
    previewService,
    financialCaseService,
  ] = await Promise.all([
    import("@/modules/orders/order.service"),
    import("@/modules/orders/composition/order-composition.service"),
    import("@/modules/orders/composition/projections/to-draft-pos-composition"),
    import("../order-commit.service"),
    import("../order-commit-preview.service"),
    import("@/modules/financial-cases/financial-case-summary.service"),
  ]);

  return {
    getPOSWorkspace:
      dependencies?.getPOSWorkspace ?? orderService.getPOSWorkspace,
    getDraftOrderCompositionViewModel:
      dependencies?.getDraftOrderCompositionViewModel ??
      compositionService.getDraftOrderCompositionViewModel,
    getLockedOrderCompositionViewModel:
      dependencies?.getLockedOrderCompositionViewModel ??
      compositionService.getLockedOrderCompositionViewModel,
    toDraftPOSComposition:
      dependencies?.toDraftPOSComposition ?? draftProjection.toDraftPOSComposition,
    getOrderCommitDraft:
      dependencies?.getOrderCommitDraft ?? orderCommitService.getOrderCommitDraft,
    getOrderCommitPreview:
      dependencies?.getOrderCommitPreview ?? previewService.getOrderCommitPreview,
    getFinancialCaseSummary:
      dependencies?.getFinancialCaseSummary ??
      financialCaseService.getFinancialCaseSummary,
    hasPermission: dependencies?.hasPermission,
    permissions: dependencies?.permissions,
  };
}

function hasReadDependencies(
  dependencies: Partial<SalesPageViewLoaderDependencies> | undefined
): dependencies is SalesPageViewLoaderDependencies {
  return Boolean(
    dependencies?.getPOSWorkspace &&
      dependencies.getDraftOrderCompositionViewModel &&
      dependencies.getLockedOrderCompositionViewModel &&
      dependencies.toDraftPOSComposition &&
      dependencies.getOrderCommitDraft &&
      dependencies.getOrderCommitPreview &&
      dependencies.getFinancialCaseSummary
  );
}

async function resolvePermissionHelpers(
  dependencies: Pick<
    SalesPageViewLoaderDependencies,
    "hasPermission" | "permissions"
  >
): Promise<SalesPageResolvedPermissionHelpers> {
  if (dependencies.hasPermission) {
    return {
      hasPermission: dependencies.hasPermission,
      permissions: dependencies.permissions ?? FALLBACK_PERMISSION_NAMES,
    };
  }

  const permissionModule = await import("@/lib/permissions");
  return {
    hasPermission: permissionModule.hasPermission,
    permissions: permissionModule.PERMISSIONS,
  };
}

async function loadCurrentComposition(input: {
  workspace: POSWorkspace;
  dependencies: SalesPageViewLoaderDependencies;
}): Promise<DraftPOSCompositionProjection> {
  if (input.workspace.invoice?.isLocked) {
    const compositionModel =
      await input.dependencies.getLockedOrderCompositionViewModel({
        invoiceId: input.workspace.invoice.invoiceId,
      });
    return input.dependencies.toDraftPOSComposition(compositionModel);
  }

  const compositionModel =
    await input.dependencies.getDraftOrderCompositionViewModel(
      input.workspace.orderId
    );
  if (!compositionModel) {
    throw new Error(
      `Sales page view failed: composition for order ${input.workspace.orderId} was not found.`
    );
  }
  return input.dependencies.toDraftPOSComposition(compositionModel);
}

function toSalesPageDraftState(
  state: OrderCommitDraftState
): SalesPageDraftState {
  return {
    id: state.draft.id,
    version: state.draft.version,
    ownerUserId: state.draft.ownerUserId,
    openedByUserId: state.draft.openedByUserId,
    lastTouchedByUserId: state.draft.lastTouchedByUserId,
    updatedAt: state.draft.updatedAt,
    baseCommitId: state.draft.baseCommitId,
  };
}

function buildSalesPagePermissionFlags(
  actorContext: ActorContext,
  permissionHelpers: SalesPageResolvedPermissionHelpers
): SalesPagePermissionFlags {
  const actor = { role: actorContext.actorRole };
  return {
    actorRole: actorContext.actorRole,
    canReadOrder: permissionHelpers.hasPermission(
      actor,
      permissionHelpers.permissions.ORDER_READ
    ),
    canUpdateOrderFinancial: permissionHelpers.hasPermission(
      actor,
      permissionHelpers.permissions.ORDER_FINANCIAL_UPDATE
    ),
    canCreatePayment: permissionHelpers.hasPermission(
      actor,
      permissionHelpers.permissions.PAYMENT_CREATE
    ),
    canCreateInvoice: permissionHelpers.hasPermission(
      actor,
      permissionHelpers.permissions.INVOICE_CREATE
    ),
    canIssueCreditNote: permissionHelpers.hasPermission(
      actor,
      permissionHelpers.permissions.CREDIT_NOTE_ISSUE
    ),
    canIssueRefund: permissionHelpers.hasPermission(
      actor,
      permissionHelpers.permissions.REFUND_ISSUE
    ),
  };
}
