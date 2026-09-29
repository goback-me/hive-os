-- AlterTable
ALTER TABLE "Client" ADD COLUMN "reportVisibility" JSONB;

-- CreateTable
CREATE TABLE "MonthlyKpi" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "leads" INTEGER NOT NULL,
    "liveTransfers" INTEGER NOT NULL,
    "consultsBooked" INTEGER NOT NULL,
    "quotes" INTEGER NOT NULL,
    "spend" DECIMAL(10,2),
    "spendSource" TEXT,
    "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyKpi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyKpi_clientId_month_key" ON "MonthlyKpi"("clientId", "month");

-- AddForeignKey
ALTER TABLE "MonthlyKpi" ADD CONSTRAINT "MonthlyKpi_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
