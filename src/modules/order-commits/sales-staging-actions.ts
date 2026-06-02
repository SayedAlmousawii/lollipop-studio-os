import type { UserRole } from "@prisma/client";
import { z } from "zod";
import type { POSMutationActionState } from "@/modules/orders/pos-handlers.types";
import {
  OrderCommitDraftMissingError,
  OrderCommitDraftPermissionError,
  OrderCommitDraftStaleVersionError,
} from "./order-commit-draft.errors";
import type { OrderCommitDraftStagingChange } from "./order-commit-draft.types";
import type {
  discardOrderCommitDraft,
  getOrCreateOrderCommitDraft,
  stageOrderCommitDraftChange,
} from "./order-commit.service";

type SalesDraftActionUser = {
  id: string;
  role: UserRole;
};

export type SalesDraftActionDependencies = {
  requireOrderFinancialUpdate: () => Promise<SalesDraftActionUser>;
  getOrCreateOrderCommitDraft: typeof getOrCreateOrderCommitDraft;
  stageOrderCommitDraftChange: typeof stageOrderCommitDraftChange;
  discardOrderCommitDraft: typeof discardOrderCommitDraft;
  revalidateSalesPaths: (orderId: string) => void;
};

export async function stageSalesChangeActionWithDependencies(
  orderId: string,
  expectedVersion: number,
  change: OrderCommitDraftStagingChange,
  dependencies: SalesDraftActionDependencies
): Promise<POSMutationActionState> {
  try {
    const appUser = await dependencies.requireOrderFinancialUpdate();
    const actorContext = {
      actorUserId: appUser.id,
      actorRole: appUser.role,
    };

    await dependencies.getOrCreateOrderCommitDraft({
      orderId,
      actorContext,
    });
    await dependencies.stageOrderCommitDraftChange({
      orderId,
      expectedVersion,
      change,
      actorContext,
    });
  } catch (error) {
    return mapSalesDraftActionError(error);
  }

  dependencies.revalidateSalesPaths(orderId);
  return { kind: "success" };
}

export async function discardSalesDraftActionWithDependencies(
  orderId: string,
  expectedVersion: number,
  dependencies: SalesDraftActionDependencies
): Promise<POSMutationActionState> {
  try {
    const appUser = await dependencies.requireOrderFinancialUpdate();
    await dependencies.discardOrderCommitDraft({
      orderId,
      expectedVersion,
      actorContext: {
        actorUserId: appUser.id,
        actorRole: appUser.role,
      },
    });
  } catch (error) {
    return mapSalesDraftActionError(error);
  }

  dependencies.revalidateSalesPaths(orderId);
  return { kind: "success" };
}

function mapSalesDraftActionError(error: unknown): POSMutationActionState {
  if (error instanceof OrderCommitDraftStaleVersionError) {
    return { kind: "error", errors: { _global: ["draft.stale"] } };
  }

  if (error instanceof OrderCommitDraftPermissionError) {
    return { kind: "error", errors: { _global: ["draft.permission"] } };
  }

  if (error instanceof OrderCommitDraftMissingError) {
    return { kind: "error", errors: { _global: ["draft.missing"] } };
  }

  if (error instanceof z.ZodError) {
    const fieldErrors = error.flatten().fieldErrors;
    return {
      kind: "error",
      errors:
        Object.keys(fieldErrors).length > 0
          ? fieldErrors
          : { _global: ["draft.validation"] },
    };
  }

  throw error;
}
