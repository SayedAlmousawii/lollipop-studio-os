import assert from "node:assert/strict";
import { BookingStatus, UserRole } from "@prisma/client";
import {
  buildCheckedInWorkflowFixture,
  getBookingFinancialSnapshot,
  type PhaseBFixtures,
} from "../financial-phase-b/fixtures";

const fixtures: PhaseBFixtures = phaseBFixtures();

export async function runBookingConfirmationCheckinSmokeTest(
  databaseUrl: string
): Promise<void> {
  void databaseUrl;
  const [{ db }, { getFinancialCaseSummary }, { buildBookingWorkflowPolicy }] =
    await Promise.all([
      import("../../src/lib/db"),
      import("../../src/modules/financial-cases"),
      import("../../src/modules/bookings/booking-workflow-policy"),
    ]);

  process.stdout.write("workflow smoke: booking confirmation + check-in\n");

  const workflow = await buildCheckedInWorkflowFixture(
    db,
    fixtures,
    "r13c-booking-checkin"
  );
  const booking = await getBookingFinancialSnapshot(db, workflow.bookingId);
  assert.ok(booking, "expected checked-in booking fixture");
  assert.equal(booking.status, BookingStatus.CHECKED_IN);
  assert.ok(booking.jobId, "expected check-in to create a job");
  assert.equal(booking.order?.id, workflow.orderId);
  assert.equal(booking.financialCase?.jobId, booking.jobId);

  const policy = buildBookingWorkflowPolicy({
    status: BookingStatus.CHECKED_IN,
    depositPaid: true,
  });
  assert.deepEqual(policy.actions, []);
  assert.deepEqual(policy.blockers, [
    "Checked-in bookings no longer have booking status actions.",
  ]);

  const summary = await getFinancialCaseSummary({ bookingId: workflow.bookingId });
  assert.ok(summary, "expected financial case summary");
  assert.equal(summary.stage, "booking");
  assert.equal(summary.depositPaid, true);
  assert.equal(summary.awaitingFinalInvoiceAfterCheckIn, true);
  assert.equal(summary.finalInvoicePending, true);
  assert.equal(summary.depositInvoice?.paidAmount, 20);

  await db.$disconnect();
}

function phaseBFixtures(): PhaseBFixtures {
  return {
    adminId: "phase-b-77-admin",
    managerId: "phase-b-77-manager",
    photographerId: "phase-b-77-photographer",
    editorId: "phase-b-77-editor",
    departmentId: "phase-b-77-department",
    sessionTypeId: "phase-b-77-session-type",
    basePackageId: "phase-b-77-base-package",
    upgradePackageId: "phase-b-77-upgrade-package",
    addOnProductId: "phase-b-77-addon-product",
    zeroPriceAddOnProductId: "phase-b-77-zero-addon-product",
    adminActor: { actorUserId: "phase-b-77-admin", actorRole: UserRole.ADMIN },
    managerActor: {
      actorUserId: "phase-b-77-manager",
      actorRole: UserRole.MANAGER,
    },
  };
}
