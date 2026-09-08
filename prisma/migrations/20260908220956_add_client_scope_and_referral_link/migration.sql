-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "scope" TEXT;

-- AlterTable
ALTER TABLE "ReferralLink" ADD COLUMN     "clientId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ReferralLink_clientId_key" ON "ReferralLink"("clientId");

-- AddForeignKey
ALTER TABLE "ReferralLink" ADD CONSTRAINT "ReferralLink_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
