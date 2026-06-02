import type { UserRole } from "@prisma/client";
import type { POSMutationActionState } from "@/modules/orders/pos-handlers.types";
import {
  OrderCommitApprovalRequiredError,
  OrderCommitConcurrentCommitError,
  OrderCommitCreditCapacityExhaustedError,
  OrderCommitStaleDraftError,
  type commitOrderChanges,
} from "./order-commit-execution.service";

type SalesCommitActionUser = {
  id: string;
  role: UserRole;
};

export type SalesCommitActionDependencies = {
  requireOrderFinancialUpdate: () => Promise<SalesCommitActionUser>;
  commitOrderChanges: typeof commitOrderChanges;
  revalidateSalesPaths: (orderId: string) => void;
};

export async function commitSalesChangesActionWithDependencies(
  orderId: string,
  expectedDraftVersion: number,
  approvalActorUserId: string | undefined,
  dependencies: SalesCommitActionDependencies
): Promise<POSMutationActionState> {
  try {
    const appUser = await dependencies.requireOrderFinancialUpdate();
    await dependencies.commitOrderChanges({
      orderId,
      expectedDraftVersion,
      approvalActorUserId,
      actorContext: {
        actorUserId: appUser.id,
        actorRole: appUser.role,
      },
    });
  } catch (error) {
    return mapSalesCommitActionError(error);
  }

  dependencies.revalidateSalesPaths(orderId);
  return { kind: "success" };
}

export function mapSalesCommitActionError(
  error: unknown
): POSMutationActionState {
  if (error instanceof OrderCommitStaleDraftError) {
    return {
      kind: "error",
      errors: {
        _global: [
          "Draft changed since you opened it. Refresh to see the latest.",
          "commit.stale",
        ],
      },
    };
  }

  if (error instanceof OrderCommitConcurrentCommitError) {
    return {
      kind: "error",
      errors: {
        _global: [
          "Another commit just landed. Refresh and try again.",
          "commit.concurrent",
        ],
      },
    };
  }

  if (error instanceof OrderCommitApprovalRequiredError) {
    return {
      kind: "approval-required",
      errors: {
        approvalActorUserId: ["Manager/admin user ID is required."],
        _global: ["commit.approvalRequired"],
      },
    };
  }

  if (error instanceof OrderCommitCreditCapacityExhaustedError) {
    const expected = error.payload.expectedFinalCreditTotal.toFixed(3);
    const capacity = error.payload.currentCapacity.toFixed(3);
    return {
      kind: "error",
      errors: {
        _global: [
          `Credit/refund capacity changed. Refresh and review this order before committing. Expected ${expected} KWD but only ${capacity} KWD is currently available.`,
          "commit.creditCapacity",
        ],
      },
    };
  }

  throw error;
}
