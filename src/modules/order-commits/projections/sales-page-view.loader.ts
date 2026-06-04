import type { ActorContext } from "@/lib/auth/actor-context";
import type { FinancialCaseSummary } from "@/modules/financial-cases/financial-case-summary.types";
import type { OrderCompositionViewModel } from "@/modules/orders/composition/order-composition.types";
import type {
  DraftPOSCompositionProjection,
  POSCompositionPackageItemProjection,
} from "@/modules/orders/composition/projections/to-draft-pos-composition";
import type { POSWorkspace } from "@/modules/orders/order.types";
import type { PackageWithItems } from "@/modules/packages/package.types";
import type { OrderCommitDraftState } from "../order-commit.service";
import type { OrderCommitPreview } from "../order-commit-preview.types";
import {
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
} from "../order-commit.constants";
import type { OrderCommitSnapshotV1 } from "../order-commit.types";
import { toSalesPageComposition } from "./to-sales-page-composition";
import { toSalesPageFinancialPreview } from "./to-sales-page-financial-preview";
import { toSalesPageStagedChanges } from "./to-sales-page-staged-changes";
import type {
  SalesPageDraftState,
  SalesPageDraftOwnership,
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
  getPackageWithItems: (id: string) => Promise<PackageWithItems | null>;
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
  const draftState = draft ? toSalesPageDraftState(draft) : null;
  const preview = draft
    ? await deps.getOrderCommitPreview({ orderId })
    : null;
  const catalogPackageItemsByPackageId =
    await loadCatalogPackageItemsByPackageId({
      draftSnapshot: draft?.pendingSnapshot ?? null,
      currentComposition,
      dependencies: deps,
    });
  const composition = toSalesPageComposition({
    draftSnapshot: draft?.pendingSnapshot ?? null,
    currentComposition,
    catalogPackageItemsByPackageId,
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
    draft: draftState,
    preview,
    stagedChanges,
    financialPreview,
    financialCase,
    permissions: buildSalesPagePermissionFlags(actorContext, permissionHelpers),
    ownership: buildSalesPageDraftOwnership({
      draft: draftState,
      actorContext,
    }),
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
    packageService,
  ] = await Promise.all([
    import("@/modules/orders/order.service"),
    import("@/modules/orders/composition/order-composition.service"),
    import("@/modules/orders/composition/projections/to-draft-pos-composition"),
    import("../order-commit.service"),
    import("../order-commit-preview.service"),
    import("@/modules/financial-cases/financial-case-summary.service"),
    import("@/modules/packages/package.service"),
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
    getPackageWithItems:
      dependencies?.getPackageWithItems ?? packageService.getPackageWithItems,
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
      dependencies.getFinancialCaseSummary &&
      dependencies.getPackageWithItems
  );
}

async function loadCatalogPackageItemsByPackageId(input: {
  draftSnapshot: OrderCommitSnapshotV1 | null;
  currentComposition: DraftPOSCompositionProjection;
  dependencies: SalesPageViewLoaderDependencies;
}): Promise<ReadonlyMap<string, POSCompositionPackageItemProjection[]>> {
  const packageIds = packageIdsForCatalogItemLookup({
    draftSnapshot: input.draftSnapshot,
    currentComposition: input.currentComposition,
  });

  const entries = await Promise.all(
    [...packageIds].map(async (packageId) => {
      const packageRow = await input.dependencies.getPackageWithItems(packageId);
      return [packageId, mapCatalogPackageItems(packageRow)] as const;
    })
  );

  return new Map(entries);
}

function packageIdsForCatalogItemLookup(input: {
  draftSnapshot: OrderCommitSnapshotV1 | null;
  currentComposition: DraftPOSCompositionProjection;
}): Set<string> {
  const packageIds = new Set<string>();

  if (input.draftSnapshot) {
    for (const line of input.draftSnapshot.lines) {
      if (
        line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE &&
        line.catalogEntityId
      ) {
        packageIds.add(line.catalogEntityId);
      }
    }
    return packageIds;
  }

  if (input.currentComposition.sourceState === "locked") {
    for (const line of input.currentComposition.packageLines) {
      packageIds.add(line.packageId);
    }
  }

  return packageIds;
}

function mapCatalogPackageItems(
  packageRow: PackageWithItems | null
): POSCompositionPackageItemProjection[] {
  return (packageRow?.items ?? []).map((item) => ({
    id: item.id,
    productId: item.productId,
    productName: item.productName,
    category: item.productCategory,
    quantity: item.quantity,
    unitAmount: item.priceSnapshotValue,
    totalAmount: item.lineTotalValue,
  }));
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

export function buildSalesPageDraftOwnership(input: {
  draft: SalesPageDraftState | null;
  actorContext: ActorContext;
}): SalesPageDraftOwnership {
  if (!input.draft) {
    return {
      mode: "none",
      hasDraft: false,
      isOwner: false,
      isManagerOverride: false,
      canStage: true,
      canDiscard: false,
      canCommit: false,
      ownerUserId: null,
      openedByUserId: null,
      lastTouchedByUserId: null,
      updatedAt: null,
      banner: null,
    };
  }

  const isOwner = input.draft.ownerUserId === input.actorContext.actorUserId;
  const isManagerOverride =
    !isOwner &&
    (input.actorContext.actorRole === "ADMIN" ||
      input.actorContext.actorRole === "MANAGER");
  if (isOwner) {
    return {
      mode: "owner",
      hasDraft: true,
      isOwner: true,
      isManagerOverride: false,
      canStage: true,
      canDiscard: true,
      canCommit: true,
      ownerUserId: input.draft.ownerUserId,
      openedByUserId: input.draft.openedByUserId,
      lastTouchedByUserId: input.draft.lastTouchedByUserId,
      updatedAt: input.draft.updatedAt,
      banner: {
        tone: "neutral",
        title: "Draft open",
        description: `You own this draft. Last touched by ${input.draft.lastTouchedByUserId}.`,
      },
    };
  }

  if (isManagerOverride) {
    return {
      mode: "manager_override",
      hasDraft: true,
      isOwner: false,
      isManagerOverride: true,
      canStage: true,
      canDiscard: true,
      canCommit: true,
      ownerUserId: input.draft.ownerUserId,
      openedByUserId: input.draft.openedByUserId,
      lastTouchedByUserId: input.draft.lastTouchedByUserId,
      updatedAt: input.draft.updatedAt,
      banner: {
        tone: "info",
        title: "Manager override draft access",
        description: `Draft owned by ${input.draft.ownerUserId}; last touched by ${input.draft.lastTouchedByUserId}. Continuing does not transfer ownership.`,
      },
    };
  }

  return {
    mode: "blocked_non_owner",
    hasDraft: true,
    isOwner: false,
    isManagerOverride: false,
    canStage: false,
    canDiscard: false,
    canCommit: false,
    ownerUserId: input.draft.ownerUserId,
    openedByUserId: input.draft.openedByUserId,
    lastTouchedByUserId: input.draft.lastTouchedByUserId,
    updatedAt: input.draft.updatedAt,
    banner: {
      tone: "warning",
      title: "Draft owned by another user",
      description: `Draft owned by ${input.draft.ownerUserId}; last touched by ${input.draft.lastTouchedByUserId}. Refresh or coordinate before editing.`,
    },
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
