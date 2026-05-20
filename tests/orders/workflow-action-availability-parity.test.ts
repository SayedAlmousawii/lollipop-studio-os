import assert from "node:assert/strict";
import test from "node:test";
import {
  BookingStatus,
  OrderDeliveryStatus,
  OrderEditingStatus,
  OrderProductionSectionStatus,
  OrderProductionStatus,
  OrderSelectionStatus,
  OrderStatus,
} from "@prisma/client";
import { buildBookingWorkflowPolicy } from "@/modules/bookings/booking-workflow-policy";
import { buildDeliveryWorkflowPolicy } from "@/modules/orders/policies/delivery-workflow-policy";
import { buildEditingWorkflowPolicy } from "@/modules/orders/policies/editing-workflow-policy";
import { buildProductionWorkflowPolicy } from "@/modules/orders/policies/production-workflow-policy";

test("workflow action availability stays aligned with the R10 cross-policy baseline", () => {
  assert.deepEqual(
    availability(
      buildBookingWorkflowPolicy({
        status: BookingStatus.CONFIRMED,
        depositPaid: true,
      }).actions
    ),
    {
      record_no_show: true,
      cancel_booking: true,
    }
  );

  assert.deepEqual(
    availability(
      buildEditingWorkflowPolicy({
        orderStatus: OrderStatus.SELECTION_COMPLETED,
        selectionStatus: OrderSelectionStatus.COMPLETED,
        editingStatus: OrderEditingStatus.ASSIGNED,
        assignedEditorId: "editor-1",
        hasEditorOptions: true,
        basePaymentVerified: true,
        hasOutstandingBalance: false,
      }).actions
    ),
    {
      assignEditor: true,
      markStarted: true,
      requestRevision: false,
      markComplete: false,
      markApproved: false,
      sendToProduction: false,
    }
  );

  assert.deepEqual(
    availability(
      buildProductionWorkflowPolicy({
        orderStatus: OrderStatus.PRODUCTION,
        editingStatus: OrderEditingStatus.COMPLETED,
        productionStatus: OrderProductionStatus.IN_PROGRESS,
        deliveryStatus: OrderDeliveryStatus.NOT_READY,
        albumDesignStatus: OrderProductionSectionStatus.NOT_STARTED,
        printingStatus: OrderProductionSectionStatus.NOT_STARTED,
        assemblyStatus: OrderProductionSectionStatus.NOT_STARTED,
        vendorStatus: OrderProductionSectionStatus.NOT_STARTED,
        framedPrintsStatus: OrderProductionSectionStatus.NOT_STARTED,
        finalStatus: OrderProductionSectionStatus.NOT_STARTED,
      }).actions
    ),
    {
      markAlbumDesignStarted: true,
      markAlbumDesignCompleted: false,
      markSentToPrint: true,
      markAssemblyStarted: false,
      markAssemblyCompleted: false,
      markVendorInProgress: true,
      markVendorCompleted: false,
      markPrintsReady: false,
      markProductionReadyForPickup: true,
    }
  );

  assert.deepEqual(
    availability(
      buildDeliveryWorkflowPolicy({
        orderStatus: OrderStatus.READY,
        deliveryStatus: OrderDeliveryStatus.READY_FOR_PICKUP,
        productionStatus: OrderProductionStatus.READY_FOR_PICKUP,
        payment: {
          status: "PAID",
          label: "Paid",
          settled: true,
          summaryAvailable: true,
        },
      }).actions
    ),
    {
      recordCustomerNotification: true,
      markPickedUp: true,
    }
  );
});

function availability(actions: Array<{ key: string; available: boolean }>) {
  return Object.fromEntries(actions.map((action) => [action.key, action.available]));
}
