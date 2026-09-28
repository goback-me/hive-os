// Run: npx tsx lib/status-classifier.check.ts — throws on the first failure.
import assert from "node:assert/strict";
import { classifyStatus } from "./status-classifier";
import { combineTargets } from "./lead-status";
import { resolveStatus } from "./lead-sync";

const cases: [string, ReturnType<typeof classifyStatus>][] = [
  ["N/A", null],
  ["", null],
  ["CHASE UP", { stage: "CHASE_UP" }],
  ["disqualified - distance", { stage: "DISQUALIFIED", dqReason: "LOCATION" }],
  ["DSIQUALIFED BUDGET", { stage: "DISQUALIFIED", dqReason: "BUDGET" }],
  ["NOT SUITEABLE ", { stage: "DISQUALIFIED", dqReason: "NOT_SUITABLE" }],
  ["WON", { stage: "WON" }],
  ["QUOTED", { stage: "QUOTE_SENT" }],
  ["QUOTED - LOST", { stage: "LOST", lostReason: "UNKNOWN" }],
  ["BOOKED ", { stage: "CONSULT_BOOKED" }],
  ["ATTENDED BOOKING ", { stage: "CONSULT_ATTENDED" }],
  ["LOST", { stage: "LOST", lostReason: "UNKNOWN" }],
  ["DISQUALIFED - PRICE SHOPPER", { stage: "DISQUALIFIED", dqReason: "PRICE_SHOPPER" }],
  ["LIVE TRANSFER", { stage: "HANDOVER_LIVE" }],
  ["TEXT HAND-OVER", { stage: "HANDOVER_TEXT" }],
  ["LIVE ATTEMPTED", { stage: "HANDOVER_ATTEMPTED" }],
  [":phone: Lead Contacted :phone:", { stage: "CONTACTED" }],
  ["not ready yet", { stage: "NURTURE" }],
  // extras: reasons, "dq" shorthand, no-show, unknown
  ["Lost - went with someone else", { stage: "LOST", lostReason: "WENT_ELSEWHERE" }],
  ["Lost (too expensive)", { stage: "LOST", lostReason: "BUDGET" }],
  ["DQ - wrong number", { stage: "DISQUALIFIED", dqReason: "SPAM" }],
  ["Didn't attend", { stage: "CONSULT_NO_SHOW" }],
  ["Pending Update", null],
  ["something weird", undefined],
];
for (const [raw, expected] of cases) assert.deepEqual(classifyStatus(raw), expected, JSON.stringify(raw));

// Client mapping beats the classifier; unknown values are counted, not guessed
const unmapped: Record<string, number> = {};
assert.deepEqual(resolveStatus("WON", { won: { stage: "QUOTE_SENT" } }, unmapped), { stage: "QUOTE_SENT" });
assert.deepEqual(resolveStatus("N/A", {}, unmapped), { stage: null });
assert.equal(resolveStatus("Mystery 🤔", {}, unmapped), undefined);
resolveStatus("mystery", {}, unmapped);
assert.deepEqual(unmapped, { mystery: 2 });

// Both columns empty → the fallback (Chase Up when a status column exists)
assert.equal(combineTargets({ stage: null }, undefined, "CHASE_UP").final.stage, "CHASE_UP");
assert.equal(combineTargets(classifyStatus("LIVE TRANSFER")!, classifyStatus("BOOKED")!, "CHASE_UP").final.stage, "CONSULT_BOOKED");

console.log("status-classifier: all checks passed");
