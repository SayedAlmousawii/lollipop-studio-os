import type { PrismaClient } from "@prisma/client";
import { expectNoRows } from "./assertions";
import type { PhaseACheck } from "./types";

export function buildFinancialInvariantChecks(db: PrismaClient): PhaseACheck[] {
  return [
    {
      code: "INV-01-TO-03",
      description: "PaymentAllocation single-allocation contract",
      run: async () => {
        const [wrongCount, amountMismatch, invoiceMismatch] = await Promise.all([
          db.$queryRaw<{ id: string }[]>`
            SELECT p.id
            FROM "payments" p
            LEFT JOIN "payment_allocations" pa ON pa.payment_id = p.id
            GROUP BY p.id
            HAVING COUNT(pa.id) != 1
          `,
          db.$queryRaw<{ id: string }[]>`
            SELECT p.id
            FROM "payments" p
            JOIN "payment_allocations" pa ON pa.payment_id = p.id
            WHERE pa.amount != p.amount
          `,
          db.$queryRaw<{ id: string }[]>`
            SELECT p.id
            FROM "payments" p
            JOIN "payment_allocations" pa ON pa.payment_id = p.id
            WHERE pa.invoice_id != p."invoiceId"
          `,
        ]);

        return [
          ...(await expectNoRows(
            "L2",
            "INV-01-payment-has-exactly-one-allocation",
            "Payment",
            "exactly 1 PaymentAllocation",
            "allocation count was not 1",
            wrongCount
          )),
          ...(await expectNoRows(
            "L2",
            "INV-02-payment-allocation-amount-equals-payment",
            "Payment",
            "allocation amount equals payment amount",
            "allocation amount mismatch",
            amountMismatch
          )),
          ...(await expectNoRows(
            "L2",
            "INV-03-payment-allocation-invoice-matches-payment",
            "Payment",
            "allocation invoice matches payment invoice",
            "allocation invoice mismatch",
            invoiceMismatch
          )),
        ];
      },
    },
    {
      code: "INV-04-TO-06",
      description: "DocumentApplication uniqueness and deposit binding",
      run: async () => {
        const [duplicatePairs, wrongDepositApplicationCount, wrongDepositApplicationAmount] =
          await Promise.all([
            db.$queryRaw<{ id: string }[]>`
              SELECT source_invoice_id || '->' || target_invoice_id AS id
              FROM "document_applications"
              GROUP BY source_invoice_id, target_invoice_id
              HAVING COUNT(*) > 1
            `,
            db.$queryRaw<{ id: string }[]>`
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
              GROUP BY fc.id, dep.id, fin.id
              HAVING COUNT(da.id) != 1
            `,
            db.$queryRaw<{ id: string }[]>`
              SELECT da.id
              FROM "document_applications" da
              JOIN "invoices" dep ON dep.id = da.source_invoice_id
              JOIN "invoices" fin ON fin.id = da.target_invoice_id
              WHERE dep."invoiceType" = 'DEPOSIT'
                AND fin."invoiceType" = 'FINAL'
                AND da.amount_applied != dep."paidAmount"
            `,
          ]);

        return [
          ...(await expectNoRows(
            "L2",
            "INV-04-document-application-source-target-unique",
            "DocumentApplication",
            "unique source/target pair",
            "duplicate source/target pair",
            duplicatePairs
          )),
          ...(await expectNoRows(
            "L2",
            "INV-05-deposit-has-one-application-to-final",
            "FinancialCase",
            "exactly 1 DEPOSIT to FINAL application",
            "wrong application count",
            wrongDepositApplicationCount
          )),
          ...(await expectNoRows(
            "L2",
            "INV-06-deposit-application-amount-equals-paid",
            "DocumentApplication",
            "application amount equals deposit paidAmount",
            "amount mismatch",
            wrongDepositApplicationAmount
          )),
        ];
      },
    },
    {
      code: "INV-07-TO-12",
      description: "Adjustment, credit note, and refund direction rules",
      run: async () => {
        const [
          badAdjustmentParent,
          chainedAdjustment,
          badCreditNoteTarget,
          unlockedCreditNote,
          refundWrongDirection,
          nonRefundWrongDirection,
        ] = await Promise.all([
          db.$queryRaw<{ id: string }[]>`
            SELECT child.id
            FROM "invoices" child
            LEFT JOIN "invoices" parent ON parent.id = child."parentInvoiceId"
            WHERE child."invoiceType" = 'ADJUSTMENT'
              AND (
                parent.id IS NULL
                OR parent."invoiceType" != 'FINAL'
                OR parent."financialCaseId" != child."financialCaseId"
              )
          `,
          db.$queryRaw<{ id: string }[]>`
            SELECT child.id
            FROM "invoices" child
            JOIN "invoices" parent ON parent.id = child."parentInvoiceId"
            WHERE child."invoiceType" = 'ADJUSTMENT'
              AND parent."invoiceType" = 'ADJUSTMENT'
          `,
          db.$queryRaw<{ id: string }[]>`
            SELECT da.id
            FROM "document_applications" da
            JOIN "invoices" source ON source.id = da.source_invoice_id
            JOIN "invoices" target ON target.id = da.target_invoice_id
            WHERE source."invoiceType" = 'CREDIT_NOTE'
              AND target."invoiceType" != 'FINAL'
          `,
          db.$queryRaw<{ id: string }[]>`
            SELECT id
            FROM "invoices"
            WHERE "invoiceType" = 'CREDIT_NOTE'
              AND (status != 'CLOSED' OR "isLocked" = false)
          `,
          db.$queryRaw<{ id: string }[]>`
            SELECT p.id
            FROM "payments" p
            JOIN "invoices" i ON i.id = p."invoiceId"
            WHERE i."invoiceType" = 'REFUND'
              AND p.direction != 'OUT'
          `,
          db.$queryRaw<{ id: string }[]>`
            SELECT p.id
            FROM "payments" p
            JOIN "invoices" i ON i.id = p."invoiceId"
            WHERE i."invoiceType" != 'REFUND'
              AND p.direction != 'IN'
          `,
        ]);

        return [
          ...(await expectNoRows(
            "L2",
            "INV-07-adjustment-parent-is-final-same-case",
            "Invoice",
            "ADJUSTMENT parent is same-case FINAL",
            "bad adjustment parent",
            badAdjustmentParent
          )),
          ...(await expectNoRows(
            "L2",
            "INV-08-no-adjustment-to-adjustment-chaining",
            "Invoice",
            "no ADJUSTMENT parent points to ADJUSTMENT",
            "ADJUSTMENT parent was ADJUSTMENT",
            chainedAdjustment
          )),
          ...(await expectNoRows(
            "L2",
            "INV-09-credit-note-application-targets-final",
            "DocumentApplication",
            "CREDIT_NOTE applications target FINAL",
            "target was not FINAL",
            badCreditNoteTarget
          )),
          ...(await expectNoRows(
            "L2",
            "INV-10-credit-note-locked-closed",
            "Invoice",
            "CREDIT_NOTE status CLOSED and locked",
            "CREDIT_NOTE was open or unlocked",
            unlockedCreditNote
          )),
          ...(await expectNoRows(
            "L2",
            "INV-11-refund-payment-direction-out",
            "Payment",
            "REFUND payments have direction OUT",
            "refund payment was not OUT",
            refundWrongDirection
          )),
          ...(await expectNoRows(
            "L2",
            "INV-12-non-refund-payment-direction-in",
            "Payment",
            "non-REFUND payments have direction IN",
            "non-refund payment was not IN",
            nonRefundWrongDirection
          )),
        ];
      },
    },
    {
      code: "INV-13-TO-17",
      description: "Invoice balance, locked deposit, and orphan record rules",
      run: async () => {
        const [overpaidOpenInvoices, unlockedDeposits, orphanAllocations, orphanApplications] =
          await Promise.all([
            db.$queryRaw<{ id: string }[]>`
              WITH effective_paid AS (
                SELECT
                  i.id,
                  COALESCE(SUM(CASE WHEN p.direction = 'OUT' THEN -pa.amount ELSE pa.amount END), 0)
                    + COALESCE((
                      SELECT SUM(da.amount_applied)
                      FROM "document_applications" da
                      WHERE da.target_invoice_id = i.id
                    ), 0) AS effective_paid
                FROM "invoices" i
                LEFT JOIN "payment_allocations" pa ON pa.invoice_id = i.id
                LEFT JOIN "payments" p ON p.id = pa.payment_id
                GROUP BY i.id
              )
              SELECT i.id
              FROM "invoices" i
              JOIN effective_paid ep ON ep.id = i.id
              WHERE i.status != 'CLOSED'
                AND ep.effective_paid > i."totalAmount"
            `,
            db.$queryRaw<{ id: string }[]>`
              SELECT id
              FROM "invoices"
              WHERE "invoiceType" = 'DEPOSIT'
                AND (status != 'CLOSED' OR "isLocked" = false)
            `,
            db.$queryRaw<{ id: string }[]>`
              SELECT pa.id
              FROM "payment_allocations" pa
              LEFT JOIN "payments" p ON p.id = pa.payment_id
              LEFT JOIN "invoices" i ON i.id = pa.invoice_id
              WHERE p.id IS NULL OR i.id IS NULL
            `,
            db.$queryRaw<{ id: string }[]>`
              SELECT da.id
              FROM "document_applications" da
              LEFT JOIN "invoices" source ON source.id = da.source_invoice_id
              LEFT JOIN "invoices" target ON target.id = da.target_invoice_id
              WHERE source.id IS NULL OR target.id IS NULL
            `,
          ]);

        return [
          ...(await expectNoRows(
            "L2",
            "INV-13-open-invoice-effective-paid-not-over-total",
            "Invoice",
            "effective paid <= total for open invoices",
            "effective paid exceeded total",
            overpaidOpenInvoices
          )),
          ...(await expectNoRows(
            "L2",
            "INV-15-deposit-invoice-closed-locked",
            "Invoice",
            "DEPOSIT invoices are CLOSED and locked",
            "DEPOSIT invoice open or unlocked",
            unlockedDeposits
          )),
          ...(await expectNoRows(
            "L2",
            "INV-16-no-orphan-payment-allocation",
            "PaymentAllocation",
            "PaymentAllocation references existing Payment and Invoice",
            "orphan allocation",
            orphanAllocations
          )),
          ...(await expectNoRows(
            "L2",
            "INV-17-no-orphan-document-application",
            "DocumentApplication",
            "DocumentApplication references existing source and target Invoice",
            "orphan document application",
            orphanApplications
          )),
        ];
      },
    },
    {
      code: "INV-19-TO-24",
      description: "Operational financial shape and balance rules",
      run: async () => {
        const [
          finalWithoutOrder,
          nonPositiveAdjustments,
          addOnsWithoutProduct,
          upgradesWithoutPackageItem,
          confirmedWithoutSingleDeposit,
          negativeOpenBalances,
        ] = await Promise.all([
          db.$queryRaw<{ id: string }[]>`
            SELECT i.id
            FROM "invoices" i
            LEFT JOIN "orders" direct_order ON direct_order.id = i."orderId"
            LEFT JOIN "financial_cases" fc ON fc.id = i."financialCaseId"
            LEFT JOIN "orders" case_job_order ON case_job_order."jobId" = fc."jobId"
            WHERE i."invoiceType" = 'FINAL'
              AND direct_order.id IS NULL
              AND case_job_order.id IS NULL
          `,
          db.$queryRaw<{ id: string }[]>`
            SELECT id
            FROM "invoices"
            WHERE "invoiceType" = 'ADJUSTMENT'
              AND "totalAmount" <= 0
          `,
          db.$queryRaw<{ id: string }[]>`
            SELECT id FROM "order_add_ons" WHERE "productId" IS NULL
          `,
          db.$queryRaw<{ id: string }[]>`
            SELECT id FROM "order_package_item_upgrades" WHERE "packageItemId" IS NULL
          `,
          db.$queryRaw<{ id: string }[]>`
            SELECT b.id
            FROM "bookings" b
            JOIN "financial_cases" fc ON fc."bookingId" = b.id
            LEFT JOIN "invoices" dep
              ON dep."financialCaseId" = fc.id
             AND dep."invoiceType" = 'DEPOSIT'
            WHERE b.status IN ('CONFIRMED', 'CHECKED_IN')
            GROUP BY b.id
            HAVING COUNT(dep.id) != 1
          `,
          db.$queryRaw<{ id: string }[]>`
            WITH effective_paid AS (
              SELECT
                i.id,
                COALESCE(SUM(CASE WHEN p.direction = 'OUT' THEN -pa.amount ELSE pa.amount END), 0)
                  + COALESCE((
                    SELECT SUM(da.amount_applied)
                    FROM "document_applications" da
                    WHERE da.target_invoice_id = i.id
                  ), 0) AS effective_paid
              FROM "invoices" i
              LEFT JOIN "payment_allocations" pa ON pa.invoice_id = i.id
              LEFT JOIN "payments" p ON p.id = pa.payment_id
              GROUP BY i.id
            )
            SELECT i.id
            FROM "invoices" i
            JOIN effective_paid ep ON ep.id = i.id
            WHERE i.status != 'CLOSED'
              AND (i."totalAmount" - ep.effective_paid) < 0
          `,
        ]);

        return [
          ...(await expectNoRows(
            "L2",
            "INV-19-final-invoice-has-order",
            "Invoice",
            "FINAL invoice has orderId or FinancialCase job joins to order",
            "FINAL invoice had no order path",
            finalWithoutOrder
          )),
          ...(await expectNoRows(
            "L2",
            "INV-20-adjustment-invoice-amount-positive",
            "Invoice",
            "ADJUSTMENT totalAmount > 0",
            "ADJUSTMENT totalAmount <= 0",
            nonPositiveAdjustments
          )),
          ...(await expectNoRows(
            "L2",
            "INV-21-order-addon-references-product",
            "OrderAddOn",
            "OrderAddOn.productId is present",
            "missing productId",
            addOnsWithoutProduct
          )),
          ...(await expectNoRows(
            "L2",
            "INV-22-order-package-item-upgrade-references-package-item",
            "OrderPackageItemUpgrade",
            "OrderPackageItemUpgrade.packageItemId is present",
            "missing packageItemId",
            upgradesWithoutPackageItem
          )),
          ...(await expectNoRows(
            "L2",
            "INV-23-confirmed-booking-has-one-deposit-invoice",
            "Booking",
            "CONFIRMED/CHECKED_IN bookings have exactly 1 DEPOSIT invoice",
            "missing or duplicate DEPOSIT invoice",
            confirmedWithoutSingleDeposit
          )),
          ...(await expectNoRows(
            "L2",
            "INV-24-open-invoice-balance-not-negative",
            "Invoice",
            "open invoice remaining balance >= 0",
            "negative open balance",
            negativeOpenBalances
          )),
        ];
      },
    },
    {
      code: "INV-25-TO-28",
      description: "Refund traceability, pending lifecycle, and editing payment gate",
      run: async () => {
        const [
          badRefundTrace,
          crossCasePayments,
          pendingFinancialRecords,
          editingOnUnsettledOrders,
        ] = await Promise.all([
          db.$queryRaw<{ id: string }[]>`
            SELECT p.id
            FROM "payments" p
            LEFT JOIN "payments" source ON source.id = p."refundOfPaymentId"
            WHERE p."refundOfPaymentId" IS NOT NULL
              AND (source.id IS NULL OR source.direction != 'IN')
          `,
          db.$queryRaw<{ id: string }[]>`
            SELECT p.id
            FROM "payments" p
            JOIN "invoices" i ON i.id = p."invoiceId"
            WHERE p."financialCaseId" != i."financialCaseId"
          `,
          db.$queryRaw<{ id: string }[]>`
            SELECT b.id
            FROM "bookings" b
            LEFT JOIN "financial_cases" fc ON fc."bookingId" = b.id
            LEFT JOIN "invoices" direct_invoice ON direct_invoice."bookingId" = b.id
            LEFT JOIN "payments" p ON p."financialCaseId" = fc.id
            WHERE b.status = 'PENDING'
              AND (fc.id IS NOT NULL OR direct_invoice.id IS NOT NULL OR p.id IS NOT NULL)
          `,
          db.$queryRaw<{ id: string }[]>`
            SELECT o.id
            FROM "orders" o
            JOIN "editing_jobs" ej ON ej."orderId" = o.id
            LEFT JOIN "invoices" fin
              ON fin."orderId" = o.id
             AND fin."invoiceType" = 'FINAL'
             AND fin."parentInvoiceId" IS NULL
            WHERE ej.status != 'NOT_STARTED'
              AND (fin.id IS NULL OR fin.status != 'CLOSED')
          `,
        ]);

        return [
          ...(await expectNoRows(
            "L2",
            "INV-25-refund-trace-points-to-inbound-payment",
            "Payment",
            "refundOfPaymentId references direction IN payment",
            "bad refund trace",
            badRefundTrace
          )),
          ...(await expectNoRows(
            "L2",
            "INV-26-payment-financial-case-matches-invoice",
            "Payment",
            "payment FinancialCase matches invoice FinancialCase",
            "cross-case payment",
            crossCasePayments
          )),
          ...(await expectNoRows(
            "L2",
            "INV-27-pending-booking-has-no-financial-records",
            "Booking",
            "PENDING bookings have no financial records",
            "PENDING booking has financial records",
            pendingFinancialRecords
          )),
          ...(await expectNoRows(
            "L2",
            "INV-28-editing-cannot-start-on-unsettled-order",
            "Order",
            "editing starts only after FINAL invoice is CLOSED",
            "editing started before FINAL invoice closed",
            editingOnUnsettledOrders
          )),
        ];
      },
    },
  ];
}
