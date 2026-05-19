import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BookingStatus } from "@prisma/client";
import {
  assertBookingStatusTransitionAllowed,
  BOOKING_WORKFLOW_MESSAGES,
  buildBookingWorkflowPolicy,
  bookingStatusTransitionErrorMessage,
} from "@/modules/bookings/booking-workflow-policy";

const ROOT = process.cwd();

test("R10a booking policy exposes pending empty states without status actions", () => {
  const unpaid = buildBookingWorkflowPolicy({
    status: BookingStatus.PENDING,
    depositPaid: false,
  });
  const paid = buildBookingWorkflowPolicy({
    status: BookingStatus.PENDING,
    depositPaid: true,
  });

  assert.deepEqual(unpaid.actions, []);
  assert.deepEqual(paid.actions, []);
  assert.equal(
    unpaid.emptyStateMessage,
    BOOKING_WORKFLOW_MESSAGES.pendingDepositRequired
  );
  assert.equal(
    paid.emptyStateMessage,
    BOOKING_WORKFLOW_MESSAGES.pendingConfirmationHandledByDeposit
  );
});

test("R10a booking policy exposes destructive confirmed booking status actions", () => {
  const policy = buildBookingWorkflowPolicy({
    status: BookingStatus.CONFIRMED,
    depositPaid: true,
  });

  assert.deepEqual(
    policy.actions.map((action) => action.key),
    ["record_no_show", "cancel_booking"]
  );
  assert.deepEqual(
    policy.actions.map((action) => action.nextStatus),
    [BookingStatus.NO_SHOW, BookingStatus.CANCELLED]
  );
  assert.deepEqual(
    policy.actions.map((action) => action.intent),
    ["destructive", "destructive"]
  );
  assert.deepEqual(
    policy.actions.map((action) => action.confirmationMessage),
    [
      BOOKING_WORKFLOW_MESSAGES.noShowConfirmation,
      BOOKING_WORKFLOW_MESSAGES.cancelConfirmation,
    ]
  );
});

test("R10a booking policy exposes terminal empty states", () => {
  const cases = [
    [BookingStatus.CHECKED_IN, BOOKING_WORKFLOW_MESSAGES.checkedIn],
    [BookingStatus.CANCELLED, BOOKING_WORKFLOW_MESSAGES.cancelled],
    [BookingStatus.NO_SHOW, BOOKING_WORKFLOW_MESSAGES.noShow],
  ] as const;

  for (const [status, message] of cases) {
    const policy = buildBookingWorkflowPolicy({
      status,
      depositPaid: true,
    });

    assert.deepEqual(policy.actions, []);
    assert.deepEqual(policy.blockers, [message]);
    assert.equal(policy.emptyStateMessage, message);
  }
});

test("R10a booking transition guard matches updateBookingStatus invalid-transition behavior", () => {
  const invalidPairs = [
    [BookingStatus.PENDING, BookingStatus.CANCELLED],
    [BookingStatus.PENDING, BookingStatus.NO_SHOW],
    [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN],
    [BookingStatus.CHECKED_IN, BookingStatus.CANCELLED],
    [BookingStatus.CANCELLED, BookingStatus.CONFIRMED],
    [BookingStatus.NO_SHOW, BookingStatus.CANCELLED],
  ] as const;

  for (const [currentStatus, nextStatus] of invalidPairs) {
    assert.throws(
      () => assertBookingStatusTransitionAllowed(currentStatus, nextStatus),
      {
        message: bookingStatusTransitionErrorMessage(currentStatus, nextStatus),
      }
    );
  }
});

test("R10a BookingStatusActions renders from policy instead of local action maps", () => {
  const componentSource = readFileSync(
    `${ROOT}/src/components/bookings/booking-status-actions.tsx`,
    "utf8"
  );
  const serviceSource = readFileSync(
    `${ROOT}/src/modules/bookings/booking.service.ts`,
    "utf8"
  );

  assert.doesNotMatch(componentSource, /STATUS_ACTIONS/);
  assert.doesNotMatch(componentSource, /nextStatus === ["']CONFIRMED["']/);
  assert.match(componentSource, /policy\.actions/);
  assert.match(serviceSource, /assertBookingStatusTransitionAllowed/);
});
