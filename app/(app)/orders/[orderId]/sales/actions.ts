"use server";

import { revalidatePath } from "next/cache";
import {
  InvoiceType,
  OrderSelectionStatus,
  OrderStatus,
  PaymentType,
} from "@prisma/client";
import { z } from "zod";
import { PERMISSIONS, requireCurrentAppUserPermission } from "@/lib/permissions";
import {
  commitOrderChanges,
  discardOrderCommitDraft,
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

export type POSRecordPaymentActionState = {
  errors?: Partial<Record<string, string[]>>;
  success?: string;
};

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
