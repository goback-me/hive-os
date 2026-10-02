-- Two-way status sync. Additive except the last step: the permanent manual
-- lock (statusManuallySetAt) becomes hqStatusUpdatedAt — a lead set by hand
-- keeps its stage until the sheet changes after that time.

-- AlterTable
ALTER TABLE "GoogleAccountConnection" ADD COLUMN "scope" TEXT;

-- AlterTable
ALTER TABLE "ClientSheet" ADD COLUMN "statusOptions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "resultStatusOptions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "writeMapping" JSONB;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "sheetStatusUpdatedAt" TIMESTAMP(3),
ADD COLUMN "hqStatusUpdatedAt" TIMESTAMP(3),
ADD COLUMN "sheetWriteError" TEXT;

-- Carry every manual lock over before dropping it
UPDATE "Lead" SET "hqStatusUpdatedAt" = "statusManuallySetAt" WHERE "statusManuallySetAt" IS NOT NULL;
ALTER TABLE "Lead" DROP COLUMN "statusManuallySetAt";

-- CreateEnum
CREATE TYPE "WriteBackStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "WriteBackJob" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "column" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "status" "WriteBackStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "WriteBackJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WriteBackJob_status_runAfter_idx" ON "WriteBackJob"("status", "runAfter");

-- CreateIndex
CREATE INDEX "WriteBackJob_leadId_column_idx" ON "WriteBackJob"("leadId", "column");

-- AddForeignKey
ALTER TABLE "WriteBackJob" ADD CONSTRAINT "WriteBackJob_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
