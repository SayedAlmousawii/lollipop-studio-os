-- AlterTable
ALTER TABLE "order_package_session_configuration_selections"
  ADD COLUMN "snapshotOptionLabel" TEXT;

-- Backfill option label snapshots for historical selections with an option.
UPDATE "order_package_session_configuration_selections" selection
SET "snapshotOptionLabel" = option."label"
FROM "session_configuration_options" option
WHERE selection."optionId" = option."id";

-- Retire modifier-only behavior without dropping the enum value yet.
UPDATE "session_configurations"
SET "linkProductDisplay" = 'LINE_ITEM'
WHERE "linkProductDisplay" = 'MODIFIER_ONLY';

UPDATE "order_package_session_configuration_selections"
SET "snapshotLinkProductDisplay" = 'LINE_ITEM'
WHERE "snapshotLinkProductDisplay" = 'MODIFIER_ONLY';
