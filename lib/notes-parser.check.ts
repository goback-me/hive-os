// Run: npx tsx lib/notes-parser.check.ts — throws on the first failure.
import assert from "node:assert/strict";
import { classifyNoteText, parseNotes } from "./notes-parser";
import { formatSheetDate, parseSheetDate } from "./sheet-parse";

// Event rules, first match wins
const rules: [string, string][] = [
  ["NP", "CALL_ATTEMPT"],
  ["no pickup, left vm", "CALL_ATTEMPT"],
  ["voicemail", "CALL_ATTEMPT"],
  ["txt sent", "CALL_ATTEMPT"],
  ["DND", "CALL_ATTEMPT"],
  ["wrong num", "DQ_SPAM"],
  ["test lead", "DQ_SPAM"],
  ["live to Jake", "HANDOVER_LIVE"],
  ["LT to Sam", "HANDOVER_LIVE"],
  ["lt", "HANDOVER_LIVE"],
  ["live att no answer from client", "HANDOVER_TEXT"],
  ["email handover sent", "HANDOVER_TEXT"],
  ["self booked", "CONSULT_BOOKED"],
  ["booked in for Tuesday", "CONSULT_BOOKED"],
  ["site visit done", "CONSULT_ATTENDED"],
  ["quote provided $12k", "QUOTE_SENT"],
  ["wants a price for a 3 bed", "NOTE"],
  // real entries from a client sheet
  ["no pickup from jake, email handover.", "HANDOVER_TEXT"],
  ["email handover, no pickup from jake, call bck today before 6", "HANDOVER_TEXT"],
  ["nopicup", "CALL_ATTEMPT"],
  ["no picukp", "CALL_ATTEMPT"],
  ["live attmpted, email handover to jake", "HANDOVER_TEXT"],
  ["just goes to a busy dialtone.", "CALL_ATTEMPT"],
  // short tokens don't fire inside other words
  ["inpection pending", "NOTE"],
  ["salt water pool", "NOTE"],
];
for (const [text, event] of rules) assert.equal(classifyNoteText(text), event, text);

// Entries, AU d/m dates, undated fragments join the entry before them
const optIn = parseSheetDate("10/03/2026")!;
const notes = parseNotes("HS 12/3> NP, left vm\nMaddy 13/3 live to Jake, mddy 2/4 quote provided", optIn);
assert.deepEqual(
  notes.map((n) => [formatSheetDate(n.at), n.who, n.event, n.rawText]),
  [
    ["12/03/2026", "hs", "CALL_ATTEMPT", "NP, left vm"],
    ["13/03/2026", "maddy", "HANDOVER_LIVE", "live to Jake"],
    ["02/04/2026", "mddy", "QUOTE_SENT", "quote provided"],
  ]
);

// Year rollover: a month before the opt-in month is next year
const lateOptIn = parseSheetDate("20/11/2025")!;
const rolled = parseNotes("al 28/11 NP, al 3/1 booked in for Friday", lateOptIn);
assert.deepEqual(rolled.map((n) => formatSheetDate(n.at)), ["28/11/2025", "03/01/2026"]);

// Date typed after the text
const trailing = parseNotes("number disconnected hs 20/7", parseSheetDate("14/07/2026")!);
assert.deepEqual(trailing.map((n) => [formatSheetDate(n.at), n.who, n.event]), [["20/07/2026", "hs", "DQ_SPAM"]]);

// A rollover that lands in the future is a typo, not a real date — dropped
const augOptIn = parseSheetDate("04/08/2026")!;
const now = new Date("2026-10-02T00:00:00Z");
assert.deepEqual(
  parseNotes("hs 4/8 self booked for aug 7, maddy 4/4 np", augOptIn, now).map((n) => [formatSheetDate(n.at), n.event]),
  [["04/08/2026", "CONSULT_BOOKED"]]
);

// Junk: leading undated text dropped, impossible dates skipped, empty cell
assert.deepEqual(parseNotes("called twice, HS 31/2 np", optIn), []);
assert.deepEqual(parseNotes("", optIn), []);

console.log("notes-parser: all checks passed");
