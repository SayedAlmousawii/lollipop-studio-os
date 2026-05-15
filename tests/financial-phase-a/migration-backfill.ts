import type { PrismaClient } from "@prisma/client";
import { expectNoRows } from "./assertions";
import type { PhaseACheck, PhaseAViolation } from "./types";

const REQUIRED_PHASE_A_MIGRATIONS = [
  "20260513040000_multi_package_schema_foundation",
  "20260513120000_singular_package_field_retirement",
  "20260514113000_financial_rearch_phase_0_schema_groundwork",
  "20260514130000_payment_invoice_financial_case_consistency",
  "20260514190000_order_package_item_upgrade_table",
  "20260514200000_split_order_add_on_upgrade_cleanup",
  "20260514210000_financial_rearch_document_application_payment_allocation_tables",
  "20260514220000_financial_rearch_application_allocation_backfill",
  "20260514230000_payment_allocation_payment_unique",
  "20260515010000_payment_type_adjustment",
  "20260515020000_refund_invoice_outbound_payment",
];

export function buildMigrationBackfillChecks(db: PrismaClient): PhaseACheck[] {
  return [
    {
      code: "L1-PAYMENT-ALLOCATION-BACKFILL",
      description: "PaymentAllocation backfill shape",
      run: async () => {
        const mismatchedAllocations = await db.$queryRaw<{ id: string }[]>`
          SELECT p.id
          FROM "payments" p
          JOIN "payment_allocations" pa ON pa.payment_id = p.id
          WHERE pa.amount != p.amount
             OR pa.invoice_id != p."invoiceId"
        `;
        const duplicateAllocations = await db.$queryRaw<{ id: string }[]>`
          SELECT payment_id AS id
          FROM "payment_allocations"
          GROUP BY payment_id
          HAVING COUNT(*) > 1
        `;

        return [
          ...(await expectNoRows(
            "L1",
            "payment-allocation-backfill-amount-and-invoice",
            "Payment",
            "allocation amount/invoice match payment",
            "allocation amount or invoice mismatch",
            mismatchedAllocations
          )),
          ...(await expectNoRows(
            "L1",
            "payment-allocation-backfill-single-allocation",
            "Payment",
            "one allocation per payment",
            "multiple allocations",
            duplicateAllocations
          )),
        ];
      },
    },
    {
      code: "L1-DOCUMENT-APPLICATION-BACKFILL",
      description: "DocumentApplication backfill shape",
      run: async () => {
        const mismatchedApplications = await db.$queryRaw<{ id: string }[]>`
          SELECT fc.id
          FROM "financial_cases" fc
          JOIN "invoices" dep
            ON dep."financialCaseId" = fc.id
           AND dep."invoiceType" = 'DEPOSIT'
          JOIN "invoices" fin
            ON fin."financialCaseId" = fc.id
           AND fin."invoiceType" = 'FINAL'
          LEFT JOIN "document_applications" da
            ON da.source_invoice_id = dep.id
           AND da.target_invoice_id = fin.id
          WHERE da.id IS NULL
             OR da.amount_applied != dep."paidAmount"
        `;

        return expectNoRows(
          "L1",
          "document-application-backfill-deposit-to-final",
          "FinancialCase",
          "DEPOSIT to FINAL application exists and equals deposit paidAmount",
          "missing or amount-mismatched DocumentApplication",
          mismatchedApplications
        );
      },
    },
    {
      code: "L1-ORDER-SPLIT-BACKFILLS",
      description: "OrderAddOn, OrderPackageItemUpgrade, and BookingPackage backfill shape",
      run: async () => {
        const [addOnsWithoutProduct, bookingPackagesWithoutSessionType] =
          await Promise.all([
            db.$queryRaw<{ id: string }[]>`
              SELECT id FROM "order_add_ons" WHERE "productId" IS NULL
            `,
            db.$queryRaw<{ id: string }[]>`
              SELECT id FROM "booking_packages" WHERE "sessionTypeId" IS NULL
            `,
          ]);

        return [
          ...(await expectNoRows(
            "L1",
            "order-addon-split-no-upgrade-shape-left",
            "OrderAddOn",
            "true add-ons retain productId",
            "OrderAddOn without productId",
            addOnsWithoutProduct
          )),
          ...(await expectNoRows(
            "L1",
            "booking-package-session-type-backfill",
            "BookingPackage",
            "BookingPackage rows have sessionTypeId",
            "BookingPackage missing sessionTypeId",
            bookingPackagesWithoutSessionType
          )),
        ];
      },
    },
    {
      code: "L1-MIGRATION-ORDERING",
      description: "Phase A migration records are present, applied, and not rolled back",
      run: async () => {
        const rows = await db.$queryRaw<
          {
            migration_name: string;
            applied_steps_count: number;
            finished_at: Date | null;
            rolled_back_at: Date | null;
          }[]
        >`
          SELECT migration_name, applied_steps_count, finished_at, rolled_back_at
          FROM "_prisma_migrations"
          WHERE migration_name = ANY(${REQUIRED_PHASE_A_MIGRATIONS})
          ORDER BY finished_at
        `;
        const byName = new Map(rows.map((row) => [row.migration_name, row]));
        const violations: PhaseAViolation[] = [];

        REQUIRED_PHASE_A_MIGRATIONS.forEach((migrationName, index) => {
          const row = byName.get(migrationName);
          if (!row) {
            violations.push({
              layer: "L1",
              invariant: "phase-a-migration-present",
              entityType: "Migration",
              entityId: migrationName,
              expected: "migration applied",
              actual: "missing from _prisma_migrations",
            });
            return;
          }

          if (row.applied_steps_count <= 0 || row.rolled_back_at !== null || row.finished_at === null) {
            violations.push({
              layer: "L1",
              invariant: "phase-a-migration-applied",
              entityType: "Migration",
              entityId: migrationName,
              expected: "applied_steps_count > 0, finished_at set, not rolled back",
              actual: `steps=${row.applied_steps_count}, finished=${row.finished_at}, rolledBack=${row.rolled_back_at}`,
            });
          }

          const previousName = REQUIRED_PHASE_A_MIGRATIONS[index - 1];
          const previous = previousName ? byName.get(previousName) : null;
          if (
            previous?.finished_at &&
            row.finished_at &&
            previous.finished_at.getTime() > row.finished_at.getTime()
          ) {
            violations.push({
              layer: "L1",
              invariant: "phase-a-migration-order",
              entityType: "Migration",
              entityId: migrationName,
              expected: `applied after ${previousName}`,
              actual: `finished before ${previousName}`,
            });
          }
        });

        return violations;
      },
    },
  ];
}
