import { Prisma, type PrismaClient } from "@prisma/client";

export type ReconciliationSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface InvariantViolation {
  invariantId: string;
  severity: ReconciliationSeverity;
  affectedEntityType: string;
  affectedEntityIds: string[];
  description: string;
  detectedAt: Date;
  queryContext: string;
}

export interface ReconciliationReport {
  runAt: Date;
  businessDateStart: Date;
  businessDateEnd: Date;
  invoicesChecked: number;
  paymentsChecked: number;
  allocationsChecked: number;
  applicationsChecked: number;
  violations: InvariantViolation[];
  durationMs: number;
  status: "PASSED" | "VIOLATIONS_DETECTED";
}

export interface ReconciliationAlertPayload {
  text: string;
  channel?: string;
}

type ReconciliationTx = Prisma.TransactionClient;

type ReconciliationQueryRow = {
  entity_id: string;
  affected_entity_ids: string[];
  actual: string;
};

type ReconciliationCounts = {
  invoicesChecked: number;
  paymentsChecked: number;
  allocationsChecked: number;
  applicationsChecked: number;
};

type ReconciliationInvariantDefinition = {
  invariantId: string;
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

type ReconciliationRunContext = {
  runAt: Date;
  businessDateStart: Date;
  businessDateEnd: Date;
};

type ExecuteReconciliationOptions = {
  runAt?: Date;
  businessDateStart?: Date;
  businessDateEnd?: Date;
};

const STUDIO_UTC_OFFSET_MINUTES = 3 * 60;
const MONEY_TOLERANCE_SQL = "0.001";

export function resolvePreviousStudioBusinessDay(runAt: Date): {
  businessDateStart: Date;
  businessDateEnd: Date;
} {
  const offsetMs = STUDIO_UTC_OFFSET_MINUTES * 60_000;
  const studioNow = new Date(runAt.getTime() + offsetMs);
  const previousStudioDay = new Date(
    Date.UTC(
      studioNow.getUTCFullYear(),
      studioNow.getUTCMonth(),
      studioNow.getUTCDate() - 1
    )
  );

  const businessDateStart = new Date(previousStudioDay.getTime() - offsetMs);
  const businessDateEnd = new Date(businessDateStart.getTime() + 24 * 60 * 60_000);

  return { businessDateStart, businessDateEnd };
}

export async function runInReadOnlyReconciliationTransaction<T>(
  client: PrismaClient,
  run: (tx: ReconciliationTx) => Promise<T>
): Promise<T> {
  return client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    return run(tx);
  });
}

export async function executeFinancialReconciliation(
  client: PrismaClient,
  options: ExecuteReconciliationOptions = {}
): Promise<ReconciliationReport> {
  const startedAt = Date.now();
  const runAt = options.runAt ?? new Date();
  const defaultWindow = resolvePreviousStudioBusinessDay(runAt);
  const context: ReconciliationRunContext = {
    runAt,
    businessDateStart: options.businessDateStart ?? defaultWindow.businessDateStart,
    businessDateEnd: options.businessDateEnd ?? defaultWindow.businessDateEnd,
  };

  return runInReadOnlyReconciliationTransaction(client, async (tx) => {
    const counts = await countReconciliationRows(tx);
    const violations = await executeReconciliationInvariants(tx, context);
    const durationMs = Date.now() - startedAt;

    return {
      runAt,
      businessDateStart: context.businessDateStart,
      businessDateEnd: context.businessDateEnd,
      ...counts,
      violations,
      durationMs,
      status: violations.length === 0 ? "PASSED" : "VIOLATIONS_DETECTED",
    };
  });
}

