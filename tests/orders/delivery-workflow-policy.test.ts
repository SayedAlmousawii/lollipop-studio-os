import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  InvoiceStatus,
  InvoiceType,
  OrderDeliveryStatus,
  OrderProductionStatus,
  OrderStatus,
} from "@prisma/client";
import {
  assertDeliveryNotificationReadyPolicy,
  assertDeliveryPickupReadyPolicy,
  assertDeliveryWorkflowWritablePolicy,
  buildDeliveryPaymentSettlementContext,
  buildDeliveryWorkflowPolicy,
  DELIVERY_WORKFLOW_MESSAGES,
  resolveDeliveryPaymentOverridePolicy,
  type BuildDeliveryWorkflowPolicyInput,
  type DeliveryPaymentSettlementContext,
  type DeliveryWorkflowActionKey,
} from "@/modules/orders/policies/delivery-workflow-policy";
import type { FinancialCaseSummary } from "@/modules/financial-cases/financial-case-summary.types";
import { WorkflowGuardError } from "@/modules/orders/order.errors";

const ROOT = process.cwd();

const paidPayment: DeliveryPaymentSettlementContext = {
  status: "PAID",
  label: "Paid",
  settled: true,
  summaryAvailable: true,
};

const baseInput: BuildDeliveryWorkflowPolicyInput = {
  orderStatus: OrderStatus.READY,
  deliveryStatus: OrderDeliveryStatus.READY_FOR_PICKUP,
  productionStatus: OrderProductionStatus.READY_FOR_PICKUP,
  payment: paidPayment,
};

test("R10d delivery policy exposes the existing delivery actions", () => {
  const policy = buildDeliveryWorkflowPolicy(baseInput);

  assert.deepEqual(
    policy.actions.map((item) => item.key),
    [
      "recordCustomerNotification",
      "markPickedUp",
    ] satisfies DeliveryWorkflowActionKey[]
  );
  assert.deepEqual(enabledActions(policy), [
    "recordCustomerNotification",
    "markPickedUp",
  ]);
});

test("R10d delivery policy owns notification and pickup readiness", () => {
  const notReady = buildDeliveryWorkflowPolicy({
    ...baseInput,
    deliveryStatus: OrderDeliveryStatus.NOT_READY,
  });

  assert.deepEqual(enabledActions(notReady), []);
  assert.equal(
    action(notReady, "recordCustomerNotification").blockedReason,
    "PICKUP_NOT_READY"
  );
  assert.deepEqual(
    action(notReady, "recordCustomerNotification").blockerMessages,
    [DELIVERY_WORKFLOW_MESSAGES.notificationReady]
  );
  assert.equal(action(notReady, "markPickedUp").blockedReason, "PICKUP_NOT_READY");

  const notified = buildDeliveryWorkflowPolicy({
    ...baseInput,
    deliveryStatus: OrderDeliveryStatus.CUSTOMER_NOTIFIED,
  });
  assert.deepEqual(enabledActions(notified), ["markPickedUp"]);

  const pickedUp = buildDeliveryWorkflowPolicy({
    ...baseInput,
    deliveryStatus: OrderDeliveryStatus.PICKED_UP,
  });
  assert.deepEqual(enabledActions(pickedUp), ["markPickedUp"]);
});

test("R10d delivery policy represents production readiness blockers", () => {
  const policy = buildDeliveryWorkflowPolicy({
    ...baseInput,
    productionStatus: OrderProductionStatus.IN_PROGRESS,
  });

  assert.equal(action(policy, "markPickedUp").disabled, true);
  assert.equal(action(policy, "markPickedUp").blockedReason, "PRODUCTION_NOT_READY");
  assert.deepEqual(action(policy, "markPickedUp").blockerMessages, [
    DELIVERY_WORKFLOW_MESSAGES.productionReady,
  ]);
  assert.deepEqual(policy.blockers, [
    DELIVERY_WORKFLOW_MESSAGES.productionReady,
  ]);
});

