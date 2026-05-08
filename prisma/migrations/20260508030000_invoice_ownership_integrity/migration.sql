UPDATE "invoices" i
SET "bookingId" = o."bookingId"
FROM "orders" o
WHERE i."orderId" = o."id"
  AND i."bookingId" IS NULL;

UPDATE "invoices" i
SET "orderId" = o."id"
FROM "orders" o
WHERE i."bookingId" = o."bookingId"
  AND i."jobId" = o."jobId"
  AND i."orderId" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "invoices" i
    JOIN "jobs" j ON j."id" = i."jobId"
    WHERE i."customerId" <> j."customerId"
  ) THEN
    RAISE EXCEPTION 'Invoice ownership validation failed: one or more invoices have a customerId that does not match their canonical job';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "invoices" i
    JOIN "bookings" b ON b."id" = i."bookingId"
    WHERE i."jobId" <> b."jobId"
      OR i."customerId" <> b."customerId"
  ) THEN
    RAISE EXCEPTION 'Invoice ownership validation failed: one or more booking-linked invoices have inconsistent job/customer ownership';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "invoices" i
    JOIN "orders" o ON o."id" = i."orderId"
    WHERE i."bookingId" IS NULL
      OR i."bookingId" <> o."bookingId"
      OR i."jobId" <> o."jobId"
      OR i."customerId" <> o."customerId"
  ) THEN
    RAISE EXCEPTION 'Invoice ownership validation failed: one or more order-linked invoices have inconsistent booking/job/customer ownership';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "invoices" child
    JOIN "invoices" parent ON parent."id" = child."parentInvoiceId"
    WHERE child."jobId" <> parent."jobId"
      OR child."customerId" <> parent."customerId"
      OR child."bookingId" IS DISTINCT FROM parent."bookingId"
      OR child."orderId" IS DISTINCT FROM parent."orderId"
  ) THEN
    RAISE EXCEPTION 'Invoice ownership validation failed: one or more adjustment invoices do not inherit parent ownership context';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "invoices"
    WHERE "parentInvoiceId" IS NULL
      AND "bookingId" IS NOT NULL
    GROUP BY "bookingId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Invoice ownership validation failed: one or more bookings have duplicate primary workflow invoices';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "invoices"
    WHERE "parentInvoiceId" IS NULL
      AND "orderId" IS NOT NULL
    GROUP BY "orderId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Invoice ownership validation failed: one or more orders have duplicate primary workflow invoices';
  END IF;
END;
$$;

ALTER TABLE "invoices" DROP CONSTRAINT "invoices_orderId_jobId_fkey";
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_bookingId_jobId_fkey";
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_jobId_fkey";

CREATE UNIQUE INDEX "jobs_id_customerId_key" ON "jobs"("id", "customerId");
CREATE UNIQUE INDEX "bookings_id_jobId_customerId_key" ON "bookings"("id", "jobId", "customerId");
CREATE UNIQUE INDEX "orders_id_bookingId_jobId_customerId_key" ON "orders"("id", "bookingId", "jobId", "customerId");

CREATE UNIQUE INDEX "invoices_primary_booking_context_key"
  ON "invoices"("bookingId")
  WHERE "parentInvoiceId" IS NULL
    AND "bookingId" IS NOT NULL;

CREATE UNIQUE INDEX "invoices_primary_order_context_key"
  ON "invoices"("orderId")
  WHERE "parentInvoiceId" IS NULL
    AND "orderId" IS NOT NULL;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_order_context_requires_booking_check"
  CHECK ("orderId" IS NULL OR "bookingId" IS NOT NULL);

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_jobId_customerId_fkey"
  FOREIGN KEY ("jobId", "customerId") REFERENCES "jobs"("id", "customerId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_bookingId_jobId_customerId_fkey"
  FOREIGN KEY ("bookingId", "jobId", "customerId") REFERENCES "bookings"("id", "jobId", "customerId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_orderId_bookingId_jobId_customerId_fkey"
  FOREIGN KEY ("orderId", "bookingId", "jobId", "customerId") REFERENCES "orders"("id", "bookingId", "jobId", "customerId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
