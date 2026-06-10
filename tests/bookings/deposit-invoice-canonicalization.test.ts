import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test, { after } from "node:test";
import {
  BookingStatus,
  InvoiceStatus,
  InvoiceType,
  type PrismaClient,
} from "@prisma/client";
import { withIsolatedBackendInvariantSchema } from "../backend-invariants/harness";
import type { FinancialCaseSummaryOrderFixtureResult } from "../fixtures/financial";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };
const originalModuleLoad = moduleWithLoader._load;
moduleWithLoader._load = function loadWithServerOnlyShim(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalModuleLoad.call(this, request, parent, isMain);
};

after(() => {
  moduleWithLoader._load = originalModuleLoad;
});

test("booking deposit invoice canonicalization audit has positive and negative controls", async (t) => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const [{ db }, { makeFinancialCaseSummaryOrderFixture }] =
        await Promise.all([
          import("@/lib/db"),
          import("../fixtures/financial"),
        ]);

      await t.test("passes after scanning a canonical booking deposit invoice", async () => {
        const canonical = await makeFinancialCaseSummaryOrderFixture(db, {
          suffix: "R12CAN",
        });
        await makeFinancialCaseSummaryOrderFixture(db, {
          suffix: "R12BK",
          createFinalInvoice: false,
        });

        const result = await auditBookingDepositInvoiceCanonicalization(db);

        assert.ok(result.bookingInvoiceCount > 0, "audit must scan booking invoices");
        assert.ok(
          result.bookingInvoiceIds.includes(canonical.invoiceId),
          "audit must include the fixture deposit invoice from booking.invoices"
        );
      });

      await t.test("fails when a booking deposit invoice points at another case", async () => {
        const drift = await makeFinancialCaseSummaryOrderFixture(db, {
          suffix: "R12DRF",
          createFinalInvoice: false,
          depositStatus: InvoiceStatus.DRAFT,
          depositPaidAmount: 0,
        });
        await seedDriftBookingDepositInvoice(db, drift, "R12DRF-CASE");

        await assert.rejects(
          () => auditBookingDepositInvoiceCanonicalization(db),
          new RegExp(`non-canonical deposit invoice ${drift.invoiceId}`)
        );
      });
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });
});

async function auditBookingDepositInvoiceCanonicalization(
  db: PrismaClient
): Promise<{ bookingInvoiceCount: number; bookingInvoiceIds: string[] }> {
  const rows = await db.booking.findMany({
    select: {
      id: true,
      publicId: true,
      invoices: {
        where: { invoiceType: InvoiceType.DEPOSIT },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
      financialCase: {
        select: {
          invoices: {
            where: { invoiceType: InvoiceType.DEPOSIT },
            select: { id: true, createdAt: true },
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  assert.ok(rows.length > 0, "expected booking fixtures for audit");

  const bookingInvoiceIds: string[] = [];
  for (const row of rows) {
    bookingInvoiceIds.push(...row.invoices.map((invoice) => invoice.id));
    const financialCaseInvoices = row.financialCase?.invoices ?? [];
    const financialCaseInvoiceIds = new Set(
      financialCaseInvoices.map((invoice) => invoice.id)
    );

    for (const invoiceId of row.invoices.map((invoice) => invoice.id)) {
      assert.ok(
        financialCaseInvoiceIds.has(invoiceId),
        `booking ${row.publicId ?? row.id} has non-canonical deposit invoice ${invoiceId}`
      );
    }

    const mergedLegacyOrder = dedupeAndSortDepositInvoices([
      ...row.invoices,
      ...financialCaseInvoices,
    ]).map((invoice) => invoice.id);
    const directFinancialCaseOrder = financialCaseInvoices.map(
      (invoice) => invoice.id
    );

    assert.deepEqual(
      directFinancialCaseOrder,
      mergedLegacyOrder,
      `booking ${row.publicId ?? row.id} deposit invoice ordering differs`
    );
  }

  return { bookingInvoiceCount: bookingInvoiceIds.length, bookingInvoiceIds };
}

async function seedDriftBookingDepositInvoice(
  db: PrismaClient,
  fixture: FinancialCaseSummaryOrderFixtureResult,
  suffix: string
): Promise<void> {
  const driftBooking = await db.booking.create({
    data: {
      publicId: `BK-${suffix}`,
      customerId: fixture.customerId,
      departmentId: fixture.departmentId,
      status: BookingStatus.CONFIRMED,
      sessionStartsAt: new Date("2026-05-16T08:00:00.000Z"),
    },
    select: { id: true },
  });
  const driftFinancialCase = await db.financialCase.create({
    data: {
      bookingId: driftBooking.id,
      customerId: fixture.customerId,
    },
    select: { id: true },
  });
  await db.invoice.update({
    where: { id: fixture.invoiceId },
    data: {
      financialCaseId: driftFinancialCase.id,
    },
    select: { id: true },
  });
}

function dedupeAndSortDepositInvoices<T extends { id: string; createdAt: Date }>(
  invoices: T[]
): T[] {
  return Array.from(
    invoices.reduce((map, invoice) => {
      const existing = map.get(invoice.id);
      if (!existing || existing.createdAt < invoice.createdAt) {
        map.set(invoice.id, invoice);
      }
      return map;
    }, new Map<string, T>())
  )
    .map(([, invoice]) => invoice)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
}
