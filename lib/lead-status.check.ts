// Run: npx tsx lib/lead-status.check.ts — throws on the first failure.
import assert from "node:assert/strict";
import { DEFAULT_RESULT_MAPPING, DEFAULT_STATUS_MAPPING, combineTargets, parseTarget, planStageEvents } from "./lead-status";
import { normalizeStatus } from "./sheet-parse";

const hive = (v: string) => DEFAULT_STATUS_MAPPING[normalizeStatus(v)];
const prospect = (v: string) => DEFAULT_RESULT_MAPPING[normalizeStatus(v)];

// Defaults resolve through normalizeStatus
assert.deepEqual(hive(":phone: Lead Contacted :phone:"), { stage: "CONTACTED" });
assert.deepEqual(hive("DQ - Ghosted"), { stage: "DISQUALIFIED", dqReason: "GHOSTED" });
assert.deepEqual(prospect("Didn't attend"), { stage: "CONSULT_NO_SHOW" });
assert.deepEqual(prospect("N/A"), { stage: null });

// Higher rank wins; prospect "no outcome" keeps the hive stage
let c = combineTargets(hive("Live Transfer"), prospect("Consult Booked"));
assert.equal(c.final.stage, "CONSULT_BOOKED");
c = combineTargets(hive("Live Transfer"), prospect("Pending update"));
assert.equal(c.final.stage, "HANDOVER_LIVE");
// Terminal tie → prospect column wins; prior keeps how far it got
c = combineTargets(hive("DQ spam"), prospect("Won"));
assert.equal(c.final.stage, "WON");
c = combineTargets(hive("Live Transfer"), prospect("DQ budget"));
assert.equal(c.final.stage, "DISQUALIFIED");
assert.equal(c.final.dqReason, "BUDGET");
assert.equal(c.prior, "HANDOVER_LIVE");
assert.equal(combineTargets(undefined, undefined).final.stage, "NEW_LEAD");

// Legacy string mappings still parse
assert.deepEqual(parseTarget("WON"), { stage: "WON" });
assert.deepEqual(parseTarget("DISQUALIFIED"), { stage: "DISQUALIFIED", dqReason: "UNKNOWN" });
assert.deepEqual(parseTarget({ stage: "LOST", lostReason: "BUDGET" }), { stage: "LOST", lostReason: "BUDGET" });
assert.equal(parseTarget("BOGUS"), undefined);

// CHASE_UP → WON infers the whole main path
let plan = planStageEvents({ oldStage: "CHASE_UP", newStage: "WON", prior: null, eventStages: new Set(["CHASE_UP"]) });
assert.deepEqual(
  plan.events.map((e) => `${e.kind}:${e.stage}`),
  ["change:WON", "inferred:CONTACTED", "inferred:HANDOVER_ATTEMPTED", "inferred:CONSULT_BOOKED", "inferred:CONSULT_ATTENDED", "inferred:QUOTE_SENT"]
);

// Existing handover event satisfies the handover step
plan = planStageEvents({ oldStage: "HANDOVER_LIVE", newStage: "CONSULT_BOOKED", prior: null, eventStages: new Set(["CONTACTED", "HANDOVER_LIVE"]) });
assert.deepEqual(plan.events.map((e) => `${e.kind}:${e.stage}`), ["change:CONSULT_BOOKED"]);

// DQ phase from the furthest stage reached
assert.equal(planStageEvents({ oldStage: "CHASE_UP", newStage: "DISQUALIFIED", prior: null, eventStages: new Set() }).dqPhase, "PRE_CONTACT");
assert.equal(planStageEvents({ oldStage: "NURTURE", newStage: "DISQUALIFIED", prior: null, eventStages: new Set() }).dqPhase, "POST_CONTACT");
plan = planStageEvents({ oldStage: null, newStage: "DISQUALIFIED", prior: "HANDOVER_TEXT", eventStages: new Set() });
assert.equal(plan.dqPhase, "POST_HANDOVER");
assert.deepEqual(plan.events.map((e) => `${e.kind}:${e.stage}`), ["change:DISQUALIFIED", "observed:HANDOVER_TEXT", "inferred:CONTACTED"]);

// No change → no events
assert.equal(planStageEvents({ oldStage: "CONTACTED", newStage: "CONTACTED", prior: "CONTACTED", eventStages: new Set(["CONTACTED"]) }).events.length, 0);

console.log("lead-status: all checks passed");
