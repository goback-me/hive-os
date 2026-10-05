-- Re-tag existing feedback entries with the new kinds (same rules as
-- lib/notes-parser.ts), so old cells needn't be re-parsed (or re-sent to AI).
-- Separate from the migration that added the enum values: Postgres can't use
-- a new value in the transaction that created it.
UPDATE "LeadNoteEvent" SET event = (CASE
  WHEN "rawText" ~* '\ynp\y|no ?pick ?up|\yno ?pi[a-z]{0,4}p\y' THEN 'NO_PICKUP'
  WHEN "rawText" ~* 'txt sent|text sent' THEN 'TEXT_SENT'
  WHEN "rawText" ~* '\yvm\y|voicemail|\ybusy\y|\ydnd\y|call closes|incoming call restrict' THEN 'CANT_CONTACT'
  ELSE 'CALL_ATTEMPT' END)::"NoteEventType"
WHERE event = 'CALL_ATTEMPT' AND source = 'REGEX';

UPDATE "LeadNoteEvent" SET event = 'AM_SCENARIO'
WHERE event = 'NOTE' AND array_length(regexp_split_to_array(trim("rawText"), '\s+'), 1) > 12;
