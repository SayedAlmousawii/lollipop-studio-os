DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "orders" o
    JOIN "jobs" j ON j."id" = o."jobId"
    WHERE o."jobNumber" <> j."jobNumber"
  ) THEN
    RAISE EXCEPTION 'Downstream job validation failed: one or more orders have a jobId/jobNumber mismatch';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "invoices" i
    JOIN "jobs" j ON j."id" = i."jobId"
    LEFT JOIN "orders" o ON o."id" = i."orderId"
    LEFT JOIN "bookings" b ON b."id" = i."bookingId"
    WHERE i."jobNumber" <> j."jobNumber"
      OR (o."jobId" IS NOT NULL AND i."jobId" <> o."jobId")
      OR (b."jobId" IS NOT NULL AND i."jobId" <> b."jobId")
  ) THEN
    RAISE EXCEPTION 'Downstream job validation failed: one or more invoices have inconsistent job ownership';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "payments" p
    JOIN "jobs" j ON j."id" = p."jobId"
    LEFT JOIN "invoices" i ON i."id" = p."invoiceId"
    WHERE p."jobNumber" <> j."jobNumber"
      OR i."jobId" IS NULL
      OR p."jobId" <> i."jobId"
  ) THEN
    RAISE EXCEPTION 'Downstream job validation failed: one or more payments have inconsistent job ownership';
  END IF;
END;
$$;
