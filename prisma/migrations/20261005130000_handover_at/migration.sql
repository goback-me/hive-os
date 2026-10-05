-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "handoverAt" TIMESTAMP(3);

-- Backfill: same rule as refreshHandoverAt (lib/reminders.ts).
UPDATE "Lead" t SET "handoverAt" = x.at FROM (
  SELECT l.id, COALESCE(
    (SELECT MIN(ne.at) FROM "LeadNoteEvent" ne WHERE ne."leadId" = l.id AND ne.event::text IN ('HANDOVER_LIVE', 'HANDOVER_TEXT')),
    (SELECT MIN(e.at) FROM "LeadStageEvent" e WHERE e."leadId" = l.id AND e.stage::text IN ('HANDOVER_LIVE', 'HANDOVER_ATTEMPTED', 'HANDOVER_TEXT') AND e.source::text IN ('SYNC', 'MANUAL', 'NOTE')),
    (SELECT MIN(e.at) FROM "LeadStageEvent" e WHERE e."leadId" = l.id AND e.stage::text IN ('HANDOVER_LIVE', 'HANDOVER_ATTEMPTED', 'HANDOVER_TEXT') AND e.source::text <> 'INFERRED')
  ) AS at
  FROM "Lead" l
) x WHERE t.id = x.id AND x.at IS NOT NULL;
