-- CreateEnum
CREATE TYPE "NoteEventType" AS ENUM ('CALL_ATTEMPT', 'DQ_SPAM', 'HANDOVER_LIVE', 'HANDOVER_TEXT', 'CONSULT_BOOKED', 'CONSULT_ATTENDED', 'QUOTE_SENT', 'NOTE');

-- CreateEnum
CREATE TYPE "NoteEventSource" AS ENUM ('REGEX', 'AI');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "notesHash" TEXT;

-- CreateTable
CREATE TABLE "LeadNoteEvent" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "who" TEXT NOT NULL,
    "event" "NoteEventType" NOT NULL,
    "rawText" TEXT NOT NULL,
    "source" "NoteEventSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadNoteEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadNoteEvent_leadId_event_idx" ON "LeadNoteEvent"("leadId", "event");

-- AddForeignKey
ALTER TABLE "LeadNoteEvent" ADD CONSTRAINT "LeadNoteEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

