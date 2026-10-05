-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "cycleOverrides" JSONB;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "staleInStage" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ClientCycle" (
    "clientId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "medianDays" DOUBLE PRECISION,
    "n" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientCycle_pkey" PRIMARY KEY ("clientId","step")
);

-- AddForeignKey
ALTER TABLE "ClientCycle" ADD CONSTRAINT "ClientCycle_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
