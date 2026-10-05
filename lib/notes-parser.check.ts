// Run: npx tsx lib/notes-parser.check.ts — throws on the first failure.
import assert from "node:assert/strict";
import { classifyNoteText, dqFromNotes, isCallAttempt, noteAuthor, parseNotes } from "./notes-parser";
import { isReturn } from "./lead-status";
import { formatSheetDate, parseSheetDate } from "./sheet-parse";

// Event rules, first match wins
const rules: [string, string][] = [
  ["NP", "NO_PICKUP"],
  ["no pickup, left vm", "NO_PICKUP"],
  ["voicemail", "CANT_CONTACT"],
  ["txt sent", "TEXT_SENT"],
  ["DND", "CANT_CONTACT"],
  ["incoming call restrictions", "CANT_CONTACT"],
  ["weird number", "DQ_SPAM"],
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
  ["nopicup", "NO_PICKUP"],
  ["no picukp", "NO_PICKUP"],
  ["live attmpted, email handover to jake", "HANDOVER_TEXT"],
  ["just goes to a busy dialtone.", "CANT_CONTACT"],
  // a long write-up with no shorthand → an AM scenario
  ["spoke with the owner about the rear extension, they want to wait until after christmas before deciding", "AM_SCENARIO"],
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
    ["12/03/2026", "hs", "NO_PICKUP", "NP, left vm"],
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

// Every kind of failed reach is a call attempt
for (const e of ["CALL_ATTEMPT", "NO_PICKUP", "TEXT_SENT", "CANT_CONTACT"] as const) assert.equal(isCallAttempt(e), true, e);
assert.equal(isCallAttempt("AM_SCENARIO"), false);

// Who wrote it: hs = Hive call team, aliases fix shorthand, else the name
assert.equal(noteAuthor("hs"), "Hive call team");
assert.equal(noteAuthor("mddy", { mddy: "Maddy" }), "Maddy");
assert.equal(noteAuthor("MDDY", { mddy: "Maddy" }), "Maddy");
assert.equal(noteAuthor("al"), "Al");

// DQ reason from the feedback: latest entry first
const dq = (cell: string) => dqFromNotes(parseNotes(cell, optIn));
assert.deepEqual(dq(""), { reason: "UNKNOWN", phase: null, evidence: null, needsAI: false });
assert.deepEqual([dq("HS 12/3> NP, HS 13/3 txt sent").reason, dq("HS 12/3> NP, HS 13/3 txt sent").phase], ["GHOSTED", "PRE_CONTACT"]);
assert.equal(dq("HS 12/3> number disconnected").reason, "SPAM");
assert.equal(dq("HS 12/3> spoke, too far for them").reason, "LOCATION");
assert.equal(dq("HS 12/3> spoke, they don't service that suburb").reason, "LOCATION");
assert.equal(dq("HS 12/3> said too expensive").reason, "BUDGET");
assert.equal(dq("HS 12/3> getting 3 quotes, price is key").reason, "PRICE_SHOPPER");
assert.equal(dq("HS 12/3> not interested anymore").reason, "NOT_INTERESTED");
assert.equal(dq("HS 12/3> didnt inquire").reason, "NOT_INTERESTED");
assert.equal(dq("HS 12/3> spoke, too far, HS 14/3 actually not interested").reason, "NOT_INTERESTED"); // latest wins
assert.equal(dq("HS 12/3> spoke, too far").phase, "POST_CONTACT");
assert.equal(dq("HS 12/3> spoke, too far").evidence, "spoke, too far");
// Something said but no rule matches → the AI pass decides
assert.deepEqual(dq("HS 12/3> spoke to them, will think about it"), { reason: null, phase: "POST_CONTACT", evidence: null, needsAI: true });

// Returned by client: handover / consult / quote → Chase Up only
assert.equal(isReturn("HANDOVER_LIVE", "CHASE_UP"), true);
assert.equal(isReturn("QUOTE_SENT", "CHASE_UP"), true);
assert.equal(isReturn("CONTACTED", "CHASE_UP"), false);
assert.equal(isReturn("HANDOVER_LIVE", "CONTACTED"), false);
assert.equal(isReturn(null, "CHASE_UP"), false);

console.log("notes-parser: all checks passed");
