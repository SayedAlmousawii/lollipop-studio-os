"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  InvoiceType,
  OrderSelectionStatus,
  OrderStatus,
  PaymentType,
} from "@prisma/client";
import { z } from "zod";
import { requireCurrentAppUser } from "@/lib/auth";
import { assertActorPermission } from "@/lib/auth/assert-actor-permission";
import { PERMISSIONS, requireCurrentAppUserPermission } from "@/lib/permissions";
import {
  buildExtraAlbumPageAddOnStagingChange,
  createOrderAlbum,
  getOrderAlbums,
  ORDER_ALBUM_BACKING_LINE_KIND,
  ORDER_ALBUM_SOURCE_TYPE,
  EXTRA_ALBUM_PAGE_PRODUCT_ID,
  rebindOrderAlbumBacking,
  updateOrderAlbumFinishing,
  type UpdateOrderAlbumFinishingInput,
} from "@/modules/albums";
import {
  captureOrderCommitSnapshotFromOrderRows,
  commitOrderChanges,
  discardOrderCommitDraft,
  getOrderCommitDraft,
  getOrCreateOrderCommitDraft,
  stageOrderCommitDraftChange,
  type OrderCommitDraftStagingChange,
} from "@/modules/order-commits";
import {
  OrderCommitDraftMissingError,
  OrderCommitDraftPermissionError,
  OrderCommitDraftStaleVersionError,
} from "@/modules/order-commits/order-commit-draft.errors";
import {
  commitSalesChangesActionWithDependencies,
} from "@/modules/order-commits/sales-commit-actions";
import {
  ORDER_COMMIT_DRAFT_STAGING_DOMAIN,
} from "@/modules/order-commits/order-commit-draft.constants";
import {
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
} from "@/modules/order-commits/order-commit.constants";
import {
  buildSalesSessionConfigurationStagingChange,
  type SalesSessionConfigurationSelectionStagingInput,
  withSalesSessionConfigurationSnapshotTarget,
} from "@/modules/order-commits/sales-session-configuration-staging";
import {
  discardSalesDraftActionWithDependencies,
  stageSalesChangeActionWithDependencies,
} from "@/modules/order-commits/sales-staging-actions";
import {
  getPOSWorkspace,
  OrderAddOnOwnedBySessionConfigurationError,
  recordPOSPaymentForOrder,
} from "@/modules/orders/order.service";
import { recordPaymentSchema } from "@/modules/payments/payment.schema";
import type { POSMutationActionState } from "@/modules/orders/pos-handlers.types";
import { ORDER_EDIT_MODE_MESSAGES } from "@/modules/orders/policies/edit-mode-policy";

export type POSCompositionActionState = POSMutationActionState;
export type POSSessionConfigurationStagingActionState = POSMutationActionState & {
  version?: number;
};
export type SalesAlbumStagingActionState = POSMutationActionState & {
  version?: number;
};

export type POSRecordPaymentActionState = {
  errors?: Partial<Record<string, string[]>>;
  success?: string;
};

export type SalesAlbumFinishingActionState = {
  errors?: Partial<Record<keyof UpdateOrderAlbumFinishingInput | "_global", string[]>>;
  success?: string;
};

const stageAlbumExtraPagesInputSchema = z
  .object({
    albumId: z.string().min(1),
    orderPackageId: z.string().min(1).nullable(),
    sourceType: z.enum([
      ORDER_ALBUM_SOURCE_TYPE.PACKAGE,
      ORDER_ALBUM_SOURCE_TYPE.ADDON,
    ]),
    requestedExtraPages: z.number().int().nonnegative(),
  })
  .strict();

