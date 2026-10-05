// Run: npx tsx lib/sheet-writeback.check.ts — throws on the first failure.
import assert from "node:assert/strict";
import { TARGET_OPTIONS, parseTarget, type LeadStageValue, type StageTarget } from "./lead-status";
import { classifyHive, classifyProspect } from "./status-classifier";
import { automationWrites, planStageWrite, plainText, stageChangeWrites, writeValueFor } from "./sheet-writeback";

type T = StageTarget & { stage: LeadStageValue };
const base = {
  statusColumn: "HIVE STATUS",
  resultStatusColumn: "Prospect Status",
  statusMapping: null,
  resultStatusMapping: null,
  statusOptions: [] as string[],
  resultStatusOptions: [] as string[],
  writeMapping: null as unknown,
};

// Free-text columns: every stage (+ reason) is written as text the sync reads
// back as exactly that stage, in both columns.
for (const o of TARGET_OPTIONS) {
  const t = parseTarget(o.value) as T;
  const text = plainText(t);
  const back = t.stage === "CHASE_UP" ? classifyHive(text) : classifyProspect(text);
  assert.deepEqual(back, t, `${o.value} → "${text}"`);
}

// Dropdown columns: the first option that reads back as the exact target,
// else one with the same stage; nothing → null.
const sheet = {
  ...base,
  statusOptions: ["New Lead", "Chase up", "Lead Contacted", "LIVE TRANSFER", "Text hand over", "Client contacted", "Not ready yet", "DISQUALIFIED", "Too far"],
  resultStatusOptions: ["N/A", "PENDING UPDATE", "AUTO BOOKED", "BOOKED", "Attended booking", "QUOTED", "WON", "LOST", "QUOTED - LOST", "Disqualified budget", "DISQUALIFIED - DISTANCE"],
};
assert.equal(writeValueFor({ stage: "HANDOVER_LIVE" }, "status", sheet), "LIVE TRANSFER");
assert.equal(writeValueFor({ stage: "DISQUALIFIED", dqReason: "LOCATION" }, "result", sheet), "DISQUALIFIED - DISTANCE");
assert.equal(writeValueFor({ stage: "DISQUALIFIED", dqReason: "BUDGET" }, "result", sheet), "Disqualified budget");
// No exact reason → same stage: LOST:GHOSTED → "LOST"
assert.equal(writeValueFor({ stage: "LOST", lostReason: "GHOSTED" }, "result", sheet), "LOST");
assert.equal(writeValueFor({ stage: "CONSULT_NO_SHOW" }, "result", sheet), null);
// Coach override wins (when it's a real option)
assert.equal(writeValueFor({ stage: "WON" }, "result", { ...sheet, writeMapping: { result: { WON: "QUOTED" } } }), "QUOTED");
assert.equal(writeValueFor({ stage: "WON" }, "result", { ...sheet, writeMapping: { result: { WON: "Typo" } } }), "WON");

// Column choice: outreach → HIVE STATUS, outcomes → Prospect Status, DQ where the lead was.
assert.deepEqual(planStageWrite({ stage: "CONTACTED" }, null, sheet), { column: "HIVE STATUS", value: "Lead Contacted" });
assert.deepEqual(planStageWrite({ stage: "WON" }, null, sheet), { column: "Prospect Status", value: "WON" });
assert.deepEqual(planStageWrite({ stage: "DISQUALIFIED", dqReason: "LOCATION" }, "PRE_CONTACT", sheet), { column: "HIVE STATUS", value: "Too far" });
assert.deepEqual(planStageWrite({ stage: "DISQUALIFIED", dqReason: "LOCATION" }, "POST_HANDOVER", sheet), { column: "Prospect Status", value: "DISQUALIFIED - DISTANCE" });
// Preferred column has nothing → the other one; neither → an error to show.
assert.deepEqual(planStageWrite({ stage: "CONSULT_ATTENDED" }, null, { ...sheet, resultStatusOptions: ["N/A"] }), { error: 'No "Consult Attended" option in the sheet\'s status dropdowns — pick one in Leads settings' });
assert.ok("error" in planStageWrite({ stage: "WON" }, null, { ...base, statusColumn: null, resultStatusColumn: null }));

// Won writes the job value to Revenue (else Quote Value); quoted → Quote Value.
const cols = { ...sheet, allColumns: ["Name", "HIVE STATUS", "Prospect Status", "Quote Value", "Revenue Generated"] };
const lead = { stage: "WON" as const, dqReason: null, lostReason: null, dqPhase: null, value: 12000 };
assert.deepEqual(stageChangeWrites(lead, cols).writes, [
  { column: "Prospect Status", value: "WON" },
  { column: "Revenue Generated", value: "12000" },
]);
assert.deepEqual(stageChangeWrites({ ...lead, stage: "QUOTE_SENT" }, cols).writes[1], { column: "Quote Value", value: "12000" });

// Automation fills only blanks.
const auto = (hive: string, prospect: string) => automationWrites({ raw: hive, stage: classifyHive(hive)?.stage ?? null }, prospect, sheet);
assert.deepEqual(auto("", ""), [{ column: "HIVE STATUS", value: "Chase up" }]);
assert.deepEqual(auto("New lead", "N/A"), [{ column: "HIVE STATUS", value: "Chase up" }]);
assert.deepEqual(auto("LIVE TRANSFER", ""), [{ column: "Prospect Status", value: "PENDING UPDATE" }]);
// Only HANDOVER_STAGES get PENDING UPDATE — Not ready yet / Client contacted don't.
assert.deepEqual(auto("Not ready yet", "N/A"), []);
assert.deepEqual(automationWrites({ raw: "LIVE ATTEMPTED", stage: "HANDOVER_ATTEMPTED" }, "N/A", sheet), [{ column: "Prospect Status", value: "PENDING UPDATE" }]);
assert.deepEqual(auto("Self booked", ""), [{ column: "Prospect Status", value: "AUTO BOOKED" }]);
assert.deepEqual(auto("LIVE TRANSFER", "BOOKED"), []); // client already updated
assert.deepEqual(auto("DISQUALIFIED", "N/A"), []); // stays N/A
assert.deepEqual(auto("Chase up", ""), []);
assert.deepEqual(auto("Live attempted", ""), [{ column: "Prospect Status", value: "PENDING UPDATE" }]); // details sent = a handover
// A dropdown with no "pending update" option → nothing written (never off-list).
assert.deepEqual(automationWrites({ raw: "LIVE TRANSFER", stage: "HANDOVER_LIVE" }, "", { ...sheet, resultStatusOptions: ["N/A", "WON"] }), []);
// Free-text column → the literal text.
assert.deepEqual(automationWrites({ raw: "LIVE TRANSFER", stage: "HANDOVER_LIVE" }, "", base), [{ column: "Prospect Status", value: "PENDING UPDATE" }]);

console.log("sheet-writeback: all checks passed");
