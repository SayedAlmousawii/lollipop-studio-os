-- Add package taxonomy linkage and package-level duration.
ALTER TABLE "packages"
  ADD COLUMN "packageFamilyId" TEXT,
  ADD COLUMN "durationMinutes" INTEGER NOT NULL DEFAULT 60;

-- Existing development packages without a clear imported session type are mapped to
-- Kids > Regular > Regular Packages, the broadest default family from Feature 67.
UPDATE "packages"
SET "packageFamilyId" = (
  SELECT "id"
  FROM "package_families"
  WHERE "code" = 'KD_REGULAR_DEFAULT'
  LIMIT 1
)
WHERE "packageFamilyId" IS NULL;

UPDATE "packages"
SET "durationMinutes" = 60
WHERE "durationMinutes" <= 0;

ALTER TABLE "packages"
  ALTER COLUMN "packageFamilyId" SET NOT NULL;

ALTER TABLE "packages"
  ADD CONSTRAINT "packages_durationMinutes_positive_check"
  CHECK ("durationMinutes" > 0);

CREATE INDEX "packages_packageFamilyId_isActive_idx"
  ON "packages"("packageFamilyId", "isActive");

ALTER TABLE "packages"
  ADD CONSTRAINT "packages_packageFamilyId_fkey"
  FOREIGN KEY ("packageFamilyId") REFERENCES "package_families"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
