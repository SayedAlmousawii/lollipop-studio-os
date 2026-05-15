-- CreateEnum
CREATE TYPE "AuditEntityType" AS ENUM ('INVOICE', 'PAYMENT', 'ORDER', 'BOOKING', 'FINANCIAL_CASE', 'CREDIT_NOTE', 'REFUND');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('INVOICE_LOCKED', 'INVOICE_TOTAL_MUTATED', 'PAYMENT_RECORDED', 'PAYMENT_REFUNDED', 'CREDIT_NOTE_ISSUED', 'ADJUSTMENT_ISSUED', 'REFUND_ISSUED', 'BOOKING_CONFIRMED', 'BOOKING_NO_SHOW', 'ORDER_LOCKED_FIELD_MUTATED');

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "entityType" "AuditEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "context" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_occurredAt_idx" ON "audit_logs"("entityType", "entityId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_occurredAt_idx" ON "audit_logs"("actorUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_occurredAt_idx" ON "audit_logs"("action", "occurredAt");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
