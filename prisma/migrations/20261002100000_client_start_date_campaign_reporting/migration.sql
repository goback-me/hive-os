-- AlterTable
ALTER TABLE "AdCampaign" ADD COLUMN     "includedInReporting" BOOLEAN;

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "startDate" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "AdCampaign_clientId_metaCampaignId_key" ON "AdCampaign"("clientId", "metaCampaignId");
