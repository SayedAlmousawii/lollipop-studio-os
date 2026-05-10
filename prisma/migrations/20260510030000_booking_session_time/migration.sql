ALTER TABLE "bookings"
ADD COLUMN "sessionTime" TEXT;

UPDATE "bookings"
SET "sessionTime" = COALESCE(
  TO_CHAR("sessionDate" AT TIME ZONE 'UTC', 'HH24:MI'),
  '00:00'
);

ALTER TABLE "bookings"
ALTER COLUMN "sessionTime" SET NOT NULL;