const stageAlbumSizeSwapInputSchema = z
  .object({
    albumId: z.string().min(1),
    orderPackageId: z.string().min(1).nullable(),
    sourceType: z.enum([
      ORDER_ALBUM_SOURCE_TYPE.PACKAGE,
      ORDER_ALBUM_SOURCE_TYPE.ADDON,
    ]),
    backingLineKind: z.enum([
      ORDER_ALBUM_BACKING_LINE_KIND.PACKAGE_ITEM,
      ORDER_ALBUM_BACKING_LINE_KIND.ORDER_PACKAGE_ITEM_UPGRADE,
      ORDER_ALBUM_BACKING_LINE_KIND.ORDER_ADD_ON,
    ]),
    backingLineId: z.string().min(1),
    packageItemId: z.string().min(1).nullable(),
    currentProductId: z.string().min(1).nullable(),
    toProductId: z.string().min(1),
    quantity: z.number().int().positive(),
  })
  .strict();

const addStandaloneAlbumInputSchema = z
  .object({
    productId: z.string().min(1),
  })
  .strict();

export async function stageSalesChangeAction(
  orderId: string,
  expectedVersion: number,
  change: OrderCommitDraftStagingChange
): Promise<POSMutationActionState> {
  return stageSalesChangeActionWithDependencies(orderId, expectedVersion, change, {
    requireOrderFinancialUpdate: () =>
      requireCurrentAppUserPermission(PERMISSIONS.ORDER_FINANCIAL_UPDATE),
    getOrCreateOrderCommitDraft,
    stageOrderCommitDraftChange,
    revalidateSalesPaths: revalidatePOSPaths,
  });
}

export async function stageSessionConfigurationSelectionAction(
  orderId: string,
  expectedVersion: number,
  input: SalesSessionConfigurationSelectionStagingInput
): Promise<POSSessionConfigurationStagingActionState> {
  try {
    const appUser = await requireCurrentAppUserPermission(
      PERMISSIONS.ORDER_FINANCIAL_UPDATE
    );
    const actorContext = {
      actorUserId: appUser.id,
      actorRole: appUser.role,
    };

    const activeDraft = await getOrCreateOrderCommitDraft({ orderId, actorContext });
    const draft = await stageOrderCommitDraftChange({
      orderId,
      expectedVersion,
      change: buildSalesSessionConfigurationStagingChange(
        withSalesSessionConfigurationSnapshotTarget(
          input,
          activeDraft.pendingSnapshot
        )
      ),
      actorContext,
    });

    revalidatePOSPaths(orderId);
    return { kind: "success", version: draft.draft.version };
  } catch (error) {
    return mapSessionConfigurationStagingActionError(error);
  }
}

export async function discardSalesDraftAction(
  orderId: string,
  expectedVersion: number
): Promise<POSMutationActionState> {
  return discardSalesDraftActionWithDependencies(orderId, expectedVersion, {
    requireOrderFinancialUpdate: () =>
      requireCurrentAppUserPermission(PERMISSIONS.ORDER_FINANCIAL_UPDATE),
    discardOrderCommitDraft,
    revalidateSalesPaths: revalidatePOSPaths,
  });
}

export async function updateOrderAlbumFinishingAction(
  orderId: string,
  input: UpdateOrderAlbumFinishingInput
): Promise<SalesAlbumFinishingActionState> {
  try {
    const appUser = await requireCurrentAppUser();
    const actorContext = {
      actorUserId: appUser.id,
      actorRole: appUser.role,
    };
    // Album finishing is operational, but the Sales surface's edit affordance
    // currently uses the same order edit permission as the staging actions.
    assertActorPermission(actorContext, PERMISSIONS.ORDER_FINANCIAL_UPDATE);

    const orderAlbums = await getOrderAlbums({ orderId });
    if (!orderAlbums.some((album) => album.id === input.id)) {
      return { errors: { _global: ["Album does not belong to this order."] } };
    }

    await updateOrderAlbumFinishing(input);
    revalidatePOSPaths(orderId);
    return { success: "Album finishing saved." };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { errors: error.flatten().fieldErrors };
    }

    return { errors: { _global: [posActionErrorMessage(error)] } };
  }
}

