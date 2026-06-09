ALTER TYPE "DocumentApplicationKind" RENAME TO "DocumentApplicationKind_old";

CREATE TYPE "DocumentApplicationKind" AS ENUM (
  'DEPOSIT',
  'SETTLEMENT'
);

ALTER TABLE "document_applications"
  ALTER COLUMN "kind" TYPE "DocumentApplicationKind"
  USING "kind"::text::"DocumentApplicationKind";

DROP TYPE "DocumentApplicationKind_old";
