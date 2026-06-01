import type { ORDER_COMMIT_DRAFT_OPERATION_TYPE } from "./order-commit-draft.constants";
import type { z } from "zod";
import type {
  orderCommitDraftLineTargetSchema,
  orderCommitDraftStagingChangeSchema,
  orderCommitDraftStagingDomainSchema,
  orderCommitDraftStagingHistoryPayloadSchema,
  orderCommitDraftStagingSnapshotReplacementOperationSchema,
} from "./order-commit-draft.schema";
import type { OrderCommitSnapshotV1 } from "./order-commit.types";

export type OrderCommitDraftOperationType =
  (typeof ORDER_COMMIT_DRAFT_OPERATION_TYPE)[keyof typeof ORDER_COMMIT_DRAFT_OPERATION_TYPE];

export type OrderCommitDraftOperationV1 = {
  id: string;
  type: OrderCommitDraftOperationType;
  payload: Record<string, unknown>;
  createdAt: string;
  actorUserId: string;
};

export type OrderCommitDraftPendingOpsV1 = {
  schemaVersion: "order_commit_draft_pending_ops_v1";
  operations: OrderCommitDraftOperationV1[];
};

export type OrderCommitDraftPendingSnapshotV1 = OrderCommitSnapshotV1;

export type OrderCommitDraftStagingDomain = z.infer<
  typeof orderCommitDraftStagingDomainSchema
>;

export type OrderCommitDraftLineTarget = z.infer<
  typeof orderCommitDraftLineTargetSchema
>;

export type OrderCommitDraftStagingChange = z.infer<
  typeof orderCommitDraftStagingChangeSchema
>;

export type OrderCommitDraftStagingHistoryPayload = z.infer<
  typeof orderCommitDraftStagingHistoryPayloadSchema
>;

export type OrderCommitDraftStagingSnapshotReplacementOperation = z.infer<
  typeof orderCommitDraftStagingSnapshotReplacementOperationSchema
>;
