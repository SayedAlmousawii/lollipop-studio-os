import type { PrismaClient } from "@prisma/client";
import { INVARIANT_CATALOG } from "@/modules/financial/invariant-catalog";
import type {
  ReconciliationRunContext,
  ReconciliationSeverity,
  ReconciliationTx,
} from "@/modules/financial/reconciliation-invariants";

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

type ReconciliationCounts = {
  invoicesChecked: number;
  paymentsChecked: number;
  allocationsChecked: number;
  applicationsChecked: number;
};

type ExecuteReconciliationOptions = {
  runAt?: Date;
  businessDateStart?: Date;
  businessDateEnd?: Date;
};

const STUDIO_UTC_OFFSET_MINUTES = 3 * 60;

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

  for (const invariant of INVARIANT_CATALOG) {
    if (invariant.kind !== "reconciliation") {
      continue;
    }

    const rows = await invariant.run(tx, context);
    for (const row of rows) {
      violations.push({
        invariantId: invariant.id,
        severity: invariant.reconciliation.severity,
        affectedEntityType: invariant.reconciliation.affectedEntityType,
        affectedEntityIds:
          row.affected_entity_ids.length > 0
            ? row.affected_entity_ids
            : [row.entity_id],
        description: `${invariant.description}: expected ${invariant.reconciliation.expected}; actual ${row.actual}.`,
        detectedAt,
        queryContext: invariant.reconciliation.queryContext,
      });
    }
  }

  return violations;
}

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