export function buildReconciliationAlertMessages(
  report: ReconciliationReport,
  channel?: string
): ReconciliationAlertPayload[] {
  if (report.violations.length === 0) {
    return [
      {
        channel,
        text: `Reconciliation passed - ${report.invoicesChecked} invoices, ${report.paymentsChecked} payments, ${report.allocationsChecked} allocations, ${report.applicationsChecked} applications checked.`,
      },
    ];
  }

  const counts = countViolationsBySeverity(report.violations);
  const messages: ReconciliationAlertPayload[] = [
    {
      channel,
      text: `Financial reconciliation found ${report.violations.length} violation(s): ${formatSeverityCounts(counts)}.`,
    },
  ];

  const criticals = report.violations.filter(
    (violation) => violation.severity === "CRITICAL"
  );
  if (criticals.length > 0) {
    messages.push({
      channel,
      text: `CRITICAL reconciliation violations detected. Page on-call immediately and block new financial operations until resolved.\n${formatViolationList(criticals)}`,
    });
  }

  const highs = report.violations.filter((violation) => violation.severity === "HIGH");
  if (highs.length > 0) {
    messages.push({
      channel,
      text: `HIGH reconciliation violations detected. Investigate within 24h.\n${formatViolationList(highs)}`,
    });
  }

  const mediums = report.violations.filter(
    (violation) => violation.severity === "MEDIUM"
  );
  if (mediums.length > 0) {
    messages.push({
      channel,
      text: `MEDIUM reconciliation violations detected. Investigate within 48h.\n${formatViolationList(mediums)}`,
    });
  }

  return messages;
}

export async function postReconciliationAlerts(
  report: ReconciliationReport,
  postAlert: (payload: ReconciliationAlertPayload) => Promise<void>,
  channel?: string
): Promise<void> {
  for (const payload of buildReconciliationAlertMessages(report, channel)) {
    await postAlert(payload);
  }
}

async function countReconciliationRows(
  tx: ReconciliationTx
): Promise<ReconciliationCounts> {
  const [invoicesChecked, paymentsChecked, allocationsChecked, applicationsChecked] =
    await Promise.all([
      tx.invoice.count(),
      tx.payment.count(),
      tx.paymentAllocation.count(),
      tx.documentApplication.count(),
    ]);

  return {
    invoicesChecked,
    paymentsChecked,
    allocationsChecked,
    applicationsChecked,
  };
}

async function executeReconciliationInvariants(
  tx: ReconciliationTx,
  context: ReconciliationRunContext
): Promise<InvariantViolation[]> {
  const detectedAt = context.runAt;
  const violations: InvariantViolation[] = [];

  for (const invariant of RECONCILIATION_INVARIANTS) {
    const rows = await invariant.run(tx, context);
    for (const row of rows) {
      violations.push({
        invariantId: invariant.invariantId,
        severity: invariant.severity,
        affectedEntityType: invariant.affectedEntityType,
        affectedEntityIds:
          row.affected_entity_ids.length > 0
            ? row.affected_entity_ids
            : [row.entity_id],
        description: `${invariant.description}: expected ${invariant.expected}; actual ${row.actual}.`,
        detectedAt,
        queryContext: invariant.queryContext,
      });
    }
  }

  return violations;
}

const RECONCILIATION_INVARIANTS: ReconciliationInvariantDefinition[] = [
  {
    invariantId: "INV-01",
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
    severity: "HIGH",
    affectedEntityType: "Order",
    description: "FinancialCase invoice totals must reconcile to current order totals",
    expected: "FINAL + ADJUSTMENT - CREDIT_NOTE equals current order package/add-on total",
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
                WHEN i."invoiceType" = 'CREDIT_NOTE' THEN -i."totalAmount"
                ELSE 0
              END
            ) AS actual_total
          FROM "invoices" i
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

function countViolationsBySeverity(
  violations: InvariantViolation[]
): Record<ReconciliationSeverity, number> {
  return violations.reduce<Record<ReconciliationSeverity, number>>(
    (counts, violation) => {
      counts[violation.severity] += 1;
      return counts;
    },
    { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }
  );
}

function formatSeverityCounts(
  counts: Record<ReconciliationSeverity, number>
): string {
  return `CRITICAL=${counts.CRITICAL}, HIGH=${counts.HIGH}, MEDIUM=${counts.MEDIUM}, LOW=${counts.LOW}`;
}

function formatViolationList(violations: InvariantViolation[]): string {
  return violations
    .slice(0, 10)
    .map(
      (violation) =>
        `- ${violation.invariantId} ${violation.affectedEntityType} ${violation.affectedEntityIds.join(", ")}: ${violation.description}`
    )
    .join("\n");
}
