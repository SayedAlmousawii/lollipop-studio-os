import { BookingStatus } from "@prisma/client";

export type WorkflowActionIntent =
  | "primary"
  | "secondary"
  | "warning"
  | "destructive";

export type BookingWorkflowActionKey =
  | "record_no_show"
  | "cancel_booking";

export type BookingWorkflowBlockedReason =
  | "CONFIRMATION_HANDLED_BY_DEPOSIT"
  | "BOOKING_ALREADY_CHECKED_IN"
  | "BOOKING_CANCELLED"
  | "BOOKING_NO_SHOW"
  | "NO_STATUS_ACTIONS";

export type BookingWorkflowAction = {
  key: BookingWorkflowActionKey;
  label: string;
  nextStatus: BookingStatus;
  intent: WorkflowActionIntent;
  available: boolean;
  disabled: boolean;
  blockedReason: string | null;
  confirmationMessage: string | null;
};

export type BookingWorkflowPolicy = {
  status: BookingStatus;
  actions: BookingWorkflowAction[];
  blockers: string[];
  emptyStateMessage: string | null;
};

export type BuildBookingWorkflowPolicyInput = {
  status: BookingStatus;
  depositPaid: boolean;
};

export const BOOKING_STATUS_TRANSITIONS: Record<
  BookingStatus,
  readonly BookingStatus[]
> = {
  [BookingStatus.PENDING]: [BookingStatus.CONFIRMED],
  [BookingStatus.CONFIRMED]: [BookingStatus.CANCELLED, BookingStatus.NO_SHOW],
  [BookingStatus.CHECKED_IN]: [],
  [BookingStatus.CANCELLED]: [],
  [BookingStatus.NO_SHOW]: [],
};

export const BOOKING_WORKFLOW_MESSAGES = {
  pendingDepositRequired: "Record a deposit to confirm this booking.",
  pendingConfirmationHandledByDeposit:
    "Booking confirmation is handled by the deposit recording flow.",
  checkedIn: "Checked-in bookings no longer have booking status actions.",
  cancelled: "Cancelled bookings have no further status actions.",
  noShow: "No-show bookings have no further status actions.",
  noStatusActions: "No booking status actions are currently available.",
  noShowConfirmation: "Mark this booking as a no-show?",
  cancelConfirmation: "Cancel this booking?",
} as const;

export function buildBookingWorkflowPolicy(
  input: BuildBookingWorkflowPolicyInput
): BookingWorkflowPolicy {
  if (input.status === BookingStatus.CONFIRMED) {
    return {
      status: input.status,
      actions: [
        {
          key: "record_no_show",
          label: "Record No-Show",
          nextStatus: BookingStatus.NO_SHOW,
          intent: "destructive",
          available: true,
          disabled: false,
          blockedReason: null,
          confirmationMessage: BOOKING_WORKFLOW_MESSAGES.noShowConfirmation,
        },
        {
          key: "cancel_booking",
          label: "Cancel Booking",
          nextStatus: BookingStatus.CANCELLED,
          intent: "destructive",
          available: true,
          disabled: false,
          blockedReason: null,
          confirmationMessage: BOOKING_WORKFLOW_MESSAGES.cancelConfirmation,
        },
      ],
      blockers: [],
      emptyStateMessage: null,
    };
  }

  const emptyStateMessage = emptyStateFor(input);

  return {
    status: input.status,
    actions: [],
    blockers: emptyStateMessage ? [emptyStateMessage] : [],
    emptyStateMessage,
  };
}

export function assertBookingStatusTransitionAllowed(
  currentStatus: BookingStatus,
  nextStatus: BookingStatus
): void {
  if (!BOOKING_STATUS_TRANSITIONS[currentStatus].includes(nextStatus)) {
    throw new Error(
      bookingStatusTransitionErrorMessage(currentStatus, nextStatus)
    );
  }
}

export function bookingStatusTransitionErrorMessage(
  currentStatus: BookingStatus,
  nextStatus: BookingStatus
): string {
  return `Invalid booking status transition from ${formatEnum(
    currentStatus
  )} to ${formatEnum(nextStatus)}`;
}

function emptyStateFor(
  input: BuildBookingWorkflowPolicyInput
): BookingWorkflowPolicy["emptyStateMessage"] {
  switch (input.status) {
    case BookingStatus.PENDING:
      return input.depositPaid
        ? BOOKING_WORKFLOW_MESSAGES.pendingConfirmationHandledByDeposit
        : BOOKING_WORKFLOW_MESSAGES.pendingDepositRequired;
    case BookingStatus.CHECKED_IN:
      return BOOKING_WORKFLOW_MESSAGES.checkedIn;
    case BookingStatus.CANCELLED:
      return BOOKING_WORKFLOW_MESSAGES.cancelled;
    case BookingStatus.NO_SHOW:
      return BOOKING_WORKFLOW_MESSAGES.noShow;
    case BookingStatus.CONFIRMED:
      return null;
  }
}

function formatEnum(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