export async function stageAlbumExtraPagesAction(
  orderId: string,
  expectedVersion: number,
  input: z.infer<typeof stageAlbumExtraPagesInputSchema>
): Promise<SalesAlbumStagingActionState> {
  try {
    const appUser = await requireCurrentAppUserPermission(
      PERMISSIONS.ORDER_FINANCIAL_UPDATE
    );
    const actorContext = {
      actorUserId: appUser.id,
      actorRole: appUser.role,
    };
    const parsed = stageAlbumExtraPagesInputSchema.parse(input);
    const album = await requireOrderAlbum(orderId, parsed.albumId);
    const snapshot = await getCurrentAlbumStagingSnapshot(orderId);
    const change = buildExtraAlbumPageAddOnStagingChange({
      snapshot,
      orderAlbum: {
        id: album.id,
        orderPackageId: parsed.orderPackageId,
        sourceType: parsed.sourceType,
      },
      requestedExtraPages: parsed.requestedExtraPages,
    });

    if (!change) {
      return { kind: "success", version: expectedVersion };
    }

    await getOrCreateOrderCommitDraft({ orderId, actorContext });
    const staged = await stageOrderCommitDraftChange({
      orderId,
      expectedVersion,
      change,
      actorContext,
    });

    revalidatePOSPaths(orderId);
    return { kind: "success", version: staged.draft.version };
  } catch (error) {
    return mapAlbumStagingActionError(error);
  }
}

export async function stageAlbumSizeSwapAction(
  orderId: string,
  expectedVersion: number,
  input: z.infer<typeof stageAlbumSizeSwapInputSchema>
): Promise<SalesAlbumStagingActionState> {
  try {
    const appUser = await requireCurrentAppUserPermission(
      PERMISSIONS.ORDER_FINANCIAL_UPDATE
    );
    const actorContext = {
      actorUserId: appUser.id,
      actorRole: appUser.role,
    };
    const parsed = stageAlbumSizeSwapInputSchema.parse(input);
    const album = await requireOrderAlbum(orderId, parsed.albumId);

    if (parsed.currentProductId === parsed.toProductId) {
      return { kind: "success", version: expectedVersion };
    }

    if (parsed.sourceType === ORDER_ALBUM_SOURCE_TYPE.PACKAGE) {
      if (!parsed.orderPackageId || !parsed.packageItemId) {
        return {
          kind: "error",
          errors: { _global: ["Package album backing is incomplete."] },
        };
      }

      const draftPackageItemUpgradeId = `draft:${randomUUID()}`;
      await getOrCreateOrderCommitDraft({ orderId, actorContext });
      const staged = await stageOrderCommitDraftChange({
        orderId,
        expectedVersion,
        actorContext,
        change: {
          domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE_ITEM_UPGRADE,
          action: "ADD",
          parentPackageTarget: packageTarget(parsed.orderPackageId),
          packageItemId: parsed.packageItemId,
          toProductId: parsed.toProductId,
          quantity: parsed.quantity,
          draftPackageItemUpgradeId,
        },
      });

      await rebindOrderAlbumBacking({
        id: album.id,
        orderId,
        orderPackageId: parsed.orderPackageId,
        sourceType: ORDER_ALBUM_SOURCE_TYPE.PACKAGE,
        backingLineKind: ORDER_ALBUM_BACKING_LINE_KIND.ORDER_PACKAGE_ITEM_UPGRADE,
        backingLineId: draftPackageItemUpgradeId,
      });

      revalidatePOSPaths(orderId);
      return { kind: "success", version: staged.draft.version };
    }

    await assertStandaloneAlbumProductCanBeUnique(orderId, parsed.toProductId, {
      excludeBackingLineId: parsed.backingLineId,
    });

    await getOrCreateOrderCommitDraft({ orderId, actorContext });
    const removed = await stageOrderCommitDraftChange({
      orderId,
      expectedVersion,
      actorContext,
      change: {
        domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
        action: "REMOVE",
        target: addOnTarget(parsed.backingLineId),
      },
    });
    const draftOrderAddOnId = `draft:${randomUUID()}`;
    const added = await stageOrderCommitDraftChange({
      orderId,
      expectedVersion: removed.draft.version,
      actorContext,
      change: {
        domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
        action: "ADD",
        productId: parsed.toProductId,
        quantity: 1,
        draftOrderAddOnId,
      },
    });

    await rebindOrderAlbumBacking({
      id: album.id,
      orderId,
      orderPackageId: null,
      sourceType: ORDER_ALBUM_SOURCE_TYPE.ADDON,
      backingLineKind: ORDER_ALBUM_BACKING_LINE_KIND.ORDER_ADD_ON,
      backingLineId: draftOrderAddOnId,
    });

    revalidatePOSPaths(orderId);
    return { kind: "success", version: added.draft.version };
  } catch (error) {
    return mapAlbumStagingActionError(error);
  }
}

