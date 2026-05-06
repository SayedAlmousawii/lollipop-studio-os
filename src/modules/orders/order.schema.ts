import { z } from "zod";
import {
  ORDER_DELIVERY_STATUS_VALUES,
  ORDER_EDITING_STATUS_VALUES,
  ORDER_PRODUCTION_STATUS_VALUES,
  ORDER_SELECTION_STATUS_VALUES,
} from "./order.constants";

export const orderAddOnSchema = z.object({
  optionId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1, "Add-on name is required"),
  price: z.coerce.number().min(0, "Add-on price cannot be negative"),
});

export const updateOrderSchema = z.object({
  finalPackageId: z.string().min(1, "Package is required"),
  selectedPhotos: z.coerce
    .number()
    .int("Selected photos must be a whole number")
    .min(0, "Selected photos cannot be negative"),
  addOns: z.array(orderAddOnSchema),
  notes: z.string().trim().max(1000, "Notes must be 1000 characters or fewer").optional(),
});

export const updateOrderWorkflowSchema = z.object({
  selectionStatus: z.enum(ORDER_SELECTION_STATUS_VALUES).optional(),
  editingStatus: z.enum(ORDER_EDITING_STATUS_VALUES).optional(),
  productionStatus: z.enum(ORDER_PRODUCTION_STATUS_VALUES).optional(),
  deliveryStatus: z.enum(ORDER_DELIVERY_STATUS_VALUES).optional(),
}).refine(
  (value) =>
    value.selectionStatus ||
    value.editingStatus ||
    value.productionStatus ||
    value.deliveryStatus,
  "At least one workflow status is required"
);

export const updateOrderSelectionWorkflowSchema = z.object({
  finalPackageId: z.string().min(1, "Package is required"),
  extraPhotos: z.coerce
    .number()
    .int("Extra photos must be a whole number")
    .min(0, "Extra photos cannot be negative"),
  addOns: z.array(orderAddOnSchema),
  notes: z.string().trim().max(1000, "Notes must be 1000 characters or fewer").optional(),
  completeSelection: z.coerce.boolean().optional(),
});

export const updateOrderEditingWorkflowSchema = z.object({
  action: z.enum([
    "assignEditor",
    "markStarted",
    "requestRevision",
    "markComplete",
    "markApproved",
    "sendToProduction",
  ]),
  assignedEditorId: z.string().trim().min(1, "Editor is required").optional(),
  editedPhotoCount: z.coerce
    .number()
    .int("Edited photo count must be a whole number")
    .min(0, "Edited photo count cannot be negative")
    .optional(),
  estimatedEditingCompletionAt: z.coerce.date().optional(),
});

export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type UpdateOrderWorkflowInput = z.infer<typeof updateOrderWorkflowSchema>;
export type UpdateOrderSelectionWorkflowInput = z.infer<typeof updateOrderSelectionWorkflowSchema>;
export type UpdateOrderEditingWorkflowInput = z.infer<typeof updateOrderEditingWorkflowSchema>;
export type OrderAddOnInput = z.infer<typeof orderAddOnSchema>;
