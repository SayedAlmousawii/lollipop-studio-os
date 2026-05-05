ALTER TABLE "booking_themes"
DROP CONSTRAINT "booking_themes_bookingId_fkey";

ALTER TABLE "booking_themes"
ADD CONSTRAINT "booking_themes_bookingId_fkey"
FOREIGN KEY ("bookingId") REFERENCES "bookings"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "booking_themes_bookingId_idx"
ON "booking_themes"("bookingId");