test("R10d delivery policy treats paid and overpaid summaries as settled", () => {
  for (const paymentStatusEnum of ["PAID", "OVERPAID"] as const) {
    const payment = buildDeliveryPaymentSettlementContext(
      activeSummary(paymentStatusEnum)
    );
    const policy = buildDeliveryWorkflowPolicy({ ...baseInput, payment });

    assert.equal(policy.paymentSettled, true, paymentStatusEnum);
    assert.equal(policy.requiresPaymentOverride, false, paymentStatusEnum);
    assert.equal(action(policy, "markPickedUp").available, true, paymentStatusEnum);
  }
});

test("R10d delivery policy requires override for unsettled canonical payment statuses", () => {
  for (const paymentStatusEnum of ["UNPAID", "PARTIAL", "REFUNDED"] as const) {
    const payment = buildDeliveryPaymentSettlementContext(
      activeSummary(paymentStatusEnum)
    );
    const policy = buildDeliveryWorkflowPolicy({ ...baseInput, payment });

    assert.equal(policy.paymentSettled, false, paymentStatusEnum);
    assert.equal(policy.requiresPaymentOverride, true, paymentStatusEnum);
    assert.equal(action(policy, "markPickedUp").available, true, paymentStatusEnum);
    assert.deepEqual(policy.blockers, [
      DELIVERY_WORKFLOW_MESSAGES.paymentOverride,
    ]);
  }
});

test("R10d delivery policy blocks missing or non-active payment summary contexts", () => {
  const cases = [
    buildDeliveryPaymentSettlementContext(null),
    buildDeliveryPaymentSettlementContext({
      stage: "booking",
      financialCaseId: "fc-1",
      bookingId: "booking-1",
      depositInvoice: null,
      depositPaid: true,
      awaitingFinalInvoiceAfterCheckIn: true,
      finalInvoicePending: true,
      linkedDocuments: [],
    }),
  ];

  for (const payment of cases) {
    const policy = buildDeliveryWorkflowPolicy({ ...baseInput, payment });

    assert.equal(payment.summaryAvailable, false);
    assert.equal(policy.requiresPaymentOverride, false);
    assert.equal(action(policy, "markPickedUp").blockedReason, "PAYMENT_SUMMARY_MISSING");
    assert.deepEqual(action(policy, "markPickedUp").blockerMessages, [
      DELIVERY_WORKFLOW_MESSAGES.paymentSummaryMissing,
    ]);
  }
});

test("R10d delivery guard helpers align with service guard messages and codes", () => {
  assert.throws(
    () => assertDeliveryWorkflowWritablePolicy(OrderStatus.CANCELLED),
    { message: DELIVERY_WORKFLOW_MESSAGES.orderCancelled }
  );
  assert.throws(
    () =>
      assertDeliveryNotificationReadyPolicy({
        deliveryStatus: OrderDeliveryStatus.NOT_READY,
      }),
    { message: DELIVERY_WORKFLOW_MESSAGES.notificationReady }
  );
  assert.throws(
    () =>
      assertDeliveryPickupReadyPolicy({
        deliveryStatus: OrderDeliveryStatus.READY_FOR_PICKUP,
        productionStatus: OrderProductionStatus.IN_PROGRESS,
      }),
    { message: DELIVERY_WORKFLOW_MESSAGES.productionReady }
  );

  assertGuardCode(
    () =>
      resolveDeliveryPaymentOverridePolicy({
        payment: buildDeliveryPaymentSettlementContext(null),
        allowPaymentOverride: true,
        overrideReason: "Manager approved release.",
      }),
    "PAYMENT_SUMMARY_MISSING"
  );
  assertGuardCode(
    () =>
      resolveDeliveryPaymentOverridePolicy({
        payment: {
          status: "PARTIAL",
          label: "Partially paid",
          settled: false,
          summaryAvailable: true,
        },
      }),
    "PAYMENT_OVERRIDE_NOT_ALLOWED"
  );
  assertGuardCode(
    () =>
      resolveDeliveryPaymentOverridePolicy({
        payment: {
          status: "PARTIAL",
          label: "Partially paid",
          settled: false,
          summaryAvailable: true,
        },
        allowPaymentOverride: true,
      }),
    "PAYMENT_OVERRIDE_REASON_MISSING"
  );
});

