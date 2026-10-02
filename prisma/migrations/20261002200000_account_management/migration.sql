-- AlterTable
ALTER TABLE "ContactLog" ADD COLUMN     "nextStep" TEXT,
ADD COLUMN     "nextStepDue" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WeeklyUpdate" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "weekOf" TIMESTAMP(3) NOT NULL,
    "wins" TEXT NOT NULL,
    "issues" TEXT NOT NULL,
    "nextSteps" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyUpdate_clientId_weekOf_idx" ON "WeeklyUpdate"("clientId", "weekOf");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyUpdate_clientId_weekOf_key" ON "WeeklyUpdate"("clientId", "weekOf");

-- AddForeignKey
ALTER TABLE "WeeklyUpdate" ADD CONSTRAINT "WeeklyUpdate_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

