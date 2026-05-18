import { z } from "zod";

const editId = z.string().trim().min(1, "Edit id is required");

const sessionConfigurationDesiredSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("toggle") }).strict(),
  z
    .object({
      kind: z.literal("select"),
      optionId: z.string().trim().min(1, "Option is required"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("number"),
      numericValue: z.coerce.number().finite().min(0),
    })
    .strict(),
  z
    .object({
      kind: z.literal("text"),
      textValue: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      kind: z.literal("counter"),
      numericValue: z.coerce.number().finite().min(0),
      optionId: z.string().trim().min(1).optional(),
    })
    .strict(),
]);

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
  z.object({
    id: editId,
    op: z.literal("upgrade_package_item"),
    orderPackageId: z.string().trim().min(1, "Package line is required"),
    packageItemId: z.string().trim().min(1, "Package item is required"),
    toProductId: z.string().trim().min(1, "Replacement product is required"),
    quantity: z.coerce.number().int().positive("Quantity must be at least 1"),
  }),
  z.object({
    id: editId,
    op: z.literal("change_selected_photo_count"),
    orderPackageId: z.string().trim().min(1, "Package line is required"),
    selectedPhotoCount: z.coerce
      .number()
      .int()
      .min(0, "Selected photos cannot be negative"),
    extraDigitalCount: z.coerce
      .number()
      .int()
      .min(0, "Digital extras cannot be negative"),
    extraPrintCount: z.coerce
      .number()
      .int()
      .min(0, "Print extras cannot be negative"),
  }),
  z.object({
    id: editId,
    op: z.literal("change_package_tier"),
    orderPackageId: z.string().trim().min(1, "Package line is required"),
    toPackageRefId: z.string().trim().min(1, "Replacement package is required"),
  }),
  z.object({
    id: editId,
    op: z.literal("change_session_configuration_selection"),
    orderPackageId: z.string().trim().min(1, "Package line is required"),
    configurationId: z.string().trim().min(1, "Configuration is required"),
    desired: z.union([z.null(), sessionConfigurationDesiredSchema]),
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
