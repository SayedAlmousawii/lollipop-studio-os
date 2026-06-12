import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { NoteKind, UserRole } from "@prisma/client";
import { withIsolatedBackendInvariantSchema } from "../backend-invariants/harness";

test("deleting an order package keeps notes and clears orderPackageId", async () => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;
    const { db: prisma } = await import("@/lib/db");

    try {
      const user = await prisma.user.create({
        data: {
          email: "note-set-null@example.com",
          name: "Note Author",
          role: UserRole.MANAGER,
        },
      });
      const customer = await prisma.customer.create({
        data: { name: "Notes Customer", phone: "+96550001700" },
      });
      const department = await prisma.studioDepartment.create({
        data: { code: "NOTES", name: "Notes Department" },
      });
      const sessionType = await prisma.sessionType.create({
        data: {
          code: "NOTES_SESSION",
          name: "Notes Session",
          departmentId: department.id,
          calendarLabel: "Notes",
        },
      });
      const packageFamily = await prisma.packageFamily.create({
        data: {
          code: "NOTES_FAMILY",
          name: "Notes Family",
          sessionTypeId: sessionType.id,
        },
      });
      const packageTemplate = await prisma.package.create({
        data: {
          id: "notes-package-template",
          name: "Notes Package",
          price: "100.000",
          photoCount: 10,
          packageFamilyId: packageFamily.id,
        },
      });
      const booking = await prisma.booking.create({
        data: {
          publicId: "BK-NOTES-001",
          jobNumber: "JOB-NOTES-001",
          customerId: customer.id,
          departmentId: department.id,
          sessionStartsAt: new Date("2026-06-12T08:00:00.000Z"),
        },
      });
      const job = await prisma.job.create({
        data: {
          jobNumber: "JOB-NOTES-001",
          customerId: customer.id,
        },
      });
      const order = await prisma.order.create({
        data: {
          publicId: "ORD-NOTES-001",
          jobNumber: "JOB-NOTES-001",
          jobId: job.id,
          bookingId: booking.id,
          customerId: customer.id,
        },
      });
      const orderPackage = await prisma.orderPackage.create({
        data: {
          orderId: order.id,
          originalPackageId: packageTemplate.id,
          currentPackageId: packageTemplate.id,
          sessionTypeId: sessionType.id,
          originalPackageNameSnapshot: "Notes Package",
          currentPackageNameSnapshot: "Notes Package",
          originalPackagePriceSnapshot: "100.000",
          finalPackagePriceSnapshot: "100.000",
        },
      });
      const note = await prisma.note.create({
        data: {
          orderId: order.id,
          orderPackageId: orderPackage.id,
          kind: NoteKind.CUSTOMER,
          body: "Keep this note after package deletion.",
          authorUserId: user.id,
        },
      });

      await prisma.orderPackage.delete({ where: { id: orderPackage.id } });

      const reloaded = await prisma.note.findUniqueOrThrow({ where: { id: note.id } });
      assert.equal(reloaded.orderId, order.id);
      assert.equal(reloaded.orderPackageId, null);
    } finally {
      await prisma.$disconnect();
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });
});
