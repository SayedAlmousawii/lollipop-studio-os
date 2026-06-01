import { z } from "zod";
import {
  ORDER_COMMIT_DRAFT_OPERATION_TYPE,
  ORDER_COMMIT_DRAFT_PENDING_OPS_SCHEMA_VERSION,
} from "./order-commit-draft.constants";

export const orderCommitDraftOperationTypeSchema = z.enum([
  ORDER_COMMIT_DRAFT_OPERATION_TYPE.SNAPSHOT_REPLACED,
  ORDER_COMMIT_DRAFT_OPERATION_TYPE.NOTE_APPENDED,
]);

export const orderCommitDraftOperationV1Schema = z.object({
  id: z.string().min(1),
  type: orderCommitDraftOperationTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime({ offset: true }),
  actorUserId: z.string().min(1),
});

export const orderCommitDraftPendingOpsV1Schema = z.object({
  schemaVersion: z.literal(ORDER_COMMIT_DRAFT_PENDING_OPS_SCHEMA_VERSION),
  operations: z.array(orderCommitDraftOperationV1Schema),
});