export async function addStandaloneAlbumAction(
  orderId: string,
  expectedVersion: number,
  input: z.infer<typeof addStandaloneAlbumInputSchema>
): Promise<SalesAlbumStagingActionState> {
  try {
    const appUser = await requireCurrentAppUserPermission(
      PERMISSIONS.ORDER_FINANCIAL_UPDATE
    );
    const actorContext = {
      actorUserId: appUser.id,
      actorRole: appUser.role,
    };
    const parsed = addStandaloneAlbumInputSchema.parse(input);
    await assertStandaloneAlbumProductCanBeUnique(orderId, parsed.productId);

    const draftOrderAddOnId = `draft:${randomUUID()}`;
    await getOrCreateOrderCommitDraft({ orderId, actorContext });
    const staged = await stageOrderCommitDraftChange({
      orderId,
      expectedVersion,
      actorContext,
      change: {
        domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
        action: "ADD",
        productId: parsed.productId,
        quantity: 1,
        draftOrderAddOnId,
      },
    });

    await createOrderAlbum({
      orderId,
      orderPackageId: null,
      sourceType: ORDER_ALBUM_SOURCE_TYPE.ADDON,
      backingLineKind: ORDER_ALBUM_BACKING_LINE_KIND.ORDER_ADD_ON,
      backingLineId: draftOrderAddOnId,
    });

    revalidatePOSPaths(orderId);
    return { kind: "success", version: staged.draft.version };
  } catch (error) {
    return mapAlbumStagingActionError(error);
  }
}

async function requireOrderAlbum(orderId: string, albumId: string) {
  const orderAlbums = await getOrderAlbums({ orderId });
  const album = orderAlbums.find((item) => item.id === albumId);
  if (!album) {
    throw new Error("Album does not belong to this order.");
  }
  return album;
}

async function getCurrentAlbumStagingSnapshot(orderId: string) {
  const draft = await getOrderCommitDraft({ orderId });
  return draft?.pendingSnapshot ?? captureOrderCommitSnapshotFromOrderRows({ orderId });
}

async function assertStandaloneAlbumProductCanBeUnique(
  orderId: string,
  productId: string,
  options: { excludeBackingLineId?: string } = {}
): Promise<void> {
  if (productId === EXTRA_ALBUM_PAGE_PRODUCT_ID) {
    throw new Error("Extra album page cannot be added as a standalone album.");
  }

  const workspace = await getPOSWorkspace(orderId);
  const product = workspace?.addOnCatalog.find((item) => item.id === productId);
  if (!product || product.category !== "ALBUM") {
    throw new Error("Select an active standalone album product.");
  }

  const snapshot = await getCurrentAlbumStagingSnapshot(orderId);
  const duplicate = snapshot.lines.find(
    (line) =>
      line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON &&
      line.parentOrderPackageId === null &&
      line.catalogEntityId === productId &&
      line.orderEntityId !== options.excludeBackingLineId
  );
  if (duplicate) {
    throw new Error(
      "This album product is already on the order. Choose a different album size."
    );
  }
}

function packageTarget(orderPackageId: string) {
  return {
    stableKey: `order-package:${orderPackageId}`,
    orderEntityId: orderPackageId,
  };
}

function addOnTarget(orderAddOnId: string) {
  return {
    stableKey: `order-add-on:${orderAddOnId}`,
    orderEntityId: orderAddOnId,
  };
}

