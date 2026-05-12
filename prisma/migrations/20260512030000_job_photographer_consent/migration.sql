ALTER TABLE "jobs"
  ADD COLUMN "assignedPhotographerId" TEXT,
  ADD COLUMN "socialMediaConsent" BOOLEAN;

CREATE INDEX "jobs_assignedPhotographerId_idx"
  ON "jobs"("assignedPhotographerId");

ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_assignedPhotographerId_fkey"
  FOREIGN KEY ("assignedPhotographerId")
  REFERENCES "users"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
