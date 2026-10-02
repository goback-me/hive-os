-- Additive only. Existing MonthlyKpi rows predate sales/revenue, so they're
-- marked BACKFILL: "Rebuild history" recomputes them (FROZEN never is).

-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('TRADE', 'SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "KpiSource" AS ENUM ('BACKFILL', 'FROZEN');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN "clientType" "ClientType" NOT NULL DEFAULT 'OTHER';

-- AlterTable
ALTER TABLE "MonthlyKpi" ADD COLUMN "sales" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "revenue" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "source" "KpiSource" NOT NULL DEFAULT 'FROZEN';
UPDATE "MonthlyKpi" SET "source" = 'BACKFILL';

-- CreateTable
CREATE TABLE "LeadReminder" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailedAt" TIMESTAMP(3),

    CONSTRAINT "LeadReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadReminder_leadId_createdAt_idx" ON "LeadReminder"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadReminder_clientId_createdAt_idx" ON "LeadReminder"("clientId", "createdAt");

-- AddForeignKey
ALTER TABLE "LeadReminder" ADD CONSTRAINT "LeadReminder_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadReminder" ADD CONSTRAINT "LeadReminder_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
