-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('PENDING', 'HELD', 'NOT_HELD');

-- CreateEnum
CREATE TYPE "ClientMood" AS ENUM ('GOOD', 'NEUTRAL', 'AT_RISK');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DataAlertType" ADD VALUE 'MEETING_MISSED';
ALTER TYPE "DataAlertType" ADD VALUE 'MEETING_NOT_LOGGED';

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'AGENT';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "weeklyCallAgentId" TEXT,
ADD COLUMN     "weeklyCallDay" "Weekday" NOT NULL DEFAULT 'FRIDAY';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "clickupUserId" TEXT;

-- CreateTable
CREATE TABLE "WeeklyMeeting" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "weekOf" TIMESTAMP(3) NOT NULL,
    "agentId" TEXT,
    "status" "MeetingStatus" NOT NULL DEFAULT 'PENDING',
    "summary" TEXT,
    "issues" TEXT,
    "nextSteps" TEXT,
    "clientMood" "ClientMood",
    "nextMeetingAt" TIMESTAMP(3),
    "notHeldReason" TEXT,
    "leadsDiscussed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "leadsReturned" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "clickupTaskId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submittedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "to" TEXT[],
    "type" TEXT NOT NULL,
    "clientId" TEXT,
    "refIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "actionToken" TEXT NOT NULL,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyMeeting_status_weekOf_idx" ON "WeeklyMeeting"("status", "weekOf");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyMeeting_clientId_weekOf_key" ON "WeeklyMeeting"("clientId", "weekOf");

-- CreateIndex
CREATE UNIQUE INDEX "EmailLog_actionToken_key" ON "EmailLog"("actionToken");

-- CreateIndex
CREATE INDEX "EmailLog_type_sentAt_idx" ON "EmailLog"("type", "sentAt");

-- AddForeignKey
ALTER TABLE "WeeklyMeeting" ADD CONSTRAINT "WeeklyMeeting_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyMeeting" ADD CONSTRAINT "WeeklyMeeting_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_weeklyCallAgentId_fkey" FOREIGN KEY ("weeklyCallAgentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

