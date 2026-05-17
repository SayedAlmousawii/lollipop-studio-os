-- Add admin-managed calendar display fields to session types.
ALTER TABLE "session_types"
  ADD COLUMN "calendarLabel" TEXT,
  ADD COLUMN "calendarColor" TEXT;

UPDATE "session_types"
SET
  "calendarLabel" = CASE
    WHEN "code" = 'KD_FAMILY' THEN 'Family'
    WHEN "departmentId" IN (
      SELECT "id" FROM "studio_departments" WHERE "code" = 'NB'
    ) THEN 'Newborn'
    WHEN "departmentId" IN (
      SELECT "id" FROM "studio_departments" WHERE "code" = 'KD'
    ) THEN 'Kids'
    ELSE "name"
  END,
  "calendarColor" = CASE
    WHEN "code" = 'KD_FAMILY' THEN 'var(--color-success-soft)'
    WHEN "departmentId" IN (
      SELECT "id" FROM "studio_departments" WHERE "code" = 'NB'
    ) THEN 'var(--color-accent-soft)'
    WHEN "departmentId" IN (
      SELECT "id" FROM "studio_departments" WHERE "code" = 'KD'
    ) THEN 'var(--color-info-soft)'
    ELSE NULL
  END;

UPDATE "session_types"
SET "calendarLabel" = "name"
WHERE "calendarLabel" IS NULL OR trim("calendarLabel") = '';

ALTER TABLE "session_types"
  ALTER COLUMN "calendarLabel" SET NOT NULL;

CREATE UNIQUE INDEX "session_types_departmentId_lower_name_key"
  ON "session_types"("departmentId", lower("name"));

CREATE UNIQUE INDEX "session_types_departmentId_name_key"
  ON "session_types"("departmentId", "name");