function mapAlbumStagingActionError(error: unknown): SalesAlbumStagingActionState {
  if (error instanceof OrderCommitDraftStaleVersionError) {
    return {
      kind: "error",
      errors: {
        _global: [
          "Draft changed since you opened it. Refresh to see the latest.",
          "draft.stale",
        ],
      },
    };
  }

  if (error instanceof OrderCommitDraftPermissionError) {
    return {
      kind: "error",
      errors: {
        _global: [
          "Another user owns this draft. Refresh or coordinate before editing.",
          "draft.permission",
        ],
      },
    };
  }

  if (error instanceof OrderCommitDraftMissingError) {
    return { kind: "error", errors: { _global: ["draft.missing"] } };
  }

  if (error instanceof z.ZodError) {
    return {
      kind: "error",
      errors: {
        ...error.flatten().fieldErrors,
        _global: ["Invalid album staging payload."],
      },
    };
  }

  return { kind: "error", errors: { _global: [posActionErrorMessage(error)] } };
}

function mapSessionConfigurationStagingActionError(
  error: unknown
): POSSessionConfigurationStagingActionState {
  if (error instanceof OrderCommitDraftStaleVersionError) {
    return {
      kind: "error",
      errors: {
        _global: [
          "Draft changed since you opened it. Refresh to see the latest.",
          "draft.stale",
        ],
      },
    };
  }

  if (error instanceof OrderCommitDraftPermissionError) {
    return {
      kind: "error",
      errors: {
        _global: [
          "Another user owns this draft. Refresh or coordinate before editing.",
          "draft.permission",
        ],
      },
    };
  }

  if (error instanceof OrderCommitDraftMissingError) {
    return { kind: "error", errors: { _global: ["draft.missing"] } };
  }

  if (error instanceof z.ZodError) {
    return {
      kind: "error",
      errors: {
        ...error.flatten().fieldErrors,
        _global: ["Invalid session configuration staging payload."],
      },
    };
  }

  return { kind: "error", errors: { _global: [posActionErrorMessage(error)] } };
}

export async function commitSalesChangesAction(
  orderId: string,
  expectedDraftVersion: number,
  approvalActorUserId?: string
): Promise<POSMutationActionState> {
  return commitSalesChangesActionWithDependencies(
    orderId,
    expectedDraftVersion,
    approvalActorUserId,
    {
      requireOrderFinancialUpdate: () =>
        requireCurrentAppUserPermission(PERMISSIONS.ORDER_FINANCIAL_UPDATE),
      commitOrderChanges,
      revalidateSalesPaths: revalidatePOSPaths,
    }
  );
}

const posPaymentDateTimeSchema = z.object({
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Payment date is required"),
  paidTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Payment time is required"),
});
const posPaymentSelectionSchema = z.object({
  selectionStatus: z.nativeEnum(OrderSelectionStatus, {
    error: "Selection status is required",
  }),
});

