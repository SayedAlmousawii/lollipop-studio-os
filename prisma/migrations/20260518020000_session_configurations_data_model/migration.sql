-- CreateEnum
CREATE TYPE "SessionConfigurationInputType" AS ENUM ('TOGGLE', 'SELECT', 'NUMBER', 'TEXT', 'COUNTER');

-- CreateEnum
CREATE TYPE "SessionConfigurationPricingMode" AS ENUM ('NONE', 'FIXED', 'TIERED', 'LINKED_PRODUCT');

-- CreateEnum
CREATE TYPE "SessionConfigurationFinancialBehavior" AS ENUM ('OPERATIONAL', 'FINANCIAL');

-- CreateEnum
CREATE TYPE "SessionConfigurationLinkProductDisplay" AS ENUM ('LINE_ITEM', 'MODIFIER_ONLY');

-- CreateEnum
CREATE TYPE "SessionConfigurationCounterPricingMode" AS ENUM ('PER_UNIT', 'TIERED');

-- AlterEnum
ALTER TYPE "AuditEntityType" ADD VALUE 'ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION';

-- CreateTable
CREATE TABLE "session_configurations" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sessionTypeId" TEXT NOT NULL,
    "inputType" "SessionConfigurationInputType" NOT NULL,
    "pricingMode" "SessionConfigurationPricingMode" NOT NULL,
    "financialBehavior" "SessionConfigurationFinancialBehavior" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "fixedPriceDelta" DECIMAL(10,3),
    "linkedProductId" TEXT,
    "linkProductDisplay" "SessionConfigurationLinkProductDisplay",
    "counterPricingMode" "SessionConfigurationCounterPricingMode",
    "counterUnitPrice" DECIMAL(10,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_configuration_options" (
    "id" TEXT NOT NULL,
    "configurationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "priceDelta" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_configuration_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_package_session_configuration_selections" (
    "id" TEXT NOT NULL,
    "orderPackageId" TEXT NOT NULL,
    "configurationId" TEXT NOT NULL,
    "optionId" TEXT,
    "numericValue" DECIMAL(10,3),
    "textValue" TEXT,
    "snapshotConfigurationCode" TEXT NOT NULL,
    "snapshotLabel" TEXT NOT NULL,
    "snapshotPriceDelta" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "snapshotFinancialBehavior" "SessionConfigurationFinancialBehavior" NOT NULL,
    "snapshotInputType" "SessionConfigurationInputType" NOT NULL,
    "snapshotPricingMode" "SessionConfigurationPricingMode" NOT NULL,
    "snapshotLinkedProductId" TEXT,
    "snapshotLinkProductDisplay" "SessionConfigurationLinkProductDisplay",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_package_session_configuration_selections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "session_configurations_code_key" ON "session_configurations"("code");

-- CreateIndex
CREATE INDEX "session_configurations_sessionTypeId_isActive_sortOrder_idx" ON "session_configurations"("sessionTypeId", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "session_configurations_linkedProductId_idx" ON "session_configurations"("linkedProductId");

-- CreateIndex
CREATE INDEX "session_configuration_options_configurationId_isActive_sort_idx" ON "session_configuration_options"("configurationId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "session_configuration_options_configurationId_value_key" ON "session_configuration_options"("configurationId", "value");

-- CreateIndex
CREATE INDEX "order_package_session_configuration_selections_orderPackage_idx" ON "order_package_session_configuration_selections"("orderPackageId");

-- CreateIndex
CREATE INDEX "order_package_session_configuration_selections_configuratio_idx" ON "order_package_session_configuration_selections"("configurationId");

-- CreateIndex
CREATE INDEX "order_package_session_configuration_selections_snapshotLink_idx" ON "order_package_session_configuration_selections"("snapshotLinkedProductId");

-- CreateIndex
CREATE UNIQUE INDEX "order_package_session_configuration_selections_orderPackage_key" ON "order_package_session_configuration_selections"("orderPackageId", "configurationId");

-- AddForeignKey
ALTER TABLE "session_configurations" ADD CONSTRAINT "session_configurations_sessionTypeId_fkey" FOREIGN KEY ("sessionTypeId") REFERENCES "session_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_configurations" ADD CONSTRAINT "session_configurations_linkedProductId_fkey" FOREIGN KEY ("linkedProductId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_configuration_options" ADD CONSTRAINT "session_configuration_options_configurationId_fkey" FOREIGN KEY ("configurationId") REFERENCES "session_configurations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_package_session_configuration_selections" ADD CONSTRAINT "order_package_session_configuration_selections_orderPackag_fkey" FOREIGN KEY ("orderPackageId") REFERENCES "order_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_package_session_configuration_selections" ADD CONSTRAINT "order_package_session_configuration_selections_configurati_fkey" FOREIGN KEY ("configurationId") REFERENCES "session_configurations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_package_session_configuration_selections" ADD CONSTRAINT "order_package_session_configuration_selections_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "session_configuration_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
