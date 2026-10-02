-- Lead stage v2: NEW_LEAD folds into CHASE_UP, CONSULT_CANCELLED is added,
-- plus the per-column raw status text and the awaiting-client-update flag.
-- Data is moved BEFORE the type swap, so no row can fail the cast.

-- 1. NEW_LEAD -> CHASE_UP everywhere a stage is stored
UPDATE "Lead" SET "stage" = 'CHASE_UP' WHERE "stage" = 'NEW_LEAD';
UPDATE "Lead" SET "sheetStage" = 'CHASE_UP' WHERE "sheetStage" = 'NEW_LEAD';
UPDATE "LeadActivity" SET "fromStatus" = 'CHASE_UP' WHERE "fromStatus" = 'NEW_LEAD';
UPDATE "LeadActivity" SET "toStatus" = 'CHASE_UP' WHERE "toStatus" = 'NEW_LEAD';
UPDATE "LeadStageEvent" SET "stage" = 'CHASE_UP' WHERE "stage" = 'NEW_LEAD';
-- Saved per-client mappings ("NEW_LEAD" as a target value) follow too.
UPDATE "ClientSheet" SET "statusMapping" = replace("statusMapping"::text, '"NEW_LEAD"', '"CHASE_UP"')::jsonb
  WHERE "statusMapping"::text LIKE '%"NEW_LEAD"%';
UPDATE "ClientSheet" SET "resultStatusMapping" = replace("resultStatusMapping"::text, '"NEW_LEAD"', '"CHASE_UP"')::jsonb
  WHERE "resultStatusMapping"::text LIKE '%"NEW_LEAD"%';

-- 2. Closed leads always carry a reason (UNKNOWN when none was recorded)
UPDATE "Lead" SET "dqReason" = 'UNKNOWN' WHERE "stage" = 'DISQUALIFIED' AND "dqReason" IS NULL;
UPDATE "Lead" SET "lostReason" = 'UNKNOWN' WHERE "stage" = 'LOST' AND "lostReason" IS NULL;

-- 3. Swap the enum (Postgres can't drop a value in place)
CREATE TYPE "LeadStage_new" AS ENUM ('CHASE_UP', 'CONTACTED', 'NURTURE', 'HANDOVER_ATTEMPTED', 'HANDOVER_LIVE', 'HANDOVER_TEXT', 'CLIENT_CONTACTED', 'CONSULT_BOOKED', 'CONSULT_CANCELLED', 'CONSULT_NO_SHOW', 'CONSULT_ATTENDED', 'QUOTE_SENT', 'WON', 'LOST', 'DISQUALIFIED');
ALTER TABLE "Lead" ALTER COLUMN "stage" DROP DEFAULT;
ALTER TABLE "Lead" ALTER COLUMN "stage" TYPE "LeadStage_new" USING ("stage"::text::"LeadStage_new");
ALTER TABLE "Lead" ALTER COLUMN "sheetStage" TYPE "LeadStage_new" USING ("sheetStage"::text::"LeadStage_new");
ALTER TABLE "LeadActivity" ALTER COLUMN "fromStatus" TYPE "LeadStage_new" USING ("fromStatus"::text::"LeadStage_new");
ALTER TABLE "LeadActivity" ALTER COLUMN "toStatus" TYPE "LeadStage_new" USING ("toStatus"::text::"LeadStage_new");
ALTER TABLE "LeadStageEvent" ALTER COLUMN "stage" TYPE "LeadStage_new" USING ("stage"::text::"LeadStage_new");
ALTER TYPE "LeadStage" RENAME TO "LeadStage_old";
ALTER TYPE "LeadStage_new" RENAME TO "LeadStage";
DROP TYPE "LeadStage_old";
ALTER TABLE "Lead" ALTER COLUMN "stage" SET DEFAULT 'CHASE_UP';

-- 4. New columns (nullable / defaulted — existing rows fill on next sync)
ALTER TABLE "Lead" ADD COLUMN "hiveStatusRaw" TEXT;
ALTER TABLE "Lead" ADD COLUMN "prospectStatusRaw" TEXT;
ALTER TABLE "Lead" ADD COLUMN "awaitingClientUpdate" BOOLEAN NOT NULL DEFAULT false;
