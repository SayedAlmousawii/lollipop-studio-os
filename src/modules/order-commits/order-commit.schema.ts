import { z } from "zod";
import {
  ORDER_COMMIT_DOCUMENT_ROLE,
  ORDER_COMMIT_KIND,
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_CURRENCY,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
  ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
  ORDER_COMMIT_STATUS,
} from "./order-commit.constants";

const rawMoneySchema = z.number().finite();

export const orderCommitKindSchema = z.enum([
  ORDER_COMMIT_KIND.BASELINE,
]);

export const orderCommitStatusSchema = z.enum([
  ORDER_COMMIT_STATUS.COMMITTED,
]);

export const orderCommitDocumentRoleSchema = z.enum([
  ORDER_COMMIT_DOCUMENT_ROLE.BASE_INVOICE,
  ORDER_COMMIT_DOCUMENT_ROLE.ADJUSTMENT_INVOICE,
  ORDER_COMMIT_DOCUMENT_ROLE.CREDIT_NOTE,
]);

export const orderCommitMetadataSchema = z.record(z.string(), z.unknown());

export const orderCommitSnapshotLineKindSchema = z.enum([
  ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND.SELECTED_PHOTO_EXTRA,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND.LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON,
]);

export const orderCommitOrderEntityKindSchema = z.enum([
  ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE,
  ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_ADD_ON,
  ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_ITEM_UPGRADE,
  ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_PHOTO_EXTRA,
  ORDER_COMMIT_ORDER_ENTITY_KIND
    .ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
]);

export const orderCommitPriceSourceSchema = z.enum([
  ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
  ORDER_COMMIT_PRICE_SOURCE.SESSION_TYPE_EXTRA_PHOTO_PRICING,
  ORDER_COMMIT_PRICE_SOURCE.SESSION_CONFIGURATION_SELECTION_SNAPSHOT,
]);

export const orderCommitSnapshotMoneyTotalsSchema = z.object({
  subtotal: rawMoneySchema,
  discountTotal: rawMoneySchema,
  netTotal: rawMoneySchema,
});

export const orderCommitSnapshotLineV1Schema = z.object({
  lineId: z.string().min(1),
  lineKind: orderCommitSnapshotLineKindSchema,
  orderEntityKind: orderCommitOrderEntityKindSchema,
  orderEntityId: z.string().min(1),
  parentOrderPackageId: z.string().min(1).nullable(),
  catalogEntityId: z.string().min(1).nullable(),
  stableKey: z.string().min(1),
  label: z.string().min(1),
  quantity: z.number().int().nonnegative(),
  unitPrice: rawMoneySchema,
  lineTotal: rawMoneySchema,
  priceSource: orderCommitPriceSourceSchema,
  metadata: z.record(z.string(), z.unknown()),
});

export const orderCommitSnapshotV1Schema = z.object({
  schemaVersion: z.literal(ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION),
  orderId: z.string().min(1),
  financialCaseId: z.string().min(1),
  capturedAt: z.string().datetime({ offset: true }),
  currency: z.literal(ORDER_COMMIT_SNAPSHOT_CURRENCY),
  lines: z.array(orderCommitSnapshotLineV1Schema),
  totals: orderCommitSnapshotMoneyTotalsSchema,
});
