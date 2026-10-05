// Run: npx tsx lib/status-classifier.check.ts — throws on the first failure.
import assert from "node:assert/strict";
import { classifyHive, classifyProspect, isPendingUpdate, resolveStatus } from "./status-classifier";
import { awaitingClientUpdate, combineTargets } from "./lead-status";

type R = ReturnType<typeof classifyProspect>;
const CHASE = { stage: "CHASE_UP" } as const;

// HIVE STATUS (our team) — blank / N/A are the default Chase Up.
const hive: [string, R][] = [
  ["New Lead", CHASE],
  ["CHASE UP", CHASE],
  ["Call back scheduled", CHASE],
  ["N/A", CHASE],
  ["", CHASE],
  ["Lead Contacted", { stage: "CONTACTED" }],
  ["Lead Contacted ALT", { stage: "CONTACTED" }],
  [":phone: Lead Contacted :phone:", { stage: "CONTACTED" }],
  ["📞 lead contacted", { stage: "CONTACTED" }],
  ["Not ready yet", { stage: "NURTURE" }],
  ["LIVE ATTEMPTED", { stage: "HANDOVER_ATTEMPTED" }],
  ["LIVE TRANSFER", { stage: "HANDOVER_LIVE" }],
  ["TEXT HAND OVER", { stage: "HANDOVER_TEXT" }],
  ["TEXT HAND-OVER", { stage: "HANDOVER_TEXT" }],
  ["Client Contacted", { stage: "CLIENT_CONTACTED" }],
  ["Meeting booked", { stage: "CONSULT_BOOKED" }],
  ["Self booked", { stage: "CONSULT_BOOKED" }],
  ["Auto booked", { stage: "CONSULT_BOOKED" }],
  ["DISQUALIFIED", { stage: "DISQUALIFIED", dqReason: "UNKNOWN" }],
  ["Too far", { stage: "DISQUALIFIED", dqReason: "LOCATION" }],
  ["DQ - Ghosted", { stage: "DISQUALIFIED", dqReason: "GHOSTED" }],
  ["dq spam", { stage: "DISQUALIFIED", dqReason: "SPAM" }],
  ["DQ - wrong number", { stage: "DISQUALIFIED", dqReason: "SPAM" }],
  ["Disqualified - not interested", { stage: "DISQUALIFIED", dqReason: "NOT_INTERESTED" }],
  ["something weird", undefined],
];
for (const [raw, expected] of hive) assert.deepEqual(classifyHive(raw), expected, `hive ${JSON.stringify(raw)}`);

// Prospect Status (the client) — blank / N/A / pending update = no update.
const prospect: [string, R][] = [
  ["N/A", null],
  ["", null],
  ["Pending Update", null],
  ["BOOKED ", { stage: "CONSULT_BOOKED" }],
  ["Consult booked", { stage: "CONSULT_BOOKED" }],
  ["Pre consult", { stage: "CONSULT_BOOKED" }],
  ["Pre-consult", { stage: "CONSULT_BOOKED" }],
  ["Auto booked", { stage: "CONSULT_BOOKED" }],
  ["Self booked", { stage: "CONSULT_BOOKED" }],
  ["Consult cancelled", { stage: "CONSULT_CANCELLED" }],
  ["Cancelled", { stage: "CONSULT_CANCELLED" }],
  ["Didn't attend", { stage: "CONSULT_NO_SHOW" }],
  ["No show", { stage: "CONSULT_NO_SHOW" }],
  ["ATTENDED BOOKING ", { stage: "CONSULT_ATTENDED" }],
  ["Attended", { stage: "CONSULT_ATTENDED" }],
  ["QUOTED", { stage: "QUOTE_SENT" }],
  ["WON", { stage: "WON" }],
  ["SOLD", { stage: "WON" }],
  ["LOST", { stage: "LOST", lostReason: "UNKNOWN" }],
  ["QUOTED - LOST", { stage: "LOST", lostReason: "UNKNOWN" }],
  ["Lost - ghosted", { stage: "LOST", lostReason: "GHOSTED" }],
  ["Lost - went elsewhere", { stage: "LOST", lostReason: "WENT_ELSEWHERE" }],
  ["Lost - went with someone else", { stage: "LOST", lostReason: "WENT_ELSEWHERE" }],
  ["Lost (too expensive)", { stage: "LOST", lostReason: "BUDGET" }],
  ["Lost - price", { stage: "LOST", lostReason: "BUDGET" }],
  ["Lost budget", { stage: "LOST", lostReason: "BUDGET" }],
  ["Disqualified budget", { stage: "DISQUALIFIED", dqReason: "BUDGET" }],
  ["DSIQUALIFED BUDGET", { stage: "DISQUALIFIED", dqReason: "BUDGET" }],
  ["disqualified - distance", { stage: "DISQUALIFIED", dqReason: "LOCATION" }],
  ["Disqualified location", { stage: "DISQUALIFIED", dqReason: "LOCATION" }],
  ["Disqualified too far", { stage: "DISQUALIFIED", dqReason: "LOCATION" }],
  ["Not suitable", { stage: "DISQUALIFIED", dqReason: "NOT_SUITABLE" }],
  ["NOT SUITEABLE ", { stage: "DISQUALIFIED", dqReason: "NOT_SUITABLE" }],
  ["Price shopper", { stage: "DISQUALIFIED", dqReason: "PRICE_SHOPPER" }],
  ["DISQUALIFED - PRICE SHOPPER", { stage: "DISQUALIFIED", dqReason: "PRICE_SHOPPER" }],
  ["Chase up", CHASE],
  ["New lead", CHASE],
  ["something weird", undefined],
];
for (const [raw, expected] of prospect) assert.deepEqual(classifyProspect(raw), expected, `prospect ${JSON.stringify(raw)}`);
assert.equal(isPendingUpdate(" pending  UPDATE "), true);
assert.equal(isPendingUpdate("N/A"), false);

