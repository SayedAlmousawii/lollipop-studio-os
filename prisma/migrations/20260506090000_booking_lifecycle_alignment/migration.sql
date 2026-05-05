-- Align booking lifecycle so invoices can exist before orders and deposit truth
-- is derived from payments instead of a booking boolean.

ALTER TABLE "bookings"
ADD COLUMN "department" TEXT;

UPDATE "bookings"
SET "department" = 'General'
WHERE "department" IS NULL;

ALTER TABLE "bookings"
ALTER COLUMN "department" SET NOT NULL,
ADD COLUMN "assignedPhotographerId" TEXT;

ALTER TABLE "bookings"
ADD CONSTRAINT "bookings_assignedPhotographerId_fkey"
FOREIGN KEY ("assignedPhotographerId") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bookings"
DROP COLUMN "depositPaid";

CREATE TABLE "booking_themes" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "themeName" TEXT NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "booking_themes_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "booking_themes"
ADD CONSTRAINT "booking_themes_bookingId_fkey"
FOREIGN KEY ("bookingId") REFERENCES "bookings"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "booking_themes_bookingId_idx" ON "booking_themes"("bookingId");

ALTER TABLE "invoices"
ALTER COLUMN "orderId" DROP NOT NULL,
ADD COLUMN "bookingId" TEXT;

ALTER TABLE "invoices"
ADD CONSTRAINT "invoices_bookingId_fkey"
FOREIGN KEY ("bookingId") REFERENCES "bookings"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
