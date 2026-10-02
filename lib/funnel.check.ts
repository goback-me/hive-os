// Run: npx tsx lib/funnel.check.ts — throws on the first failure.
import assert from "node:assert/strict";
import { addLead, biggestDrop, emptyCounts, funnelRates, reachedRank, type FunnelLead } from "./funnel";
import { STAGE_RANK } from "./lead-status";

const lead = (p: Partial<FunnelLead>): FunnelLead => ({ campaign: "A", stage: "CHASE_UP", dqPhase: null, dqReason: null, lostReason: null, eventStages: [], ...p });

// Won reaches everything; open leads by current stage or events
assert.equal(reachedRank(lead({ stage: "WON" })), STAGE_RANK.WON);
assert.equal(reachedRank(lead({ stage: "NURTURE", eventStages: ["CONSULT_BOOKED"] })), STAGE_RANK.CONSULT_BOOKED);
// DQ only gets credit for stages passed / its phase
assert.equal(reachedRank(lead({ stage: "DISQUALIFIED", dqPhase: "PRE_CONTACT", eventStages: ["DISQUALIFIED"] })), 0);
assert.equal(reachedRank(lead({ stage: "DISQUALIFIED", dqPhase: "POST_CONTACT" })), STAGE_RANK.CONTACTED);
assert.equal(reachedRank(lead({ stage: "LOST", eventStages: ["QUOTE_SENT", "LOST"] })), STAGE_RANK.QUOTE_SENT);

const c = emptyCounts();
[
  lead({}),
  lead({ stage: "CHASE_UP" }),
  lead({ stage: "DISQUALIFIED", dqPhase: "PRE_CONTACT", dqReason: "SPAM" }),
  lead({ stage: "CONTACTED" }),
  lead({ stage: "DISQUALIFIED", dqPhase: "POST_HANDOVER", dqReason: "BUDGET", eventStages: ["HANDOVER_LIVE"] }),
  lead({ stage: "CONSULT_NO_SHOW", eventStages: ["HANDOVER_TEXT", "CONSULT_BOOKED"] }),
  lead({ stage: "LOST", lostReason: "GHOSTED", eventStages: ["HANDOVER_LIVE", "CONSULT_ATTENDED", "QUOTE_SENT"] }),
  lead({ stage: "WON" }),
].forEach((l) => addLead(c, l));

assert.equal(c.leads, 8);
assert.equal(c.contacted, 5); // CONTACTED, DQ post-handover, no-show, lost, won
assert.equal(c.qualified, 4);
assert.equal(c.handovers, 4);
assert.equal(c.liveTransfers, 2);
assert.equal(c.consultsBooked, 3);
assert.equal(c.noShows, 1);
assert.equal(c.consultsAttended, 2);
assert.equal(c.quotes, 2);
assert.equal(c.won, 1);
assert.equal(c.dq, 2);
assert.equal(c.dqByPhase.PRE_CONTACT, 1);
assert.equal(c.dqByReason.BUDGET, 1);
assert.equal(c.lostByReason.GHOSTED, 1);

const r = funnelRates(c);
assert.equal(r.contactRate, 62.5);
assert.equal(r.closeRate, 50);
assert.equal(r.overallConversion, 12.5);

// Too-small samples are skipped; contact is the only step with >= 5
const drop = biggestDrop(c);
assert.equal(drop?.step, "Lead → contacted");
assert.match(drop!.advice, /Offer\/intent/);

console.log("funnel: all checks passed");
