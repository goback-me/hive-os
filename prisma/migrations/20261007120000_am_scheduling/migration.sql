-- Account management: WeeklyMeeting → AmCall with scheduledAt as the source
-- of truth (any day/time, reschedule chains). Renamed in place — no data lost.

ALTER TYPE "MeetingStatus" ADD VALUE 'RESCHEDULED';
CREATE TYPE "CallFrequency" AS ENUM ('WEEKLY', 'FORTNIGHTLY');
CREATE TYPE "CallReminderKind" AS ENUM ('INVITE', 'DAY_AFTER', 'SECOND');

-- Client: the account manager + regular call slot.
ALTER TABLE "Client" RENAME COLUMN "weeklyCallAgentId" TO "accountManagerId";
ALTER TABLE "Client" RENAME CONSTRAINT "Client_weeklyCallAgentId_fkey" TO "Client_accountManagerId_fkey";
ALTER TABLE "Client" RENAME COLUMN "weeklyCallDay" TO "callDay";
ALTER TABLE "Client" RENAME COLUMN "health" TO "healthOverride";
ALTER TABLE "Client" ADD COLUMN "callTime" TEXT NOT NULL DEFAULT '10:00',
ADD COLUMN "callFrequency" "CallFrequency" NOT NULL DEFAULT 'WEEKLY';

-- WeeklyMeeting → AmCall.
ALTER TABLE "WeeklyMeeting" RENAME TO "AmCall";
ALTER TABLE "AmCall" RENAME CONSTRAINT "WeeklyMeeting_pkey" TO "AmCall_pkey";
ALTER TABLE "AmCall" RENAME CONSTRAINT "WeeklyMeeting_clientId_fkey" TO "AmCall_clientId_fkey";
ALTER TABLE "AmCall" RENAME CONSTRAINT "WeeklyMeeting_agentId_fkey" TO "AmCall_callPersonId_fkey";
ALTER TABLE "AmCall" RENAME COLUMN "agentId" TO "callPersonId";
ALTER TABLE "AmCall" RENAME COLUMN "clientMood" TO "outcome";
ALTER TABLE "AmCall" RENAME COLUMN "nextMeetingAt" TO "nextCallAt";
ALTER TABLE "AmCall" RENAME COLUMN "submittedAt" TO "loggedAt";

-- scheduledAt is the source of truth; the one-call-per-week key goes.
UPDATE "AmCall" SET "scheduledAt" = "weekOf" WHERE "scheduledAt" IS NULL;
ALTER TABLE "AmCall" ALTER COLUMN "scheduledAt" SET NOT NULL;
DROP INDEX "WeeklyMeeting_clientId_weekOf_key";
DROP INDEX "WeeklyMeeting_status_weekOf_idx";
ALTER TABLE "AmCall" DROP COLUMN "weekOf";
ALTER TABLE "AmCall" ADD COLUMN "rescheduledFromId" TEXT,
ADD COLUMN "rescheduleReason" TEXT;

-- nextSteps: one per line → a list (bullets and blank lines dropped, so the
-- client's ticks — indexes into it — still line up).
ALTER TABLE "AmCall" ADD COLUMN "nextStepsList" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "AmCall" SET "nextStepsList" = ARRAY(
  SELECT btrim(regexp_replace(t.line, '^\s*[-•*]\s*', ''))
  FROM unnest(string_to_array("nextSteps", E'\n')) WITH ORDINALITY AS t(line, n)
  WHERE btrim(regexp_replace(t.line, '^\s*[-•*]\s*', '')) <> ''
  ORDER BY t.n
) WHERE "nextSteps" IS NOT NULL;
ALTER TABLE "AmCall" DROP COLUMN "nextSteps";
ALTER TABLE "AmCall" RENAME COLUMN "nextStepsList" TO "nextSteps";

CREATE INDEX "AmCall_status_scheduledAt_idx" ON "AmCall"("status", "scheduledAt");
CREATE INDEX "AmCall_clientId_scheduledAt_idx" ON "AmCall"("clientId", "scheduledAt");

-- Reminders sent per call, once each.
CREATE TABLE "CallReminder" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "kind" "CallReminderKind" NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CallReminder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CallReminder_callId_kind_key" ON "CallReminder"("callId", "kind");
ALTER TABLE "CallReminder" ADD CONSTRAINT "CallReminder_callId_fkey" FOREIGN KEY ("callId") REFERENCES "AmCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reminders the old Monday/Wednesday job already emailed aren't sent again.
INSERT INTO "CallReminder" ("id", "callId", "kind", "sentAt")
SELECT 'el_' || e."id", e."refIds"[1],
  CASE e."type" WHEN 'meeting_log' THEN 'DAY_AFTER'::"CallReminderKind" ELSE 'SECOND'::"CallReminderKind" END,
  e."sentAt"
FROM "EmailLog" e JOIN "AmCall" c ON c."id" = e."refIds"[1]
WHERE e."type" IN ('meeting_log', 'meeting_reminder')
ON CONFLICT ("callId", "kind") DO NOTHING;
