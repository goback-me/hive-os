// Run: npx tsx lib/lead-status.check.ts — throws on the first failure.
import assert from "node:assert/strict";
import { CLIENT_STAGES, combineTargets, parseTarget, planStageEvents, stageText, targetOptionsFor, TARGET_OPTIONS, type StageTarget } from "./lead-status";
import { classifyHive, classifyProspect } from "./status-classifier";

// Same resolution the sync uses: null ("no outcome") → { stage: null }.
const hive = (v: string): StageTarget | undefined => classifyHive(v);
const prospect = (v: string): StageTarget | undefined => {
  const t = classifyProspect(v);
  return t === null ? { stage: null } : t;
};

assert.deepEqual(hive("DQ - Ghosted"), { stage: "DISQUALIFIED", dqReason: "GHOSTED" });

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
assert.equal(combineTargets(undefined, undefined).final.stage, "CHASE_UP");

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
assert.equal(planStageEvents({ oldStage: "CONTACTED", newStage: "DISQUALIFIED", prior: null, eventStages: new Set() }).dqPhase, "POST_CONTACT");
// Nurture is a soft handover, so a DQ after it is post-handover
assert.equal(planStageEvents({ oldStage: "NURTURE", newStage: "DISQUALIFIED", prior: null, eventStages: new Set() }).dqPhase, "POST_HANDOVER");
assert.equal(planStageEvents({ oldStage: "CLIENT_CONTACTED", newStage: "DISQUALIFIED", prior: null, eventStages: new Set() }).dqPhase, "POST_HANDOVER");
// A new lead at the entry stage isn't an event; moving back to it is
assert.equal(planStageEvents({ oldStage: null, newStage: "CHASE_UP", prior: null, eventStages: new Set() }).events.length, 0);
assert.deepEqual(planStageEvents({ oldStage: "CONTACTED", newStage: "CHASE_UP", prior: null, eventStages: new Set(["CONTACTED"]) }).events.map((e) => e.stage), ["CHASE_UP"]);
plan = planStageEvents({ oldStage: null, newStage: "DISQUALIFIED", prior: "HANDOVER_TEXT", eventStages: new Set() });
assert.equal(plan.dqPhase, "POST_HANDOVER");
assert.deepEqual(plan.events.map((e) => `${e.kind}:${e.stage}`), ["change:DISQUALIFIED", "observed:HANDOVER_TEXT", "inferred:CONTACTED"]);

// No change → no events
assert.equal(planStageEvents({ oldStage: "CONTACTED", newStage: "CONTACTED", prior: "CONTACTED", eventStages: new Set(["CONTACTED"]) }).events.length, 0);

// ── Lead drawer quick edit: a client only gets the prospect-side stages ──
const clientOpts = targetOptionsFor("CLIENT").map((o) => o.value.split(":")[0]);
for (const s of ["CHASE_UP", "CONTACTED", "NURTURE", "HANDOVER_LIVE", "HANDOVER_ATTEMPTED", "HANDOVER_TEXT"]) assert.ok(!clientOpts.includes(s), `client can't pick ${s}`);
for (const s of ["CONSULT_BOOKED", "QUOTE_SENT", "WON", "LOST", "DISQUALIFIED"]) assert.ok(clientOpts.includes(s), `client can pick ${s}`);
assert.ok(clientOpts.every((s) => CLIENT_STAGES.includes(s as never)));
assert.equal(targetOptionsFor("COACH"), TARGET_OPTIONS);
assert.equal(stageText({ stage: "DISQUALIFIED", dqReason: "BUDGET", dqPhase: "POST_HANDOVER" }), "DQ · Budget (after handover)");
assert.equal(stageText({ stage: "LOST" }), "Lost · Reason missing");

console.log("lead-status: all checks passed");
