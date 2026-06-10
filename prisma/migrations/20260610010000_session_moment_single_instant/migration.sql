TRUNCATE TABLE "bookings" CASCADE;

ALTER TABLE "bookings"
DROP COLUMN "sessionDate",
DROP COLUMN "sessionTime",
ADD COLUMN "sessionStartsAt" TIMESTAMP(3) NOT NULL;

CREATE INDEX "bookings_sessionStartsAt_idx" ON "bookings"("sessionStartsAt");
