-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Lead_clientId_deletedAt_idx" ON "Lead"("clientId", "deletedAt");