// Client mapping beats the rules; unknown values are counted, not guessed
const unmapped: Record<string, number> = {};
assert.deepEqual(resolveStatus("WON", { won: { stage: "QUOTE_SENT" } }, unmapped, classifyProspect), { stage: "QUOTE_SENT" });
assert.deepEqual(resolveStatus("N/A", {}, unmapped, classifyProspect), { stage: null });
assert.deepEqual(resolveStatus("N/A", {}, unmapped, classifyHive), CHASE);
assert.equal(resolveStatus("Mystery 🤔", {}, unmapped, classifyProspect), undefined);
resolveStatus("mystery", {}, unmapped, classifyHive);
assert.deepEqual(unmapped, { mystery: 2 });

// Higher rank wins; a cancellation outranks the booking it cancels
assert.equal(combineTargets(classifyHive("LIVE TRANSFER"), classifyProspect("BOOKED")!).final.stage, "CONSULT_BOOKED");
assert.equal(combineTargets(classifyHive("Meeting booked"), classifyProspect("Cancelled")!).final.stage, "CONSULT_CANCELLED");
assert.equal(combineTargets(undefined, undefined).final.stage, "CHASE_UP");

// Awaiting a client update
const live = classifyHive("LIVE TRANSFER");
const blank = { stage: null };
assert.equal(awaitingClientUpdate({ stage: "HANDOVER_LIVE", hive: live, prospect: blank, prospectPending: false }), true);
// Only HANDOVER_STAGES make the client owe an update.
assert.equal(awaitingClientUpdate({ stage: "NURTURE", hive: classifyHive("Not ready yet"), prospect: blank, prospectPending: false }), false);
assert.equal(awaitingClientUpdate({ stage: "HANDOVER_ATTEMPTED", hive: classifyHive("Live attempted"), prospect: blank, prospectPending: false }), true);
// Any prospect stage ends it — cancelled / no-show included.
assert.equal(awaitingClientUpdate({ stage: "CONSULT_CANCELLED", hive: live, prospect: { stage: "CONSULT_CANCELLED" }, prospectPending: false }), false);
assert.equal(awaitingClientUpdate({ stage: "CONTACTED", hive: classifyHive("Lead contacted"), prospect: blank, prospectPending: false }), false);
assert.equal(awaitingClientUpdate({ stage: "CONSULT_BOOKED", hive: live, prospect: classifyProspect("Booked")!, prospectPending: false }), false);
assert.equal(awaitingClientUpdate({ stage: "CHASE_UP", hive: CHASE, prospect: blank, prospectPending: true }), true);
assert.equal(awaitingClientUpdate({ stage: "DISQUALIFIED", hive: live, prospect: blank, prospectPending: true }), false);

console.log("status-classifier: all checks passed");
