import { Prisma } from "@prisma/client";

export type ReconciliationSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type ReconciliationTx = Prisma.TransactionClient;

export type ReconciliationQueryRow = {
  entity_id: string;
  affected_entity_ids: string[];
  actual: string;
};

export type ReconciliationRunContext = {
  runAt: Date;
  businessDateStart: Date;
  businessDateEnd: Date;
};

export type ReconciliationInvariantDefinition = {
  invariantId: string;
  name: string;
  severity: ReconciliationSeverity;
  affectedEntityType: string;
  description: string;
  expected: string;
  queryContext: string;
  run: (
    tx: ReconciliationTx,
    context: ReconciliationRunContext
  ) => Promise<ReconciliationQueryRow[]>;
};

const MONEY_TOLERANCE_SQL = "0.001";

export const RECONCILIATION_INVARIANTS: readonly ReconciliationInvariantDefinition[] = [
  {
    invariantId: "INV-01",
    name: "payment-allocation-count",
    severity: "CRITICAL",
    affectedEntityType: "Payment",
    description: "Every Payment must have exactly one PaymentAllocation",
    expected: "1 PaymentAllocation",
    queryContext: "payments left joined to payment_allocations grouped by payment",
    run: (tx) =>
      tx.$queryRaw<ReconciliationQueryRow[]>`
        SELECT
          p.id AS entity_id,
          ARRAY[p.id] AS affected_entity_ids,
          COUNT(pa.id)::text AS actual
        FROM "payments" p
        LEFT JOIN "payment_allocations" pa ON pa.payment_id = p.id
        GROUP BY p.id
        HAVING COUNT(pa.id) != 1
      `,
  },
  {
    invariantId: "INV-08",
    name: "adjustment-parent-not-adjustment",
    severity: "HIGH",
    affectedEntityType: "Invoice",
    description: "ADJUSTMENT invoices must not chain to ADJUSTMENT parents",
    expected: "parent invoice type FINAL",
    queryContext: "adjustment invoices joined to parent invoices",
    run: (tx) =>
      tx.$queryRaw<ReconciliationQueryRow[]>`
        SELECT
          child.id AS entity_id,
          ARRAY[child.id, parent.id] AS affected_entity_ids,
          ('parent ' || parent.id || ' is ' || parent."invoiceType") AS actual
        FROM "invoices" child
        JOIN "invoices" parent ON parent.id = child."parentInvoiceId"
        WHERE child."invoiceType" = 'ADJUSTMENT'
          AND parent."invoiceType" = 'ADJUSTMENT'
      `,
  },
  {
    invariantId: "INV-09",
    name: "credit-note-application-target",
    severity: "HIGH",
    affectedEntityType: "DocumentApplication",
    description: "CREDIT_NOTE document applications must target FINAL invoices or ADJUSTMENT lines",
    expected: "target invoice type FINAL or line-targeted ADJUSTMENT",
    queryContext: "document_applications joined to source and target invoices",
    run: (tx) =>
      tx.$queryRaw<ReconciliationQueryRow[]>`
        SELECT
          da.id AS entity_id,
          ARRAY[da.id, source.id, target.id] AS affected_entity_ids,
          ('target invoice type ' || target."invoiceType") AS actual
        FROM "document_applications" da
        JOIN "invoices" source ON source.id = da.source_invoice_id
        JOIN "invoices" target ON target.id = da.target_invoice_id
        WHERE source."invoiceType" = 'CREDIT_NOTE'
          AND NOT (
            target."invoiceType" = 'FINAL'
            OR (
              target."invoiceType" = 'ADJUSTMENT'
              AND da.target_invoice_line_id IS NOT NULL
            )
          )
      `,
  },
  {
    invariantId: "INV-11",
    name: "refund-payment-direction",
    severity: "HIGH",
    affectedEntityType: "Payment",
    description: "REFUND invoice payments must use OUT direction",
    expected: "payment direction OUT",
    queryContext: "payments joined to invoices where invoiceType=REFUND",
    run: (tx) =>
      tx.$queryRaw<ReconciliationQueryRow[]>`
        SELECT
          p.id AS entity_id,
          ARRAY[p.id, i.id] AS affected_entity_ids,
          ('payment direction ' || p.direction) AS actual
        FROM "payments" p
        JOIN "invoices" i ON i.id = p."invoiceId"
        WHERE i."invoiceType" = 'REFUND'
          AND p.direction != 'OUT'
      `,
  },
  {
    invariantId: "INV-15",
    name: "deposit-invoice-closed-locked",
    severity: "CRITICAL",
    affectedEntityType: "Invoice",
    description: "DEPOSIT invoices must be closed and locked",
    expected: "status CLOSED and isLocked=true",
    queryContext: "deposit invoices filtered by status and lock state",
    run: (tx) =>
      tx.$queryRaw<ReconciliationQueryRow[]>`
        SELECT
          id AS entity_id,
          ARRAY[id] AS affected_entity_ids,
          ('status=' || status || ', isLocked=' || "isLocked"::text) AS actual
        FROM "invoices"
        WHERE "invoiceType" = 'DEPOSIT'
          AND (status != 'CLOSED' OR "isLocked" = false)
      `,
  },
  {
    invariantId: "INV-16",
    name: "payment-allocation-references-exist",
    severity: "CRITICAL",
    affectedEntityType: "PaymentAllocation",
    description: "PaymentAllocation rows must reference existing payments and invoices",
    expected: "existing Payment and Invoice",
    queryContext: "payment_allocations left joined to payments and invoices",
    run: (tx) =>
      tx.$queryRaw<ReconciliationQueryRow[]>`
        SELECT
          pa.id AS entity_id,
          ARRAY_REMOVE(ARRAY[pa.id, p.id, i.id], NULL) AS affected_entity_ids,
          CASE
            WHEN p.id IS NULL AND i.id IS NULL THEN 'missing payment and invoice'
            WHEN p.id IS NULL THEN 'missing payment'
            ELSE 'missing invoice'
          END AS actual
        FROM "payment_allocations" pa
        LEFT JOIN "payments" p ON p.id = pa.payment_id
        LEFT JOIN "invoices" i ON i.id = pa.invoice_id
        WHERE p.id IS NULL OR i.id IS NULL
      `,
  },
  {
    invariantId: "INV-17",
    name: "document-application-references-exist",
    severity: "CRITICAL",
    affectedEntityType: "DocumentApplication",
    description: "DocumentApplication rows must reference existing source and target invoices",
    expected: "existing source and target invoices",
    queryContext: "document_applications left joined to source and target invoices",
    run: (tx) =>
      tx.$queryRaw<ReconciliationQueryRow[]>`
        SELECT
          da.id AS entity_id,
          ARRAY_REMOVE(ARRAY[da.id, source.id, target.id], NULL) AS affected_entity_ids,
          CASE
            WHEN source.id IS NULL AND target.id IS NULL THEN 'missing source and target invoice'
            WHEN source.id IS NULL THEN 'missing source invoice'
            ELSE 'missing target invoice'
          END AS actual
        FROM "document_applications" da
        LEFT JOIN "invoices" source ON source.id = da.source_invoice_id
        LEFT JOIN "invoices" target ON target.id = da.target_invoice_id
        WHERE source.id IS NULL OR target.id IS NULL
      `,
  },
  {
    invariantId: "INV-18",
    name: "order-composition-equals-revenue-documents",
    severity: "HIGH",
    affectedEntityType: "Order",
    description: "FinancialCase invoice totals must reconcile to current order totals",
    expected:
      "FINAL + ADJUSTMENT - non-goodwill CREDIT_NOTE equals current order package/add-on total",
    queryContext: "orders joined through financial_cases, invoices, order_packages, add-ons, upgrades, and extra-photo pricing",
    run: (tx) =>
      tx.$queryRaw<ReconciliationQueryRow[]>`
        WITH package_totals AS (
          SELECT
            op."orderId" AS order_id,
            SUM(COALESCE(op."finalPackagePriceSnapshot", p.price)) AS total
          FROM "order_packages" op
          JOIN "packages" p ON p.id = op."packageId"
          GROUP BY op."orderId"
        ),
        extra_photo_totals AS (
          SELECT
            op."orderId" AS order_id,
            SUM(
              op."extraDigitalCount" * COALESCE(digital."unitPrice", 0)
              + op."extraPrintCount" * COALESCE(print."unitPrice", 0)
            ) AS total
          FROM "order_packages" op
          LEFT JOIN "session_type_extra_photo_pricing" digital
            ON digital."sessionTypeId" = op."sessionTypeId"
           AND digital."mediaType" = 'DIGITAL'
          LEFT JOIN "session_type_extra_photo_pricing" print
            ON print."sessionTypeId" = op."sessionTypeId"
           AND print."mediaType" = 'PRINT'
          GROUP BY op."orderId"
        ),
        add_on_totals AS (
          SELECT
            "orderId" AS order_id,
            SUM("priceSnapshot" * quantity) AS total
          FROM "order_add_ons"
          GROUP BY "orderId"
        ),
        upgrade_totals AS (
          SELECT
            "orderId" AS order_id,
            SUM("priceSnapshot" * quantity) AS total
          FROM "order_package_item_upgrades"
          GROUP BY "orderId"
        ),
        expected_orders AS (
          SELECT
            o.id AS order_id,
            fc.id AS financial_case_id,
            COALESCE(package_totals.total, 0)
              + COALESCE(extra_photo_totals.total, 0)
              + COALESCE(add_on_totals.total, 0)
              + COALESCE(upgrade_totals.total, 0) AS expected_total
          FROM "orders" o
          JOIN "financial_cases" fc ON fc."bookingId" = o."bookingId"
          LEFT JOIN package_totals ON package_totals.order_id = o.id
          LEFT JOIN extra_photo_totals ON extra_photo_totals.order_id = o.id
          LEFT JOIN add_on_totals ON add_on_totals.order_id = o.id
          LEFT JOIN upgrade_totals ON upgrade_totals.order_id = o.id
          WHERE o.status != 'CANCELLED'
        ),
        actual_cases AS (
          SELECT
            i."financialCaseId" AS financial_case_id,
            SUM(
              CASE
                WHEN i."invoiceType" IN ('FINAL', 'ADJUSTMENT') THEN i."totalAmount"
                WHEN i."invoiceType" = 'CREDIT_NOTE' THEN -(
                  GREATEST(
                    i."totalAmount" - COALESCE(goodwill_credit_applications.total, 0),
                    0
                  )
                )
                ELSE 0
              END
            ) AS actual_total
          FROM "invoices" i
          LEFT JOIN (
            -- Null-target CREDIT_NOTE applications are goodwill unless they came
            -- from the classifier reduction path; those credits match real order
            -- composition reductions and must stay visible to INV-18.
            SELECT
              da.source_invoice_id AS invoice_id,
              SUM(da.amount_applied) AS total
            FROM "document_applications" da
            JOIN "invoices" source ON source.id = da.source_invoice_id
            WHERE source."invoiceType" = 'CREDIT_NOTE'
              AND da.target_invoice_line_id IS NULL
              AND NOT EXISTS (
                SELECT 1
                FROM "order_activities" oa
                WHERE oa.title = 'Classifier reduction credit note issued'
                  AND oa.metadata->>'creditNoteInvoiceId' = source.id
              )
            GROUP BY da.source_invoice_id
          ) goodwill_credit_applications
            ON goodwill_credit_applications.invoice_id = i.id
          GROUP BY i."financialCaseId"
        )
        SELECT
          expected_orders.order_id AS entity_id,
          ARRAY[expected_orders.order_id, expected_orders.financial_case_id] AS affected_entity_ids,
          (
            'expected=' || ROUND(expected_orders.expected_total, 3)::text
            || ', actual=' || ROUND(COALESCE(actual_cases.actual_total, 0), 3)::text
          ) AS actual
        FROM expected_orders
        LEFT JOIN actual_cases ON actual_cases.financial_case_id = expected_orders.financial_case_id
        WHERE ABS(expected_orders.expected_total - COALESCE(actual_cases.actual_total, 0)) > ${new Prisma.Decimal(MONEY_TOLERANCE_SQL)}
      `,
  },
  {
    invariantId: "INV-19",
    name: "final-invoice-resolves-to-order",
    severity: "HIGH",
    affectedEntityType: "Invoice",
    description: "FINAL invoices must resolve to an order",
    expected: "direct orderId or FinancialCase job order",
    queryContext: "final invoices left joined to direct order and financial-case job order",
    run: (tx) =>
      tx.$queryRaw<ReconciliationQueryRow[]>`
        SELECT
          i.id AS entity_id,
          ARRAY[i.id] AS affected_entity_ids,
          'no order path' AS actual
        FROM "invoices" i
        LEFT JOIN "orders" direct_order ON direct_order.id = i."orderId"
        LEFT JOIN "financial_cases" fc ON fc.id = i."financialCaseId"
        LEFT JOIN "orders" case_job_order ON case_job_order."jobId" = fc."jobId"
        WHERE i."invoiceType" = 'FINAL'
          AND direct_order.id IS NULL
          AND case_job_order.id IS NULL
      `,
  },
  {
    invariantId: "INV-24",
    name: "open-invoice-effective-paid-cap",
    severity: "CRITICAL",
    affectedEntityType: "Invoice",
    description: "Open invoice effective paid amount must not exceed total amount",
    expected: "effective paid <= total amount",
    queryContext: "open invoices joined to allocation and document-application effective-paid totals",
    run: (tx) =>
      tx.$queryRaw<ReconciliationQueryRow[]>`
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
        SELECT
          i.id AS entity_id,
          ARRAY[i.id] AS affected_entity_ids,
          ('effectivePaid=' || ROUND(ep.effective_paid, 3)::text || ', total=' || i."totalAmount"::text) AS actual
        FROM "invoices" i
        JOIN effective_paid ep ON ep.id = i.id
        WHERE i.status != 'CLOSED'
          AND ep.effective_paid > i."totalAmount"
      `,
  },
  {
    invariantId: "INV-25",
    name: "fully-paid-final-invoice-closed-locked",
    severity: "CRITICAL",
    affectedEntityType: "Invoice",
    description: "Fully paid FINAL invoices must be closed and locked",
    expected: "remainingAmount=0 with status CLOSED and isLocked=true",
    queryContext: "final invoices filtered by zero remaining balance, status, and lock state",
    run: (tx) =>
      tx.$queryRaw<ReconciliationQueryRow[]>`
        SELECT
          id AS entity_id,
          ARRAY[id] AS affected_entity_ids,
          ('status=' || status || ', isLocked=' || "isLocked"::text) AS actual
        FROM "invoices"
        WHERE "invoiceType" = 'FINAL'
          AND "remainingAmount" = 0
          AND (status != 'CLOSED' OR "isLocked" = false)
      `,
  },
  {
    invariantId: "INV-PREFIX",
    name: "invoice-number-prefix-matches-type",
    severity: "MEDIUM",
    affectedEntityType: "Invoice",
    description: "Invoice number prefix must match invoice type",
    expected: "DEP/INV/ADJ/REF/CN/SALE prefix by invoice type",
    queryContext: "invoices filtered by invoiceType-specific invoiceNumber prefix",
    run: (tx) =>
      tx.$queryRaw<ReconciliationQueryRow[]>`
        SELECT
          id AS entity_id,
          ARRAY[id] AS affected_entity_ids,
          ('invoiceType=' || "invoiceType" || ', invoiceNumber=' || "invoiceNumber") AS actual
        FROM "invoices"
        WHERE "invoiceNumber" NOT LIKE (
          CASE "invoiceType"
            WHEN 'DEPOSIT' THEN 'DEP'
            WHEN 'FINAL' THEN 'INV'
            WHEN 'ADJUSTMENT' THEN 'ADJ'
            WHEN 'REFUND' THEN 'REF'
            WHEN 'CREDIT_NOTE' THEN 'CN'
            WHEN 'SALE' THEN 'SALE'
          END || '-%'
        )
      `,
  },
  {
    invariantId: "INV-REV",
    name: "completed-order-revenue-reconciles",
    severity: "CRITICAL",
    affectedEntityType: "Order",
    description: "Completed-order inbound revenue must reconcile to expected invoice revenue for the business day",
    expected: "IN payments equal FINAL + ADJUSTMENT - CREDIT_NOTE for orders completed in the business day",
    queryContext: "delivered orders in business-day window joined to financial cases, payments, and revenue documents",
    run: (tx, context) =>
      tx.$queryRaw<ReconciliationQueryRow[]>`
        WITH completed_orders AS (
          SELECT o.id AS order_id, fc.id AS financial_case_id
          FROM "orders" o
          JOIN "financial_cases" fc ON fc."bookingId" = o."bookingId"
          WHERE o."deliveryCompletedAt" >= ${context.businessDateStart}
            AND o."deliveryCompletedAt" < ${context.businessDateEnd}
            AND o."deliveryStatus" = 'COMPLETED'
        ),
        inbound_payments AS (
          SELECT
            p."financialCaseId" AS financial_case_id,
            SUM(p.amount) AS actual_revenue
          FROM "payments" p
          WHERE p.direction = 'IN'
          GROUP BY p."financialCaseId"
        ),
        expected_documents AS (
          SELECT
            i."financialCaseId" AS financial_case_id,
            SUM(
              CASE
                WHEN i."invoiceType" IN ('FINAL', 'ADJUSTMENT') THEN i."totalAmount"
                WHEN i."invoiceType" = 'CREDIT_NOTE' THEN -i."totalAmount"
                ELSE 0
              END
            ) AS expected_revenue
          FROM "invoices" i
          GROUP BY i."financialCaseId"
        )
        SELECT
          completed_orders.order_id AS entity_id,
          ARRAY[completed_orders.order_id, completed_orders.financial_case_id] AS affected_entity_ids,
          (
            'expected=' || ROUND(COALESCE(expected_documents.expected_revenue, 0), 3)::text
            || ', actual=' || ROUND(COALESCE(inbound_payments.actual_revenue, 0), 3)::text
          ) AS actual
        FROM completed_orders
        LEFT JOIN inbound_payments
          ON inbound_payments.financial_case_id = completed_orders.financial_case_id
        LEFT JOIN expected_documents
          ON expected_documents.financial_case_id = completed_orders.financial_case_id
        WHERE ABS(
          COALESCE(expected_documents.expected_revenue, 0)
          - COALESCE(inbound_payments.actual_revenue, 0)
        ) > ${new Prisma.Decimal(MONEY_TOLERANCE_SQL)}
      `,
  },
];
