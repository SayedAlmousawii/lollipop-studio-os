import type { z } from "zod";
import type {
  buildExtraAlbumPageAddOnStagingChangeInputSchema,
  createOrderAlbumInputSchema,
  getOrderAlbumsInputSchema,
  orderAlbumBackingLineKindSchema,
  orderAlbumScopeSchema,
  orderAlbumSourceTypeSchema,
  syncOrderAlbumsAfterCommitInputSchema,
  updateOrderAlbumFinishingInputSchema,
} from "./album.schema";

export type OrderAlbumSourceType = z.infer<typeof orderAlbumSourceTypeSchema>;

export type OrderAlbumBackingLineKind = z.infer<
  typeof orderAlbumBackingLineKindSchema
>;

export type GetOrderAlbumsInput = z.infer<typeof getOrderAlbumsInputSchema>;

export type CreateOrderAlbumInput = z.infer<typeof createOrderAlbumInputSchema>;

export type UpdateOrderAlbumFinishingInput = z.infer<
  typeof updateOrderAlbumFinishingInputSchema
>;

export type OrderAlbumScope = z.infer<typeof orderAlbumScopeSchema>;

export type BuildExtraAlbumPageAddOnStagingChangeInput = z.infer<
  typeof buildExtraAlbumPageAddOnStagingChangeInputSchema
>;

export type SyncOrderAlbumsAfterCommitInput = z.infer<
  typeof syncOrderAlbumsAfterCommitInputSchema
>;
