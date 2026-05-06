DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "bookings"
    GROUP BY "jobNumber"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create unique bookings.jobNumber index while duplicate booking job numbers exist';
  END IF;
END;
$$;

DROP INDEX IF EXISTS "bookings_jobNumber_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "bookings_jobNumber_key" ON "bookings"("jobNumber");
