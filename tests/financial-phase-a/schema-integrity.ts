import { InvoiceType, type PrismaClient } from "@prisma/client";
import {
  expectNoRows,
  expectStatementToFail,
  getCurrentSchema,
} from "./assertions";
import type { PhaseACheck, PhaseAViolation } from "./types";

export function buildSchemaIntegrityChecks(
  db: PrismaClient,
  databaseUrl: string
): PhaseACheck[] {
  return [
    {
      code: "L0-INVOICE-CONSTRAINTS",
      description: "Invoice table constraints and enum shape",
      run: async () => {
        const sample = await getSampleFinancialContext(db);
        const [negativeTotalFailed, nullFinancialCaseFailed] = await Promise.all([
          expectStatementToFail(
            databaseUrl,
            `INSERT INTO "invoices" ("id", "publicId", "financialCaseId", "invoiceType", "customerId", "invoiceNumber", "totalAmount", "paidAmount", "remainingAmount", "status", "isLocked", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, 'FINAL', $4, $5, -1, 0, 0, 'ISSUED', false, NOW(), NOW())`,
            [
              "phase-a-negative-invoice",
              "INV-PHASE-A-NEG",
              sample.financialCaseId,
              sample.customerId,
              "INV-PHASE-A-NEG",
            ]
          ),
          expectStatementToFail(
            databaseUrl,
            `INSERT INTO "invoices" ("id", "publicId", "financialCaseId", "invoiceType", "customerId", "invoiceNumber", "totalAmount", "paidAmount", "remainingAmount", "status", "isLocked", "createdAt", "updatedAt")
             VALUES ($1, $2, NULL, 'FINAL', $3, $4, 1, 0, 1, 'ISSUED', false, NOW(), NOW())`,
            [
              "phase-a-null-fc-invoice",
              "INV-PHASE-A-NULL-FC",
              sample.customerId,
              "INV-PHASE-A-NULL-FC",
            ]
          ),
        ]);

        const violations: PhaseAViolation[] = [];
        if (!negativeTotalFailed) {
          violations.push({
            layer: "L0",
            invariant: "invoice-total-amount-positive-check",
            entityType: "Constraint",
            entityId: "invoices_totalAmount",
            expected: "negative invoice total rejected",
            actual: "negative invoice total accepted",
          });
        }
        if (!nullFinancialCaseFailed) {
          violations.push({
            layer: "L0",
            invariant: "invoice-financial-case-not-null",
            entityType: "Constraint",
            entityId: "invoices_financialCaseId",
            expected: "NULL financialCaseId rejected",
            actual: "NULL financialCaseId accepted",
          });
        }

        const enumRows = await db.$queryRaw<{ invoiceType: InvoiceType }[]>`
          SELECT DISTINCT "invoiceType" FROM "invoices"
        `;
        const allowed = new Set(Object.values(InvoiceType));
        violations.push(
          ...enumRows
            .filter((row) => !allowed.has(row.invoiceType))
            .map((row) => ({
              layer: "L0" as const,
              invariant: "invoice-type-enum-coverage",
              entityType: "InvoiceType",
              entityId: row.invoiceType,
              expected: Array.from(allowed).join(","),
              actual: row.invoiceType,
            }))
        );

        const orphanInvoices = await db.$queryRaw<{ id: string }[]>`
          SELECT i.id
          FROM "invoices" i
          LEFT JOIN "financial_cases" fc ON fc.id = i."financialCaseId"
          WHERE fc.id IS NULL
        `;
        violations.push(
          ...(await expectNoRows(
            "L0",
            "invoice-financial-case-fk-target",
            "Invoice",
            "0 orphan invoices",
            "invoice without FinancialCase FK target",
            orphanInvoices
          ))
        );

        const badAdjustmentPrefixes = await db.$queryRaw<{ id: string }[]>`
          SELECT id
          FROM "invoices"
          WHERE "invoiceType" = 'ADJUSTMENT'
            AND "invoiceNumber" NOT LIKE 'ADJ-%'
        `;
        violations.push(
          ...(await expectNoRows(
            "L0",
            "adjustment-invoice-number-prefix",
            "Invoice",
            "ADJUSTMENT invoice numbers start with ADJ-",
            "non-ADJ prefix",
            badAdjustmentPrefixes
          ))
        );

        return violations;
      },
    },
    {
      code: "L0-PAYMENT-CONSTRAINTS",
      description: "Payment constraints and direction rules",
      run: async () => {
        const sample = await getSampleFinancialContext(db);
        const negativeAmountFailed = await expectStatementToFail(
          databaseUrl,
          `INSERT INTO "payments" ("id", "publicId", "financialCaseId", "invoiceId", "amount", "method", "paymentType", "createdAt", "paidAt")
           VALUES ($1, $2, $3, $4, -1, 'CASH', 'FINAL', NOW(), NOW())`,
          [
            "phase-a-negative-payment",
            "PAY-PHASE-A-NEG",
            sample.financialCaseId,
            sample.finalInvoiceId,
          ]
        );

        const violations: PhaseAViolation[] = [];
        if (!negativeAmountFailed) {
          violations.push({
            layer: "L0",
            invariant: "payment-amount-positive-check",
            entityType: "Constraint",
            entityId: "payments_amount",
            expected: "negative payment amount rejected",
            actual: "negative payment amount accepted",
          });
        }

        const directionNullRows = await db.$queryRaw<{ id: string }[]>`
          SELECT id FROM "payments" WHERE direction IS NULL
        `;
        const refundWrongDirection = await db.$queryRaw<{ id: string }[]>`
          SELECT p.id
          FROM "payments" p
          JOIN "invoices" i ON i.id = p."invoiceId"
          WHERE i."invoiceType" = 'REFUND'
            AND p.direction != 'OUT'
        `;
        const nonRefundOutRows = await db.$queryRaw<{ id: string }[]>`
          SELECT p.id
          FROM "payments" p
          JOIN "invoices" i ON i.id = p."invoiceId"
          WHERE i."invoiceType" != 'REFUND'
            AND p.direction = 'OUT'
        `;
        const nullFinancialCaseRows = await db.$queryRaw<{ id: string }[]>`
          SELECT id FROM "payments" WHERE "financialCaseId" IS NULL
        `;
        const crossCaseRows = await db.$queryRaw<{ id: string }[]>`
          SELECT p.id
          FROM "payments" p
          JOIN "invoices" i ON i.id = p."invoiceId"
          WHERE p."financialCaseId" != i."financialCaseId"
        `;

        violations.push(
          ...(await expectNoRows(
            "L0",
            "payment-direction-not-null",
            "Payment",
            "0 payments with NULL direction",
            "NULL direction",
            directionNullRows
          )),
          ...(await expectNoRows(
            "L0",
            "refund-payment-direction-out",
            "Payment",
            "REFUND invoice payments have direction OUT",
            "REFUND payment direction was not OUT",
            refundWrongDirection
          )),
          ...(await expectNoRows(
            "L0",
            "non-refund-payment-direction-in",
            "Payment",
            "non-REFUND invoice payments have direction IN",
            "non-REFUND payment direction OUT",
            nonRefundOutRows
          )),
          ...(await expectNoRows(
            "L0",
            "payment-financial-case-not-null",
            "Payment",
            "0 payments with NULL financialCaseId",
            "NULL financialCaseId",
            nullFinancialCaseRows
          )),
          ...(await expectNoRows(
            "L0",
            "payment-financial-case-matches-invoice",
            "Payment",
            "payment FinancialCase matches invoice FinancialCase",
            "cross-case payment",
            crossCaseRows
          ))
        );

        return violations;
      },
    },
    {
      code: "L0-ALLOCATION-APPLICATION-CONSTRAINTS",
      description: "PaymentAllocation and DocumentApplication constraints",
      run: async () => {
        const sample = await getSampleFinancialContext(db);
        const [negativeAllocationFailed, duplicateAllocationFailed, negativeApplicationFailed, duplicateApplicationFailed] =
          await Promise.all([
            expectStatementToFail(
              databaseUrl,
              `INSERT INTO "payment_allocations" ("id", "payment_id", "invoice_id", "amount", "created_at")
               VALUES ($1, $2, $3, -1, NOW())`,
              [
                "phase-a-negative-allocation",
                sample.finalPaymentId,
                sample.finalInvoiceId,
              ]
            ),
            expectStatementToFail(
              databaseUrl,
              `INSERT INTO "payment_allocations" ("id", "payment_id", "invoice_id", "amount", "created_at")
               VALUES ($1, $2, $3, 1, NOW())`,
              [
                "phase-a-duplicate-allocation",
                sample.finalPaymentId,
                sample.finalInvoiceId,
              ]
            ),
            expectStatementToFail(
              databaseUrl,
              `INSERT INTO "document_applications" ("id", "source_invoice_id", "target_invoice_id", "amount_applied", "created_at")
               VALUES ($1, $2, $3, -1, NOW())`,
              [
                "phase-a-negative-application",
                sample.depositInvoiceId,
                sample.finalInvoiceId,
              ]
            ),
            expectStatementToFail(
              databaseUrl,
              `INSERT INTO "document_applications" ("id", "source_invoice_id", "target_invoice_id", "amount_applied", "created_at")
               VALUES ($1, $2, $3, 1, NOW())`,
              [
                "phase-a-duplicate-application",
                sample.depositInvoiceId,
                sample.finalInvoiceId,
              ]
            ),
          ]);

        const violations: PhaseAViolation[] = [];
        for (const [failed, invariant, entityId, actual] of [
          [
            negativeAllocationFailed,
            "payment-allocation-amount-positive-check",
            "payment_allocations_amount",
            "negative allocation accepted",
          ],
          [
            duplicateAllocationFailed,
            "payment-allocation-payment-unique",
            "payment_allocations_payment_id_key",
            "duplicate allocation accepted",
          ],
          [
            negativeApplicationFailed,
            "document-application-amount-positive-check",
            "document_applications_amount_applied",
            "negative document application accepted",
          ],
          [
            duplicateApplicationFailed,
            "document-application-source-target-unique",
            "document_applications_source_target_key",
            "duplicate source-target application accepted",
          ],
        ] as const) {
          if (!failed) {
            violations.push({
              layer: "L0",
              invariant,
              entityType: "Constraint",
              entityId,
              expected: "statement rejected",
              actual,
            });
          }
        }

        const missingAllocations = await db.$queryRaw<{ id: string }[]>`
          SELECT p.id
          FROM "payments" p
          LEFT JOIN "payment_allocations" pa ON pa.payment_id = p.id
          WHERE pa.id IS NULL
        `;
        const missingDepositApplications = await db.$queryRaw<{ id: string }[]>`
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
        `;

        violations.push(
          ...(await expectNoRows(
            "L0",
            "payment-has-allocation",
            "Payment",
            "every payment has an allocation",
            "payment without allocation",
            missingAllocations
          )),
          ...(await expectNoRows(
            "L0",
            "deposit-final-application-exists",
            "FinancialCase",
            "every DEPOSIT/FINAL pair has DocumentApplication",
            "missing DEPOSIT to FINAL application",
            missingDepositApplications
          ))
        );

        return violations;
      },
    },
    {
      code: "L0-ORDER-FINANCIAL-CASE-SHAPE",
      description: "Order split and FinancialCase lifecycle shape",
      run: async () => {
        const currentSchema = await getCurrentSchema(db);
        const [
          addOnsWithoutProduct,
          upgradesWithoutPackageItem,
          legacyPackageItemColumns,
          orphanFinancialCases,
          confirmedWithoutFinancialCase,
          pendingWithFinancialCase,
          bookingsWithoutPackage,
          ordersWithoutPackage,
        ] = await Promise.all([
          db.$queryRaw<{ id: string }[]>`
            SELECT id FROM "order_add_ons" WHERE "productId" IS NULL
          `,
          db.$queryRaw<{ id: string }[]>`
            SELECT id FROM "order_package_item_upgrades" WHERE "packageItemId" IS NULL
          `,
          db.$queryRaw<{ id: string }[]>`
            SELECT column_name AS id
            FROM information_schema.columns
            WHERE table_schema = ${currentSchema}
              AND table_name = 'order_add_ons'
              AND column_name = 'package_item_id'
          `,
          db.$queryRaw<{ id: string }[]>`
            SELECT fc.id
            FROM "financial_cases" fc
            LEFT JOIN "bookings" b ON b.id = fc."bookingId"
            WHERE b.id IS NULL
          `,
          db.$queryRaw<{ id: string }[]>`
            SELECT b.id
            FROM "bookings" b
            LEFT JOIN "financial_cases" fc ON fc."bookingId" = b.id
            WHERE b.status NOT IN ('PENDING', 'CANCELLED')
              AND fc.id IS NULL
          `,
          db.$queryRaw<{ id: string }[]>`
            SELECT b.id
            FROM "bookings" b
            JOIN "financial_cases" fc ON fc."bookingId" = b.id
            WHERE b.status = 'PENDING'
          `,
          db.$queryRaw<{ id: string }[]>`
            SELECT b.id
            FROM "bookings" b
            LEFT JOIN "booking_packages" bp ON bp."bookingId" = b.id
            WHERE b.status != 'PENDING'
              AND bp.id IS NULL
          `,
          db.$queryRaw<{ id: string }[]>`
            SELECT o.id
            FROM "orders" o
            LEFT JOIN "order_packages" op ON op."orderId" = o.id
            WHERE op.id IS NULL
          `,
        ]);

        return [
          ...(await expectNoRows(
            "L0",
            "order-addon-product-not-null",
            "OrderAddOn",
            "0 OrderAddOn rows without product",
            "missing productId",
            addOnsWithoutProduct
          )),
          ...(await expectNoRows(
            "L0",
            "order-package-item-upgrade-package-item-not-null",
            "OrderPackageItemUpgrade",
            "0 upgrade rows without package item",
            "missing packageItemId",
            upgradesWithoutPackageItem
          )),
          ...(await expectNoRows(
            "L0",
            "order-addon-has-no-package-item-column",
            "Column",
            "order_add_ons.package_item_id absent",
            "legacy package_item_id column present",
            legacyPackageItemColumns
          )),
          ...(await expectNoRows(
            "L0",
            "financial-case-booking-fk-target",
            "FinancialCase",
            "0 FinancialCase rows without Booking target",
            "orphan FinancialCase",
            orphanFinancialCases
          )),
          ...(await expectNoRows(
            "L0",
            "confirmed-booking-has-financial-case",
            "Booking",
            "confirmed/checked-in/no-show bookings have FinancialCase",
            "missing FinancialCase",
            confirmedWithoutFinancialCase
          )),
          ...(await expectNoRows(
            "L0",
            "pending-booking-has-no-financial-records",
            "Booking",
            "PENDING bookings have no FinancialCase",
            "PENDING booking has FinancialCase",
            pendingWithFinancialCase
          )),
          ...(await expectNoRows(
            "L0",
            "non-pending-booking-has-booking-package",
            "Booking",
            "non-PENDING bookings have BookingPackage",
            "missing BookingPackage",
            bookingsWithoutPackage
          )),
          ...(await expectNoRows(
            "L0",
            "order-has-order-package",
            "Order",
            "orders have at least one OrderPackage",
            "missing OrderPackage",
            ordersWithoutPackage
          )),
        ];
      },
    },
  ];
}

async function getSampleFinancialContext(db: PrismaClient) {
  const invoice = await db.invoice.findFirstOrThrow({
    where: {
      publicId: "INV-PHASE-A-FINAL",
      invoiceType: InvoiceType.FINAL,
    },
    select: {
      id: true,
      customerId: true,
      financialCaseId: true,
      payments: {
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
      financialCase: {
        select: {
          invoices: {
            where: { invoiceType: InvoiceType.DEPOSIT },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });

  const finalPaymentId = invoice.payments[0]?.id;
  const depositInvoiceId = invoice.financialCase.invoices[0]?.id;
  if (!finalPaymentId || !depositInvoiceId) {
    throw new Error("Phase A fixture did not create a usable FINAL/DEPOSIT sample");
  }

  return {
    finalInvoiceId: invoice.id,
    customerId: invoice.customerId,
    financialCaseId: invoice.financialCaseId,
    finalPaymentId,
    depositInvoiceId,
  };
}
