-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DataAlertType" ADD VALUE 'SLACK_FAILED';
ALTER TYPE "DataAlertType" ADD VALUE 'CLICKUP_FAILED';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "slackChannelId" TEXT,
ADD COLUMN     "slackEvents" JSONB;

-- CreateTable
CREATE TABLE "SlackPostLog" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "channel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "SlackPostLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClickUpTaskLog" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "taskId" TEXT,
    "taskUrl" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "closedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClickUpTaskLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SlackPostLog_dedupeKey_key" ON "SlackPostLog"("dedupeKey");

-- CreateIndex
CREATE INDEX "SlackPostLog_status_createdAt_idx" ON "SlackPostLog"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClickUpTaskLog_dedupeKey_key" ON "ClickUpTaskLog"("dedupeKey");

-- CreateIndex
CREATE INDEX "ClickUpTaskLog_clientId_createdAt_idx" ON "ClickUpTaskLog"("clientId", "createdAt");

-- AddForeignKey
ALTER TABLE "SlackPostLog" ADD CONSTRAINT "SlackPostLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClickUpTaskLog" ADD CONSTRAINT "ClickUpTaskLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

