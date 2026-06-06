import { z } from "zod";
import {
  ORDER_COMMIT_DRAFT_OPERATION_TYPE,
  ORDER_COMMIT_DRAFT_PENDING_OPS_SCHEMA_VERSION,
  ORDER_COMMIT_DRAFT_STAGING_DOMAIN,
  ORDER_COMMIT_DRAFT_STAGING_HISTORY_SCHEMA_VERSION,
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

export const orderCommitDraftStagingDomainSchema = z.enum([
  ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE,
  ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
  ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE_ITEM_UPGRADE,
  ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PHOTO,
  ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION,
]);

export const orderCommitDraftLineTargetSchema = z
  .object({
    stableKey: z.string().min(1).optional(),
    lineId: z.string().min(1).optional(),
    orderEntityId: z.string().min(1).optional(),
    draftEntityId: z.string().min(1).startsWith("draft:").optional(),
  })
  .strict()
  .refine(
    (target) =>
      Boolean(
        target.stableKey ??
          target.lineId ??
          target.orderEntityId ??
          target.draftEntityId
      ),
    "A staging target must include a stableKey, lineId, orderEntityId, or draftEntityId."
  );

const optionalLineTargetSchema = orderCommitDraftLineTargetSchema.optional();
const nonnegativeIntegerSchema = z.number().int().nonnegative();

const orderCommitDraftPackageStagingChangeSchema = z
  .object({
    domain: z.literal(ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE),
    action: z.literal("CHANGE_PACKAGE"),
    target: orderCommitDraftLineTargetSchema,
    packageId: z.string().min(1),
    packageLabel: z.string().min(1).optional(),
    sessionTypeId: z.string().min(1).optional(),
    intendedPhotoOutcome: z
      .object({
        selectedPhotoCount: nonnegativeIntegerSchema,
        extraDigitalCount: nonnegativeIntegerSchema,
        extraPrintCount: nonnegativeIntegerSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

const orderCommitDraftAddOnStagingChangeSchema = z
  .object({
    domain: z.literal(ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON),
    action: z.enum(["ADD", "UPDATE_QUANTITY", "REMOVE"]),
    target: optionalLineTargetSchema,
    parentPackageTarget: orderCommitDraftLineTargetSchema.optional(),
    productId: z.string().min(1).optional(),
    quantity: nonnegativeIntegerSchema.optional(),
    draftOrderAddOnId: z.string().min(1).startsWith("draft:").optional(),
  })
  .strict();

const orderCommitDraftPackageItemUpgradeStagingChangeSchema = z
  .object({
    domain: z.literal(ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE_ITEM_UPGRADE),
    action: z.enum(["ADD", "UPDATE_QUANTITY", "REMOVE"]),
    target: optionalLineTargetSchema,
    parentPackageTarget: orderCommitDraftLineTargetSchema,
    packageItemId: z.string().min(1).optional(),
    toProductId: z.string().min(1).optional(),
    quantity: nonnegativeIntegerSchema.optional(),
    draftPackageItemUpgradeId: z.string().min(1).startsWith("draft:").optional(),
  })
  .strict();

const orderCommitDraftPhotoStagingChangeSchema = z
  .object({
    domain: z.literal(ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PHOTO),
    action: z.literal("SET_COUNTS"),
    target: orderCommitDraftLineTargetSchema,
    selectedPhotoCount: nonnegativeIntegerSchema,
    extraDigitalCount: nonnegativeIntegerSchema,
    extraPrintCount: nonnegativeIntegerSchema,
  })
  .strict();

const orderCommitDraftSessionConfigurationStagingChangeSchema = z
  .object({
    domain: z.literal(ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION),
    action: z.enum(["UPSERT", "REMOVE"]),
    target: optionalLineTargetSchema,
    parentPackageTarget: orderCommitDraftLineTargetSchema,
    configurationId: z.string().min(1),
    optionId: z.string().min(1).nullable().optional(),
    numericValue: z.string().min(1).nullable().optional(),
    textValue: z.string().min(1).nullable().optional(),
    draftSelectionId: z.string().min(1).startsWith("draft:").optional(),
    linkedProduct: z
      .object({
        productId: z.string().min(1),
        orderAddOnId: z.string().min(1).optional(),
        draftOrderAddOnId: z.string().min(1).startsWith("draft:").optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const orderCommitDraftStagingChangeSchema = z.discriminatedUnion(
  "domain",
  [
    orderCommitDraftPackageStagingChangeSchema,
    orderCommitDraftAddOnStagingChangeSchema,
    orderCommitDraftPackageItemUpgradeStagingChangeSchema,
    orderCommitDraftPhotoStagingChangeSchema,
    orderCommitDraftSessionConfigurationStagingChangeSchema,
  ]
).superRefine((change, context) => {
  if (change.domain === ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON) {
    if (change.action !== "REMOVE" && change.quantity === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quantity"],
        message: "Add-on add/update staging requires quantity.",
      });
    }
    if (change.action === "ADD" && !change.productId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["productId"],
        message: "Add-on add staging requires productId.",
      });
    }
    if (change.action !== "ADD" && !change.target) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["target"],
        message: "Add-on update/remove staging requires a target.",
      });
    }
  }

  if (
    change.domain === ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE_ITEM_UPGRADE
  ) {
    if (change.action !== "REMOVE" && change.quantity === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quantity"],
        message: "Package item upgrade add/update staging requires quantity.",
      });
    }
    if (change.action === "ADD" && !change.packageItemId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["packageItemId"],
        message: "Package item upgrade add staging requires packageItemId.",
      });
    }
    if (change.action === "ADD" && !change.toProductId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toProductId"],
        message: "Package item upgrade add staging requires toProductId.",
      });
    }
    if (change.action !== "ADD" && !change.target) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["target"],
        message: "Package item upgrade update/remove staging requires a target.",
      });
    }
  }

  if (
    change.domain === ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION &&
    change.action === "REMOVE" &&
    !change.target
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["target"],
      message: "Session configuration remove staging requires a target.",
    });
  }

  if (
    change.domain === ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION &&
    change.linkedProduct?.orderAddOnId?.startsWith("draft:")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["linkedProduct", "orderAddOnId"],
      message:
        "Session configuration linkedProduct.orderAddOnId must reference a materialized OrderAddOn id.",
    });
  }
});

export const orderCommitDraftStagingHistoryPayloadSchema = z
  .object({
    schemaVersion: z.literal(
      ORDER_COMMIT_DRAFT_STAGING_HISTORY_SCHEMA_VERSION
    ),
    historyKind: z.literal("STAGING_CHANGE"),
    domain: orderCommitDraftStagingDomainSchema,
    target: optionalLineTargetSchema,
    catalogEntityIds: z.record(z.string(), z.string().min(1)).optional(),
    before: z.record(z.string(), z.unknown()).optional(),
    after: z.record(z.string(), z.unknown()).optional(),
    stagedAt: z.string().datetime({ offset: true }),
    actorUserId: z.string().min(1),
    change: orderCommitDraftStagingChangeSchema,
  })
  .strict()
  .refine(
    (payload) => payload.domain === payload.change.domain,
    "History payload domain must match the staging change domain."
  );

export const orderCommitDraftStagingSnapshotReplacementOperationSchema =
  orderCommitDraftOperationV1Schema.extend({
    type: z.literal(ORDER_COMMIT_DRAFT_OPERATION_TYPE.SNAPSHOT_REPLACED),
    payload: orderCommitDraftStagingHistoryPayloadSchema,
  });
