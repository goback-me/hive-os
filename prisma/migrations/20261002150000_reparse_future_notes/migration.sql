-- Data only. Notes dated in the future (a d/m typo rolled into next year) are
-- now skipped by lib/notes-parser.ts. Clearing notesHash on the few leads that
-- have one makes the next sync re-parse just those cells; nothing is deleted.
UPDATE "Lead" SET "notesHash" = NULL
WHERE id IN (SELECT DISTINCT "leadId" FROM "LeadNoteEvent" WHERE at > now() + interval '1 day');
