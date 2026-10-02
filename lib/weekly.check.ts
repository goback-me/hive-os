// Run: npx tsx lib/weekly.check.ts — throws on the first failure.
import assert from "node:assert/strict";
import { weekStart } from "./weekly";

// Thu 2 Oct 2026, 11:00 Sydney (AEST) → Mon 28 Sep 00:00 AEST = 27 Sep 14:00Z
assert.equal(weekStart(new Date("2026-10-02T01:00:00Z")).toISOString(), "2026-09-27T14:00:00.000Z");
// Sun 4 Oct, after DST starts → still the week of Mon 28 Sep
assert.equal(weekStart(new Date("2026-10-04T05:00:00Z")).toISOString(), "2026-09-27T14:00:00.000Z");
// Mon 5 Oct 01:00 AEDT (= 4 Oct 14:00Z) → Mon 5 Oct 00:00 AEDT = 4 Oct 13:00Z
assert.equal(weekStart(new Date("2026-10-04T14:00:00Z")).toISOString(), "2026-10-04T13:00:00.000Z");
// Late Sunday UTC that's already Monday in Sydney
assert.equal(weekStart(new Date("2026-09-27T15:00:00Z")).toISOString(), "2026-09-27T14:00:00.000Z");

console.log("weekly: all checks passed");
