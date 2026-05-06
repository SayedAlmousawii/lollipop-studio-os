CREATE TABLE "studio_departments" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "studio_departments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "studio_departments_code_key" ON "studio_departments"("code");

INSERT INTO "studio_departments" ("id", "name", "code", "isActive", "sortOrder", "createdAt", "updatedAt")
VALUES
  ('dept-newborn', 'Newborn', 'NB', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('dept-kids', 'Kids', 'KD', true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "updatedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "bookings"
  ADD COLUMN "departmentId" TEXT;

UPDATE "bookings"
SET "departmentId" = CASE
  WHEN lower(trim("department")) IN ('newborn', 'new born', 'nb') THEN 'dept-newborn'
  WHEN lower(trim("department")) IN ('kids', 'kid', 'children', 'child', 'kd') THEN 'dept-kids'
  ELSE 'dept-kids'
END;

ALTER TABLE "bookings"
  ALTER COLUMN "departmentId" SET NOT NULL,
  DROP COLUMN "department";

CREATE INDEX "bookings_departmentId_idx" ON "bookings"("departmentId");

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "studio_departments"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
