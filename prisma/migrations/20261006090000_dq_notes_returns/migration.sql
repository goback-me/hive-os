-- CreateEnum
CREATE TYPE "DqReasonSource" AS ENUM ('STATUS', 'NOTES', 'AI', 'MANUAL');

-- AlterEnum
ALTER TYPE "NoteEventType" ADD VALUE 'NO_PICKUP';
ALTER TYPE "NoteEventType" ADD VALUE 'TEXT_SENT';
ALTER TYPE "NoteEventType" ADD VALUE 'CANT_CONTACT';
ALTER TYPE "NoteEventType" ADD VALUE 'AM_SCENARIO';

-- AlterEnum
ALTER TYPE "StageEventSource" ADD VALUE 'RETURNED_BY_CLIENT';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "noteAliases" JSONB;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "dqReasonEvidence" TEXT,
ADD COLUMN     "dqReasonSource" "DqReasonSource",
ADD COLUMN     "lastReturnedAt" TIMESTAMP(3),
ADD COLUMN     "returnedCount" INTEGER NOT NULL DEFAULT 0;
