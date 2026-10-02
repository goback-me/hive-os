// Run: npx tsx lib/growth.check.ts — throws on the first failure.
import assert from "node:assert/strict";
import { bestIndex, improvingStreak, metricLabels, momChange, rolling3, summaryLine, toMetrics, type MetricValues } from "./growth";

// 3-month rolling average uses what's there at the start.
assert.deepEqual(rolling3([3, 6, 9, null, 12]), [3, 4.5, 6, 7.5, 10.5]);

// MoM %: nothing to compare with → null.
assert.equal(momChange(12, 10), 20);
assert.equal(momChange(5, 0), null);
assert.equal(momChange(null, 10), null);

// Best closed month; the partial current month can't win; lower is better for costs.
const partial = [false, false, false, true];
assert.equal(bestIndex([4, 9, 7, 20], partial, false), 1);
assert.equal(bestIndex([400, 250, 300, 100], partial, true), 1);
assert.equal(bestIndex([0, 0, 5, 9], partial, false), -1); // only one month worth comparing
assert.equal(bestIndex([null, null, null, 3], partial, false), -1);

// Streak: consecutive improving closed months ending with the latest.
assert.equal(improvingStreak([2, 3, 5, 8, 1], [false, false, false, false, true], false), 3);
assert.equal(improvingStreak([5, 3, 4], [false, false, false], false), 1);
assert.equal(improvingStreak([300, 250, 200], [false, false, false], true), 2);
assert.equal(improvingStreak([1], [false], false), 0);

// Rates and hidden costs.
const v = { leads: 20, contacted: 15, liveTransfers: 8, consultsBooked: 5, quotes: 4, sales: 2, revenue: 18000, spend: 1000, spendSource: "meta" as const, costPerBooking: 200, costPerQuote: 250, costPerSale: 500 };
const m = toMetrics(v, false);
assert.equal(m.contactRate, 75);
assert.equal(m.liveToQuote, 50);
assert.equal(m.closeRate, 50);
assert.equal(toMetrics(v, true).costPerSale, null);
assert.equal(toMetrics({ ...v, leads: 0 }, false).contactRate, null);

// Plain-English summary: the biggest movers (5%+), costs read naturally.
const labels = metricLabels("OTHER");
const base: MetricValues = { leads: 20, liveTransfers: 8, quotes: 4, sales: 2, revenue: 10000, contactRate: 70, liveToQuote: 50, closeRate: 50, costPerQuote: 250, costPerSale: 500 };
// Tiny bases don't count: 2 sales → 0 and revenue → 0 aren't "down 100%".
assert.equal(summaryLine({ ...base, sales: 0, revenue: 0, leads: 15 }, base, labels), "Leads down 25% vs the same days last month.");
assert.equal(summaryLine({ ...base, quotes: 5, costPerSale: 440 }, base, labels), "Quotes up 25% vs the same days last month, cost per sale down 12%.");
assert.equal(summaryLine({ ...base, leads: 20.5 }, base, labels), "Holding steady vs the same days last month.");
const nothing = Object.fromEntries(Object.keys(base).map((k) => [k, 0])) as MetricValues;
assert.match(summaryLine(base, nothing, labels), /Not enough history/);
// Trade wording.
assert.equal(metricLabels("TRADE").sales, "Jobs won");

console.log("growth: all checks passed");
