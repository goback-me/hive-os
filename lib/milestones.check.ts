// Run: npx tsx lib/milestones.check.ts — throws on the first failure.
import assert from "node:assert/strict";
import { getMilestoneDate, leadTimeline } from "./milestones";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const lead = {
  noteEvents: [
    { event: "CALL_ATTEMPT" as const, at: d("2026-09-03") },
    { event: "CALL_ATTEMPT" as const, at: d("2026-09-02") },
    { event: "HANDOVER_TEXT" as const, at: d("2026-09-05") },
  ],
  stageEvents: [
    { stage: "CONTACTED" as const, at: d("2026-09-01"), source: "SYNC" },
    { stage: "HANDOVER_LIVE" as const, at: d("2026-09-04"), source: "SYNC" },
    { stage: "CONSULT_BOOKED" as const, at: d("2026-09-08"), source: "IMPORT" },
    { stage: "QUOTE_SENT" as const, at: d("2026-09-09"), source: "INFERRED" },
    { stage: "WON" as const, at: d("2026-09-20"), source: "MANUAL" },
  ],
};

// The team's first dated note wins over when the sync noticed (9/1).
assert.deepEqual(getMilestoneDate(lead, "CONTACTED"), d("2026-09-02"));
// A step made of several stages: notes first (text handover 9/5), even though
// a stage event (live, 9/4) is earlier.
assert.deepEqual(getMilestoneDate(lead, ["HANDOVER_ATTEMPTED", "HANDOVER_LIVE", "HANDOVER_TEXT"]), d("2026-09-05"));
// No note → first SYNC/MANUAL stage event.
assert.deepEqual(getMilestoneDate(lead, "HANDOVER_LIVE"), d("2026-09-04"));
assert.deepEqual(getMilestoneDate(lead, "WON"), d("2026-09-20"));
// IMPORT / INFERRED times are guesses → unknown.
assert.equal(getMilestoneDate(lead, "CONSULT_BOOKED"), null);
assert.equal(getMilestoneDate(lead, "QUOTE_SENT"), null);

// ── Lead drawer timeline: dates + days since the previous dated step ──
const won = {
  createdAt: d("2026-09-01"),
  stage: "WON" as const,
  noteEvents: [{ event: "NO_PICKUP" as const, at: d("2026-09-02") }, { event: "QUOTE_SENT" as const, at: d("2026-09-20") }],
  stageEvents: [
    { stage: "HANDOVER_LIVE" as const, at: d("2026-09-05"), source: "SYNC" },
    { stage: "CONSULT_BOOKED" as const, at: d("2026-09-05"), source: "IMPORT" }, // import time isn't a real date
    { stage: "WON" as const, at: d("2026-09-30"), source: "MANUAL" },
  ],
};
assert.deepEqual(
  leadTimeline(won).map((s) => [s.key, s.at && s.at.toISOString().slice(0, 10), s.days]),
  [["optin", "2026-09-01", null], ["contacted", "2026-09-02", 1], ["handover", "2026-09-05", 3], ["booked", null, null], ["quoted", "2026-09-20", 15], ["outcome", "2026-09-30", 10]]
);
assert.equal(leadTimeline(won).at(-1)!.label, "Won");
assert.equal(leadTimeline({ ...won, stage: "QUOTE_SENT" }).length, 5, "no outcome step while the deal is open");
assert.equal(leadTimeline({ ...won, stage: "DISQUALIFIED" }).at(-1)!.label, "Disqualified");

console.log("milestones: all checks passed");
