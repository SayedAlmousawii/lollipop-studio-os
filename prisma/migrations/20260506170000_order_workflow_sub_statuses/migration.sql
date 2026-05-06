CREATE TYPE "OrderSelectionStatus" AS ENUM (
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED'
);

CREATE TYPE "OrderEditingStatus" AS ENUM (
  'NOT_STARTED',
  'ASSIGNED',
  'IN_PROGRESS',
  'REVISION_REQUESTED',
  'AWAITING_APPROVAL',
  'APPROVED',
  'COMPLETED'
);

CREATE TYPE "OrderProductionStatus" AS ENUM (
  'NOT_STARTED',
  'WAITING_FOR_EDITING',
  'IN_PROGRESS',
  'WAITING_FOR_VENDOR',
  'READY_FOR_PICKUP',
  'COMPLETED'
);

CREATE TYPE "OrderDeliveryStatus" AS ENUM (
  'NOT_READY',
  'READY_FOR_PICKUP',
  'CUSTOMER_NOTIFIED',
  'PICKED_UP',
  'COMPLETED'
);

ALTER TABLE "orders"
  ADD COLUMN "selectionStatus" "OrderSelectionStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "editingStatus" "OrderEditingStatus" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "productionStatus" "OrderProductionStatus" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "deliveryStatus" "OrderDeliveryStatus" NOT NULL DEFAULT 'NOT_READY';

UPDATE "orders"
SET
  "selectionStatus" = CASE
    WHEN "status" IN ('EDITING', 'PRODUCTION', 'READY', 'DELIVERED') THEN 'COMPLETED'::"OrderSelectionStatus"
    WHEN "status" = 'WAITING_SELECTION' THEN 'IN_PROGRESS'::"OrderSelectionStatus"
    ELSE "selectionStatus"
  END,
  "editingStatus" = CASE
    WHEN "status" IN ('PRODUCTION', 'READY', 'DELIVERED') THEN 'COMPLETED'::"OrderEditingStatus"
    WHEN "status" = 'EDITING' THEN 'IN_PROGRESS'::"OrderEditingStatus"
    ELSE "editingStatus"
  END,
  "productionStatus" = CASE
    WHEN "status" IN ('READY', 'DELIVERED') THEN 'COMPLETED'::"OrderProductionStatus"
    WHEN "status" = 'PRODUCTION' THEN 'IN_PROGRESS'::"OrderProductionStatus"
    WHEN "status" = 'EDITING' THEN 'WAITING_FOR_EDITING'::"OrderProductionStatus"
    ELSE "productionStatus"
  END,
  "deliveryStatus" = CASE
    WHEN "status" = 'DELIVERED' THEN 'COMPLETED'::"OrderDeliveryStatus"
    WHEN "status" = 'READY' THEN 'READY_FOR_PICKUP'::"OrderDeliveryStatus"
    ELSE "deliveryStatus"
  END;
