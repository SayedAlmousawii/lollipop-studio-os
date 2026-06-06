import { z } from "zod";
import {
  ORDER_DELIVERY_STATUS_VALUES,
  ORDER_EDITING_STATUS_VALUES,
  ORDER_PRODUCTION_SECTION_STATUS_VALUES,
  ORDER_PRODUCTION_STATUS_VALUES,
  ORDER_SELECTION_STATUS_VALUES,
} from "./order.constants";

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

export const updateOrderProductionWorkflowSchema = z.object({
  action: z.enum([
    "markAlbumDesignStarted",
    "markAlbumDesignCompleted",
    "markSentToPrint",
    "markAssemblyStarted",
    "markAssemblyCompleted",
    "markVendorInProgress",
    "markVendorCompleted",
    "markPrintsReady",
    "markProductionReadyForPickup",
  ]),
  sectionStatus: z.enum(ORDER_PRODUCTION_SECTION_STATUS_VALUES).optional(),
});

export const updateOrderDeliveryWorkflowSchema = z.object({
  action: z.enum([
    "recordCustomerNotification",
    "markPickedUp",
  ]),
  pickupNotes: z.string().trim().max(1000, "Pickup notes must be 1000 characters or fewer").optional(),
  completedById: z.string().trim().min(1, "Completed by is required").optional(),
  allowPaymentOverride: z.coerce.boolean().optional(),
  overrideReason: z.string().trim().max(500, "Override reason must be 500 characters or fewer").optional(),
});

export type UpdateOrderWorkflowInput = z.infer<typeof updateOrderWorkflowSchema>;
export type UpdateOrderEditingWorkflowInput = z.infer<typeof updateOrderEditingWorkflowSchema>;
export type UpdateOrderProductionWorkflowInput = z.infer<typeof updateOrderProductionWorkflowSchema>;
export type UpdateOrderDeliveryWorkflowInput = z.infer<typeof updateOrderDeliveryWorkflowSchema>;
