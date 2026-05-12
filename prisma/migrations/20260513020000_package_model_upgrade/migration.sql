-- Add package taxonomy linkage and package-level duration.
ALTER TABLE "packages"
  ADD COLUMN "packageFamilyId" TEXT,
  ADD COLUMN "durationMinutes" INTEGER NOT NULL DEFAULT 0;

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

ALTER TABLE "packages"
  ALTER COLUMN "packageFamilyId" SET NOT NULL;

CREATE INDEX "packages_packageFamilyId_isActive_idx"
  ON "packages"("packageFamilyId", "isActive");

ALTER TABLE "packages"
  ADD CONSTRAINT "packages_packageFamilyId_fkey"
  FOREIGN KEY ("packageFamilyId") REFERENCES "package_families"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
