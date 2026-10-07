-- Account manager call logging: WeeklyMeeting is the AmCall.

-- CreateEnum
CREATE TYPE "ClientHealth" AS ENUM ('ON_TRACK', 'AT_RISK', 'CRITICAL');

-- Renamed in place, so open alerts keep their rows.
ALTER TYPE "DataAlertType" RENAME VALUE 'MEETING_MISSED' TO 'AM_CALL_MISSED';
ALTER TYPE "DataAlertType" RENAME VALUE 'MEETING_NOT_LOGGED' TO 'AM_CALL_NOT_LOGGED';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN "health" "ClientHealth";

-- "issues" becomes the team-only internal notes (data kept).
ALTER TABLE "WeeklyMeeting" RENAME COLUMN "issues" TO "internalNotes";
ALTER TABLE "WeeklyMeeting" ADD COLUMN "scheduledAt" TIMESTAMP(3),
ADD COLUMN "durationMins" INTEGER,
ADD COLUMN "emailedToClientAt" TIMESTAMP(3);

UPDATE "WeeklyMeeting" SET "scheduledAt" = "weekOf" WHERE "scheduledAt" IS NULL;

-- Existing ContactLog calls → HELD calls, one per client per week (the latest
-- call that week), dated to that week's call day (Sydney midnight). Weeks that
-- already have a call are left alone. The ContactLog rows stay as contact
-- history ("Last contact").
INSERT INTO "WeeklyMeeting" ("id", "clientId", "weekOf", "scheduledAt", "agentId", "status", "summary", "nextSteps", "nextMeetingAt", "submittedAt", "submittedBy", "createdAt")
SELECT DISTINCT ON (cl."clientId", wk.week_of)
  'cl_' || cl."id",
  cl."clientId",
  wk.week_of,
  cl."contactedAt",
  COALESCE((SELECT u."id" FROM "User" u WHERE u."name" = cl."loggedBy" AND u."role" <> 'CLIENT' LIMIT 1), c."weeklyCallAgentId"),
  'HELD',
  cl."notes",
  cl."nextStep",
  cl."nextStepDue",
  cl."createdAt",
  cl."loggedBy",
  cl."createdAt"
FROM "ContactLog" cl
JOIN "Client" c ON c."id" = cl."clientId"
CROSS JOIN LATERAL (
  SELECT ((date_trunc('week', (cl."contactedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Australia/Sydney')::date
           + (array_position(enum_range(NULL::"Weekday"), c."weeklyCallDay") - 1))::timestamp
          AT TIME ZONE 'Australia/Sydney') AT TIME ZONE 'UTC' AS week_of
) wk
WHERE cl."method" = 'call'
ORDER BY cl."clientId", wk.week_of, cl."contactedAt" DESC
ON CONFLICT ("clientId", "weekOf") DO NOTHING;
