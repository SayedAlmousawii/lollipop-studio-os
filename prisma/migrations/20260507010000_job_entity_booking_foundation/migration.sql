CREATE TABLE "jobs" (
  "id" TEXT NOT NULL,
  "jobNumber" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "jobs_jobNumber_key" ON "jobs"("jobNumber");
CREATE INDEX "jobs_customerId_idx" ON "jobs"("customerId");

ALTER TABLE "bookings"
  ADD COLUMN "jobId" TEXT;

INSERT INTO "jobs" ("id", "jobNumber", "customerId", "createdAt", "updatedAt")
SELECT
  'job_' || "id",
  "jobNumber",
  "customerId",
  "createdAt",
  "updatedAt"
FROM "bookings";

UPDATE "bookings"
SET "jobId" = "jobs"."id"
FROM "jobs"
WHERE "jobs"."jobNumber" = "bookings"."jobNumber";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "bookings"
    WHERE "jobId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot backfill bookings.jobId because one or more bookings did not map to a canonical job';
  END IF;
END;
$$;

ALTER TABLE "bookings"
  ALTER COLUMN "jobId" SET NOT NULL;

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "jobs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "bookings_jobId_key" ON "bookings"("jobId");

CREATE TRIGGER "jobs_jobNumber_immutable"
BEFORE UPDATE OF "jobNumber" ON "jobs"
FOR EACH ROW EXECUTE FUNCTION prevent_job_number_update();
