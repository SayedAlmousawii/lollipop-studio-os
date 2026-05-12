-- Add session-type-scoped extra photo pricing for digital and print media.
CREATE TYPE "MediaType" AS ENUM ('DIGITAL', 'PRINT');

CREATE TABLE "session_type_extra_photo_pricing" (
  "id" TEXT NOT NULL,
  "sessionTypeId" TEXT NOT NULL,
  "mediaType" "MediaType" NOT NULL,
  "unitPrice" DECIMAL(10,3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "session_type_extra_photo_pricing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "session_type_extra_photo_pricing_sessionTypeId_mediaType_key"
  ON "session_type_extra_photo_pricing"("sessionTypeId", "mediaType");

CREATE INDEX "session_type_extra_photo_pricing_sessionTypeId_idx"
  ON "session_type_extra_photo_pricing"("sessionTypeId");

ALTER TABLE "session_type_extra_photo_pricing"
  ADD CONSTRAINT "session_type_extra_photo_pricing_sessionTypeId_fkey"
  FOREIGN KEY ("sessionTypeId") REFERENCES "session_types"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
