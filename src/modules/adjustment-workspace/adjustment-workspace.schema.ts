import { z } from "zod";

const editId = z.string().trim().min(1, "Edit id is required");

export const adjustmentWorkspaceEditSchema = z.discriminatedUnion("op", [
  z.object({
    id: editId,
    op: z.literal("add_line"),
    kind: z.enum(["item", "addon"]),
    refId: z.string().trim().min(1, "Catalog item is required"),
    quantity: z.coerce.number().int().positive("Quantity must be at least 1"),
  }),
  z.object({
    id: editId,
    op: z.literal("remove_line"),
    targetLineId: z.string().trim().min(1, "Line is required"),
  }),
  z.object({
    id: editId,
    op: z.literal("modify_quantity"),
    targetLineId: z.string().trim().min(1, "Line is required"),
    newQuantity: z.coerce.number().int().min(0, "Quantity cannot be negative"),
  }),
  z.object({
    id: editId,
    op: z.literal("swap_package"),
    fromPackageRefId: z.string().trim().min(1, "Current package is required"),
    toPackageRefId: z.string().trim().min(1, "Replacement package is required"),
  }),
  z.object({
    id: editId,
    op: z.literal("swap_addon"),
    targetLineId: z.string().trim().min(1, "Line is required"),
    toAddonRefId: z.string().trim().min(1, "Replacement add-on is required"),
  }),
]);

export const adjustmentPendingChangesSchema = z.object({
  edits: z.array(adjustmentWorkspaceEditSchema),
});

export const adjustmentWorkspaceVersionSchema = z.object({
  version: z.coerce.number().int().min(0, "Workspace version is required"),
});

export const finalizeWorkspaceSchema = adjustmentWorkspaceVersionSchema.extend({
  managerApprovedReductionByUserId: z.string().trim().optional(),
  managerApprovedReason: z.string().trim().max(500).optional(),
});

export type AdjustmentWorkspaceEditInput = z.infer<
  typeof adjustmentWorkspaceEditSchema
>;
