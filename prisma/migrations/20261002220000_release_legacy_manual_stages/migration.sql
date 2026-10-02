-- Data only. Manual stages from before two-way sync were carried over as
-- "HQ changes" (hqStatusUpdatedAt), but they were never written to the
-- sheet — so HQ kept overriding the sheet for them. Release them: a lead
-- only stays HQ-owned if its change went through the new flow (it has a
-- write-back job). The next sync applies the sheet's own stage (logged as a
-- normal sheet change in the lead's history).
UPDATE "Lead" SET "hqStatusUpdatedAt" = NULL
WHERE "hqStatusUpdatedAt" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "WriteBackJob" w WHERE w."leadId" = "Lead"."id");
