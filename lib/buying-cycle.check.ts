// Run: npx tsx lib/buying-cycle.check.ts — throws on the first failure.
import assert from "node:assert/strict";
import { CYCLE_DEFAULTS, learnFromGaps, median, parseCycleOverrides, resolveStep } from "./buying-cycle";
import { isDueOn, nextReminderAt, reminderPlan, stepAnchor } from "./reminders";

// ── Median ──
assert.equal(median([]), null);
assert.equal(median([5]), 5);
assert.equal(median([9, 1, 5]), 5);
assert.equal(median([1, 2, 3, 10]), 2.5);

// Negative gaps (bad dates) and missing ends are left out of the sample.
const learned = learnFromGaps([
  { handoverToAttended: 2, attendedToQuote: null, quoteToClose: 30 },
  { handoverToAttended: 4, attendedToQuote: 3, quoteToClose: -5 },
  { handoverToAttended: 6, attendedToQuote: null, quoteToClose: 40 },
]);
assert.deepEqual(learned.handoverToAttended, { medianDays: 4, n: 3 });
assert.deepEqual(learned.attendedToQuote, { medianDays: 3, n: 1 });
assert.deepEqual(learned.quoteToClose, { medianDays: 35, n: 2 });

// ── n < 5 → the client type's default ──
assert.deepEqual(resolveStep("quoteToClose", { medianDays: 35, n: 4 }, "TRADE", {}), { medianDays: 30, n: 4, learnedDays: 35, source: "default" });
assert.equal(resolveStep("quoteToClose", { medianDays: null, n: 0 }, "SERVICE", {}).medianDays, 14);
assert.equal(resolveStep("attendedToQuote", { medianDays: null, n: 0 }, "OTHER", {}).medianDays, 7);
assert.equal(CYCLE_DEFAULTS.TRADE.attendedToQuote, 7);
// n ≥ 5 → learned
assert.deepEqual(resolveStep("quoteToClose", { medianDays: 35, n: 12 }, "TRADE", {}), { medianDays: 35, n: 12, learnedDays: 35, source: "learned" });

// ── Override beats learned and default ──
assert.deepEqual(resolveStep("quoteToClose", { medianDays: 35, n: 12 }, "TRADE", { quoteToClose: 45 }), { medianDays: 45, n: 12, learnedDays: 35, source: "override" });
assert.equal(resolveStep("quoteToClose", { medianDays: null, n: 0 }, "TRADE", { quoteToClose: 45 }).source, "override");
// Only positive numbers for known steps survive.
assert.deepEqual(parseCycleOverrides({ quoteToClose: 45, attendedToQuote: "", handoverToAttended: -3, junk: 9 }), { quoteToClose: 45 });
assert.deepEqual(parseCycleOverrides(null), {});

// ── Reminder dates per step ──
const DAY = 86_400_000;
const t0 = new Date("2026-09-01T00:00:00Z");
const at = (d: Date) => Math.round((d.getTime() - t0.getTime()) / DAY);
const cycle = { handoverToAttended: 10, attendedToQuote: 8, quoteToClose: 30 };

// PENDING UPDATE: 7 days after handover, every 7, stale at 14.
let p = reminderPlan("awaiting", t0, cycle);
assert.deepEqual([at(p.first), p.everyDays, at(p.staleAt)], [7, 7, 14]);
assert.equal(at(nextReminderAt(p, null)), 7);
assert.equal(at(nextReminderAt(p, new Date(t0.getTime() + 7 * DAY))), 14);

// CONSULT_BOOKED: 1 day after the consult if known, else handover + median; stale at 2×.
p = reminderPlan("CONSULT_BOOKED", t0, cycle);
assert.deepEqual([at(p.first), at(p.staleAt)], [10, 20]);
assert.equal(at(reminderPlan("CONSULT_BOOKED", t0, cycle, new Date(t0.getTime() + 3 * DAY)).first), 4);

// CONSULT_ATTENDED: at the median, then every half of it.
p = reminderPlan("CONSULT_ATTENDED", t0, cycle);
assert.deepEqual([at(p.first), p.everyDays, at(p.staleAt)], [8, 4, 16]);
assert.equal(at(nextReminderAt(p, new Date(t0.getTime() + 8 * DAY))), 12);

// QUOTE_SENT: at the median, then every max(7, median / 2).
p = reminderPlan("QUOTE_SENT", t0, cycle);
assert.deepEqual([at(p.first), p.everyDays, at(p.staleAt)], [30, 15, 60]);
assert.equal(reminderPlan("QUOTE_SENT", t0, { ...cycle, quoteToClose: 10 }).everyDays, 7);

// A reminder sent early can't pull the next one before the first date.
assert.equal(at(nextReminderAt(reminderPlan("QUOTE_SENT", t0, cycle), new Date(t0.getTime() + DAY))), 30);

// Due by Sydney day: the 9am run sends everything due that day.
assert.equal(isDueOn(new Date("2026-09-08T05:00:00Z"), new Date("2026-09-08T00:00:00Z")), true); // same Sydney day (8 Sep)
assert.equal(isDueOn(new Date("2026-09-08T15:00:00Z"), new Date("2026-09-08T00:00:00Z")), false); // 9 Sep in Sydney

// Each step is timed from its own start.
const base = { stage: "QUOTE_SENT" as const, awaiting: false, handoverAt: t0, createdAt: new Date(0), bookedAt: null, attendedAt: null, quoteAt: new Date(t0.getTime() + 5 * DAY), stageSince: null };
assert.equal(at(stepAnchor(base)), 5);
assert.equal(at(stepAnchor({ ...base, awaiting: true })), 0); // awaiting → the handover
assert.equal(stepAnchor({ ...base, quoteAt: null }).getTime(), 0); // nothing dated → opt-in

console.log("buying-cycle: all checks passed");
