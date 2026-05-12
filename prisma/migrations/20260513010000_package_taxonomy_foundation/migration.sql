-- RenameEnum
ALTER TYPE "SessionType" RENAME TO "BookingSessionType";

-- CreateTable
CREATE TABLE "session_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_families" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sessionTypeId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "package_families_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "session_types_code_key" ON "session_types"("code");

-- CreateIndex
CREATE INDEX "session_types_departmentId_isActive_sortOrder_idx" ON "session_types"("departmentId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "package_families_code_key" ON "package_families"("code");

-- CreateIndex
CREATE INDEX "package_families_sessionTypeId_isActive_sortOrder_idx" ON "package_families"("sessionTypeId", "isActive", "sortOrder");

-- AddForeignKey
ALTER TABLE "session_types" ADD CONSTRAINT "session_types_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "studio_departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_families" ADD CONSTRAINT "package_families_sessionTypeId_fkey" FOREIGN KEY ("sessionTypeId") REFERENCES "session_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
