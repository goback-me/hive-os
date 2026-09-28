-- Replaces the 6-value LeadStatus with the 15-stage LeadStage funnel.
-- Data-preserving: every old status value exists in the new enum, and the
-- old chaseUpAt/contactedAt/closedAt timestamps + LeadActivity history are
-- backfilled into LeadStageEvent before those columns are dropped.

-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('NEW_LEAD', 'CHASE_UP', 'CONTACTED', 'NURTURE', 'HANDOVER_ATTEMPTED', 'HANDOVER_LIVE', 'HANDOVER_TEXT', 'CLIENT_CONTACTED', 'CONSULT_BOOKED', 'CONSULT_NO_SHOW', 'CONSULT_ATTENDED', 'QUOTE_SENT', 'WON', 'LOST', 'DISQUALIFIED');
CREATE TYPE "DqReason" AS ENUM ('GHOSTED', 'SPAM', 'NOT_INTERESTED', 'BUDGET', 'LOCATION', 'UNKNOWN');
CREATE TYPE "DqPhase" AS ENUM ('PRE_CONTACT', 'POST_CONTACT', 'POST_HANDOVER');
CREATE TYPE "LostReason" AS ENUM ('GHOSTED', 'WENT_ELSEWHERE', 'BUDGET', 'UNKNOWN');
CREATE TYPE "StageEventSource" AS ENUM ('SYNC', 'MANUAL', 'IMPORT', 'INFERRED');

-- Lead: new columns, copy status -> stage
ALTER TABLE "Lead"
ADD COLUMN "stage" "LeadStage" NOT NULL DEFAULT 'NEW_LEAD',
ADD COLUMN "dqReason" "DqReason",
ADD COLUMN "dqPhase" "DqPhase",
ADD COLUMN "lostReason" "LostReason",
ADD COLUMN "callAttempts" INTEGER;

UPDATE "Lead" SET "stage" = "status"::text::"LeadStage";

-- Old CLIENT_CONTACTED meant "handed over and the client got in touch", so a
-- DQ that had reached it is post-handover; anything earlier is pre-contact.
UPDATE "Lead"
SET "dqReason" = 'UNKNOWN',
    "dqPhase" = CASE WHEN "contactedAt" IS NOT NULL THEN 'POST_HANDOVER'::"DqPhase" ELSE 'PRE_CONTACT'::"DqPhase" END
WHERE "stage" = 'DISQUALIFIED';

UPDATE "Lead" SET "lostReason" = 'UNKNOWN' WHERE "stage" = 'LOST';

-- LeadActivity: same values, new enum type
ALTER TABLE "LeadActivity"
ALTER COLUMN "fromStatus" TYPE "LeadStage" USING "fromStatus"::text::"LeadStage",
ALTER COLUMN "toStatus" TYPE "LeadStage" USING "toStatus"::text::"LeadStage";

-- CreateTable
CREATE TABLE "LeadStageEvent" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "stage" "LeadStage" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "source" "StageEventSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadStageEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeadStageEvent_leadId_stage_idx" ON "LeadStageEvent"("leadId", "stage");

ALTER TABLE "LeadStageEvent" ADD CONSTRAINT "LeadStageEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill 1: real, timestamped transitions from the audit log.
INSERT INTO "LeadStageEvent" ("id", "leadId", "stage", "at", "source")
SELECT gen_random_uuid()::text, "leadId", "toStatus", "changedAt",
       CASE WHEN "changedBy" = 'Sheet sync' THEN 'SYNC'::"StageEventSource" ELSE 'MANUAL'::"StageEventSource" END
FROM "LeadActivity";

-- Backfill 2: stage timestamps the audit log doesn't cover. These were
-- stamped at sync time (often a bulk first sync), so the timing isn't
-- trustworthy — IMPORT keeps them out of the duration medians.
INSERT INTO "LeadStageEvent" ("id", "leadId", "stage", "at", "source")
SELECT gen_random_uuid()::text, l."id", 'CHASE_UP', l."chaseUpAt", 'IMPORT'
FROM "Lead" l
WHERE l."chaseUpAt" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "LeadStageEvent" e WHERE e."leadId" = l."id" AND e."stage" = 'CHASE_UP');

INSERT INTO "LeadStageEvent" ("id", "leadId", "stage", "at", "source")
SELECT gen_random_uuid()::text, l."id", 'CLIENT_CONTACTED', l."contactedAt", 'IMPORT'
FROM "Lead" l
WHERE l."contactedAt" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "LeadStageEvent" e WHERE e."leadId" = l."id" AND e."stage" = 'CLIENT_CONTACTED');

INSERT INTO "LeadStageEvent" ("id", "leadId", "stage", "at", "source")
SELECT gen_random_uuid()::text, l."id", l."stage", l."closedAt", 'IMPORT'
FROM "Lead" l
WHERE l."closedAt" IS NOT NULL
  AND l."stage" IN ('WON', 'LOST', 'DISQUALIFIED')
  AND NOT EXISTS (SELECT 1 FROM "LeadStageEvent" e WHERE e."leadId" = l."id" AND e."stage" = l."stage");

-- Backfill 3: every lead's current stage has at least one event.
INSERT INTO "LeadStageEvent" ("id", "leadId", "stage", "at", "source")
SELECT gen_random_uuid()::text, l."id", l."stage", COALESCE(l."closedAt", l."contactedAt", l."chaseUpAt", l."createdAt"), 'IMPORT'
FROM "Lead" l
WHERE l."stage" <> 'NEW_LEAD'
  AND NOT EXISTS (SELECT 1 FROM "LeadStageEvent" e WHERE e."leadId" = l."id" AND e."stage" = l."stage");

-- Drop the old model
ALTER TABLE "Lead"
DROP COLUMN "status",
DROP COLUMN "chaseUpAt",
DROP COLUMN "contactedAt",
DROP COLUMN "closedAt";

DROP TYPE "LeadStatus";
