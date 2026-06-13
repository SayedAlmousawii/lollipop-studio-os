import { z } from "zod";
import {
  ORDER_ALBUM_BACKING_LINE_KIND,
  ORDER_ALBUM_SOURCE_TYPE,
} from "./album.constants";
import { orderCommitSnapshotV1Schema } from "@/modules/order-commits/order-commit.schema";

export const orderAlbumSourceTypeSchema = z.enum([
  ORDER_ALBUM_SOURCE_TYPE.PACKAGE,
  ORDER_ALBUM_SOURCE_TYPE.ADDON,
]);

export const orderAlbumBackingLineKindSchema = z.enum([
  ORDER_ALBUM_BACKING_LINE_KIND.PACKAGE_ITEM,
  ORDER_ALBUM_BACKING_LINE_KIND.ORDER_PACKAGE_ITEM_UPGRADE,
  ORDER_ALBUM_BACKING_LINE_KIND.ORDER_ADD_ON,
]);

const nullableTextSchema = z.string().trim().min(1).nullable().optional();
const nullableIdSchema = z.string().min(1).nullable().optional();

export const getOrderAlbumsInputSchema = z
  .object({
    orderId: z.string().min(1),
  })
  .strict();

export const createOrderAlbumInputSchema = z
  .object({
    orderId: z.string().min(1),
    orderPackageId: nullableIdSchema,
    sourceType: orderAlbumSourceTypeSchema,
    backingLineKind: orderAlbumBackingLineKindSchema,
    backingLineId: z.string().min(1),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.sourceType === ORDER_ALBUM_SOURCE_TYPE.PACKAGE &&
      !input.orderPackageId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["orderPackageId"],
        message: "Package albums require orderPackageId.",
      });
    }
    if (
      input.sourceType === ORDER_ALBUM_SOURCE_TYPE.ADDON &&
      input.orderPackageId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["orderPackageId"],
        message: "Standalone add-on albums must not include orderPackageId.",
      });
    }
  });

export const updateOrderAlbumFinishingInputSchema = z
  .object({
    id: z.string().min(1),
    coverMaterial: nullableTextSchema,
    threadColor: nullableTextSchema,
    layout: nullableTextSchema,
    coverText: nullableTextSchema,
    coverImageRef: nullableTextSchema,
    instructions: nullableTextSchema,
  })
  .strict();

export const rebindOrderAlbumBackingInputSchema = z
  .object({
    id: z.string().min(1),
    orderId: z.string().min(1),
    orderPackageId: nullableIdSchema,
    sourceType: orderAlbumSourceTypeSchema,
    backingLineKind: orderAlbumBackingLineKindSchema,
    backingLineId: z.string().min(1),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.sourceType === ORDER_ALBUM_SOURCE_TYPE.PACKAGE &&
      !input.orderPackageId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["orderPackageId"],
        message: "Package albums require orderPackageId.",
      });
    }
    if (
      input.sourceType === ORDER_ALBUM_SOURCE_TYPE.ADDON &&
      input.orderPackageId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["orderPackageId"],
        message: "Standalone add-on albums must not include orderPackageId.",
      });
    }
  });

export const orderAlbumScopeSchema = z
  .object({
    id: z.string().min(1).optional(),
    orderPackageId: z.string().min(1).nullable(),
    sourceType: orderAlbumSourceTypeSchema,
  })
  .strict();

export const buildExtraAlbumPageAddOnStagingChangeInputSchema = z
  .object({
    snapshot: orderCommitSnapshotV1Schema,
    orderAlbum: orderAlbumScopeSchema,
    requestedExtraPages: z.number().int().nonnegative(),
  })
  .strict();

export const syncOrderAlbumsAfterCommitInputSchema = z
  .object({
    orderId: z.string().min(1),
    committedSnapshot: orderCommitSnapshotV1Schema,
    draftToOrderEntityEntries: z.array(
      z.tuple([z.string().min(1).startsWith("draft:"), z.string().min(1)])
    ),
  })
  .strict();
