-- AlterTable: add nullable Clerk identity linkage for one-to-one staff-user mapping
ALTER TABLE "users" ADD COLUMN "clerkId" TEXT;

-- CreateIndex: allow safe lookup by Clerk user id while preserving existing seeded users
CREATE UNIQUE INDEX "users_clerkId_key" ON "users"("clerkId");
