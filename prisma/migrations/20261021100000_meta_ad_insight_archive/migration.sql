-- Meta ad history archive (per campaign per day) — survives a Meta disconnect.
-- CreateTable
CREATE TABLE "MetaAdInsight" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "spend" DECIMAL(10,2) NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetaAdInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetaAdInsight_clientId_date_idx" ON "MetaAdInsight"("clientId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MetaAdInsight_adAccountId_campaignId_date_key" ON "MetaAdInsight"("adAccountId", "campaignId", "date");

-- AddForeignKey
ALTER TABLE "MetaAdInsight" ADD CONSTRAINT "MetaAdInsight_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

