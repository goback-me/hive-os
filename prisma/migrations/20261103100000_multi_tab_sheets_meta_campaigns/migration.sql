-- Several tabs of one spreadsheet feeding one client's leads.
-- AlterTable
ALTER TABLE "ClientSheet" ADD COLUMN "sheetNames" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "sheetTab" TEXT;

-- Archived Meta campaign list — reports after a Meta disconnect.
-- CreateTable
CREATE TABLE "MetaArchivedCampaign" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetaArchivedCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetaArchivedCampaign_clientId_idx" ON "MetaArchivedCampaign"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "MetaArchivedCampaign_adAccountId_campaignId_key" ON "MetaArchivedCampaign"("adAccountId", "campaignId");

-- AddForeignKey
ALTER TABLE "MetaArchivedCampaign" ADD CONSTRAINT "MetaArchivedCampaign_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