export async function recordPOSPaymentAction(
  orderId: string,
  invoiceId: string,
  _prev: POSRecordPaymentActionState,
  formData: FormData
): Promise<POSRecordPaymentActionState> {
  const parsedDateTime = posPaymentDateTimeSchema.safeParse({
    paidDate: formData.get("paidDate"),
    paidTime: formData.get("paidTime"),
  });

  if (!parsedDateTime.success) {
    return { errors: parsedDateTime.error.flatten().fieldErrors };
  }

  const paidAt = combineLocalDateTime(
    parsedDateTime.data.paidDate,
    parsedDateTime.data.paidTime
  );
  if (!paidAt) {
    return { errors: { paidAt: ["Payment date and time are invalid"] } };
  }

  const workspace = await getPOSWorkspace(orderId);
  const invoice = findPOSPayableInvoice(workspace, invoiceId);
  if (!workspace || !invoice) {
    return { errors: { _global: ["No invoice exists for this order."] } };
  }

  const parsed = recordPaymentSchema.safeParse({
    amount: formData.get("amount"),
    method: formData.get("method"),
    paymentType:
      invoice.invoiceType === InvoiceType.ADJUSTMENT
        ? PaymentType.ADJUSTMENT
        : PaymentType.FINAL,
    paidAt,
    reference: formData.get("reference") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  try {
    const appUser = await requireCurrentAppUserPermission(PERMISSIONS.PAYMENT_CREATE);
    if (invoice.remainingAmount <= 0) {
      return { errors: { _global: ["No outstanding balance remains on this invoice."] } };
    }
    if (parsed.data.amount > invoice.remainingAmount) {
      return {
        errors: {
          amount: ["Payment amount cannot exceed the remaining invoice balance."],
        },
      };
    }

    const selectionStatus =
      invoice.invoiceType === InvoiceType.FINAL &&
      workspace.orderStatusRaw === OrderStatus.WAITING_SELECTION
        ? parseRequiredSelectionStatus(formData)
        : undefined;
    if (selectionStatus instanceof Error) {
      return { errors: { selectionStatus: [selectionStatus.message] } };
    }

    await recordPOSPaymentForOrder(orderId, invoiceId, {
      payment: parsed.data,
      selectionStatus,
    }, {
      actorUserId: appUser.id,
      actorRole: appUser.role,
    });
  } catch (error) {
    return { errors: { _global: [posActionErrorMessage(error)] } };
  }

  revalidatePOSPaymentPaths(orderId, invoiceId);
  return { success: "Payment recorded." };
}

function findPOSPayableInvoice(
  workspace: Awaited<ReturnType<typeof getPOSWorkspace>>,
  invoiceId: string
) {
  if (!workspace) return null;
  const invoices = [
    ...(workspace.invoice ? [workspace.invoice] : []),
    ...workspace.adjustmentInvoices,
  ];

  return invoices.find((invoice) => invoice.invoiceId === invoiceId) ?? null;
}

function revalidatePOSPaths(orderId: string): void {
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}/sales`);
  revalidatePath("/invoices");
}

function revalidatePOSPaymentPaths(orderId: string, invoiceId: string): void {
  revalidatePOSPaths(orderId);
  revalidatePath(`/invoices/${invoiceId}`);
}

function combineLocalDateTime(dateValue: string, timeValue: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeValue);
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const monthIndex = Number(dateMatch[2]) - 1;
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const paidAt = new Date(year, monthIndex, day, hour, minute);

  if (
    paidAt.getFullYear() !== year ||
    paidAt.getMonth() !== monthIndex ||
    paidAt.getDate() !== day ||
    paidAt.getHours() !== hour ||
    paidAt.getMinutes() !== minute
  ) {
    return null;
  }

  return paidAt;
}

function parseRequiredSelectionStatus(
  formData: FormData
): OrderSelectionStatus | Error {
  const parsed = posPaymentSelectionSchema.safeParse({
    selectionStatus: formData.get("selectionStatus"),
  });
  if (!parsed.success) {
    return new Error("Selection status is required");
  }

  return parsed.data.selectionStatus;
}

const SAFE_POS_ERROR_MESSAGES = new Set([
  ORDER_EDIT_MODE_MESSAGES.deliveredOrder,
  "Digital and print extra allocations must equal the derived extra-photo count.",
  ORDER_EDIT_MODE_MESSAGES.lockedDirectPOS,
  "Invoice does not belong to this order",
  "Manager permission is required to issue a credit note",
  "Manager permission is required to issue an adjustment invoice",
  "No outstanding balance remains on this invoice",
  "Package item is not part of the current order package",
  "Package line not found on this order",
  "Payment amount cannot exceed the remaining invoice balance",
  "Replacement product is already included",
  "Replacement product is not available",
  "Replacement product must be in the same category",
  "Selected add-on is not on this order",
  "Selected add-on product is not available",
  "Selected package is not available",
  "Selected photos cannot be below included package photos",
  "Use selected photo count for extra photos",
]);

function posActionErrorMessage(error: unknown): string {
  console.error("Unknown POS action error", error);

  if (error instanceof OrderAddOnOwnedBySessionConfigurationError) {
    return error.message;
  }

  if (
    error instanceof Error &&
    SAFE_POS_ERROR_MESSAGES.has(error.message.trim())
  ) {
    return error.message;
  }

  return "Unable to save POS changes";
}
