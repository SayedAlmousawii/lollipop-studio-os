CREATE TYPE "OrderActivityType" AS ENUM (
  'ORDER_CREATED',
  'PACKAGE_CHANGED',
  'ADD_ON_CHANGED',
  'PAYMENT_RECEIVED',
  'INVOICE_ADJUSTED',
  'SELECTION_UPDATED',
  'SELECTION_COMPLETED',
  'EDITOR_ASSIGNED',
  'EDITING_STATUS_CHANGED',
  'PRODUCTION_STATUS_CHANGED',
  'DELIVERY_STATUS_CHANGED',
  'ORDER_COMPLETED',
  'NOTE_ADDED'
);

CREATE TABLE "order_activities" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "userId" TEXT,
  "type" "OrderActivityType" NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "order_activities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_activities_orderId_createdAt_idx"
  ON "order_activities"("orderId", "createdAt");

CREATE INDEX "order_activities_type_idx"
  ON "order_activities"("type");

ALTER TABLE "order_activities"
  ADD CONSTRAINT "order_activities_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_activities"
  ADD CONSTRAINT "order_activities_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
