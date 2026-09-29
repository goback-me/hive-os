// Run: npx tsx lib/kpi.check.ts — throws on the first failure.
import assert from "node:assert/strict";
import { _test, addMonths, isFreezable, monthKeyOf, toneFor } from "./kpi";
import { parseVisibility, DEFAULT_VISIBILITY } from "./report-visibility";

const { monthWindow } = _test;

// Sydney month edges: 1 Oct 00:00 AEST(+10) = 30 Sep 14:00Z; DST starts 5 Oct 2025.
assert.equal(monthKeyOf(new Date("2026-09-30T13:59:00Z")), "2026-09");
assert.equal(monthKeyOf(new Date("2026-09-30T14:00:00Z")), "2026-10");
const sep = monthWindow("2026-09");
assert.equal(sep.from.toISOString(), "2026-08-31T14:00:00.000Z");
assert.equal(sep.to.toISOString(), "2026-09-30T14:00:00.000Z");
assert.deepEqual([sep.since, sep.until], ["2026-09-01", "2026-09-30"]);
// November is in AEDT (+11): 1 Nov 00:00 = 31 Oct 13:00Z
assert.equal(monthWindow("2026-11").from.toISOString(), "2026-10-31T13:00:00.000Z");
// Partial window (days 1..10) and clamping to month length
assert.equal(monthWindow("2026-09", 10).until, "2026-09-10");
assert.equal(monthWindow("2026-02", 31).until, "2026-02-28");
assert.equal(monthWindow("2026-02", 31).to.toISOString(), monthWindow("2026-03").from.toISOString());

assert.equal(addMonths("2026-01", -1), "2025-12");
assert.equal(addMonths("2026-12", 1), "2027-01");

// Freeze only after month end + 3-day grace
assert.equal(isFreezable("2026-09", new Date("2026-10-02T00:00:00Z")), false);
assert.equal(isFreezable("2026-09", new Date("2026-10-03T14:00:00Z")), true);

// Tones: counts up = green; costs inverted (down = green); ±10% = amber
assert.equal(toneFor("count", 12, 10), "green");
assert.equal(toneFor("count", 8, 10), "red");
assert.equal(toneFor("count", 10.5, 10), "amber");
assert.equal(toneFor("cost", 80, 100), "green");
assert.equal(toneFor("cost", 120, 100), "red");
assert.equal(toneFor("count", 3, 0), "green");
assert.equal(toneFor("cost", 50, null), null);

// Visibility: defaults fill in, junk ignored
assert.deepEqual(parseVisibility(null), DEFAULT_VISIBILITY);
assert.deepEqual(parseVisibility({ showProfit: true, showFunnel: "no" }), { ...DEFAULT_VISIBILITY, showProfit: true });

console.log("kpi.check ok");