test("R10d delivery form and service consume policy and canonical settlement", () => {
  const componentSource = readFileSync(
    `${ROOT}/src/components/orders/delivery-workflow-form.tsx`,
    "utf8"
  );
  const serviceSource = readFileSync(
    `${ROOT}/src/modules/orders/order.service.ts`,
    "utf8"
  );
  const mapBody = functionBody(
    serviceSource,
    "mapOrderDeliveryWorkflow",
    "buildDeliveryPolicyContext"
  );
  const resolveBody = functionBody(
    serviceSource,
    "resolveDeliveryUpdate",
    "basePaymentSettled"
  );

  assert.match(componentSource, /workflowPolicy\.actions\.map/);
  assert.match(componentSource, /workflowPolicy\.blockers/);
  assert.match(componentSource, /workflowPolicy\.paymentOverride/);
  assert.doesNotMatch(componentSource, /delivery\.completionBlockers/);
  assert.doesNotMatch(componentSource, /delivery\.requiresPaymentOverride/);
  assert.doesNotMatch(componentSource, /delivery\.canRecordNotification/);
  assert.doesNotMatch(componentSource, /delivery\.canMarkPickedUp/);

  assert.match(serviceSource, /getFinancialCaseSummary/);
  assert.match(serviceSource, /buildDeliveryPaymentSettlementContext/);
  assert.match(serviceSource, /buildDeliveryWorkflowPolicy/);
  assert.match(serviceSource, /DELIVERY_WORKFLOW_MESSAGES\.actorMissing/);
  assert.doesNotMatch(mapBody, /summarizeInvoices\(order\.invoices\)/);
  assert.doesNotMatch(resolveBody, /summarizeInvoices\(order\.invoices\)/);
});

function enabledActions(policy: ReturnType<typeof buildDeliveryWorkflowPolicy>) {
  return policy.actions
    .filter((item) => item.available)
    .map((item) => item.key);
}

function action(
  policy: ReturnType<typeof buildDeliveryWorkflowPolicy>,
  key: DeliveryWorkflowActionKey
) {
  const item = policy.actions.find((entry) => entry.key === key);
  assert.ok(item);
  return item;
}

function activeSummary(
  paymentStatusEnum: "UNPAID" | "PARTIAL" | "PAID" | "OVERPAID" | "REFUNDED"
): FinancialCaseSummary {
  return {
    stage: "active",
    financialCaseId: "fc-1",
    orderId: "order-1",
    bookingId: "booking-1",
    depositInvoice: null,
    finalInvoice: {
      id: "invoice-1",
      invoiceNumber: "INV-1",
      invoiceType: InvoiceType.FINAL,
      total: 100,
      remaining: paymentStatusEnum === "PAID" ? 0 : 100,
      status:
        paymentStatusEnum === "PAID" ? InvoiceStatus.PAID : InvoiceStatus.ISSUED,
      isLocked: false,
      depositPaidAmount: 0,
    },
    finalizedAdjustments: [],
    creditNotes: [],
    refunds: [],
    customerTotal: 100,
    effectivePaid: paymentStatusEnum === "UNPAID" ? 0 : 100,
    paidSoFar: paymentStatusEnum === "UNPAID" ? 0 : 100,
    depositApplied: 0,
    remaining: paymentStatusEnum === "PAID" ? 0 : 100,
    totalAdjustments: 0,
    finalTotal: 100,
    overpaymentCapacity: paymentStatusEnum === "OVERPAID" ? 10 : 0,
    creditNoteCapacity: 0,
    linkedDocuments: [],
    paymentStatusEnum,
  };
}

function assertGuardCode(fn: () => unknown, code: string) {
  assert.throws(
    fn,
    (error: unknown) =>
      error instanceof WorkflowGuardError && error.code === code
  );
}

function functionBody(
  source: string,
  functionName: string,
  nextFunctionName: string
): string {
  const start = source.indexOf(`function ${functionName}`);
  const end = source.indexOf(`function ${nextFunctionName}`, start);
  assert.notEqual(start, -1, `${functionName} must exist`);
  assert.notEqual(end, -1, `${nextFunctionName} must follow ${functionName}`);
  return source.slice(start, end);
}
