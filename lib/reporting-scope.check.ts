// Run: npx tsx lib/reporting-scope.check.ts — throws on the first failure.
import assert from "node:assert/strict";
import { _test, clampRange, dayList } from "./reporting-scope";
import { sydneyLocalToDate } from "./sheet-parse";

const { entry } = _test;
const start = sydneyLocalToDate(2026, 9, 1)!; // 1 Sep 2026 00:00 Sydney

// Default rule: started on/after the start date (as Sydney days) = ours.
assert.equal(entry("a", "A", "ACTIVE", "2026-09-01T09:00:00+1000", null, start).defaultIncluded, true);
assert.equal(entry("a", "A", "ACTIVE", "2026-08-31T23:59:00+1000", null, start).defaultIncluded, false);
// Meta's UTC timestamp for 1 Sep 08:00 Sydney is still 31 Aug in UTC — compared in Sydney, so included.
assert.equal(entry("a", "A", "ACTIVE", "2026-08-31T22:00:00Z", null, start).defaultIncluded, true);
// No start date, or an unknown campaign start → included.
assert.equal(entry("a", "A", "ACTIVE", "2020-01-01", null, null).included, true);
assert.equal(entry("a", "A", "ACTIVE", null, null, start).included, true);
// Overrides win both ways.
assert.equal(entry("a", "A", "ACTIVE", "2020-01-01", true, start).included, true);
assert.equal(entry("a", "A", "ACTIVE", "2026-10-01", false, start).included, false);

// Ranges never reach before the start date; open "Maximum" = start → to.
const to = new Date("2026-10-02T00:00:00Z");
assert.deepEqual(clampRange({ to }, start), { to, from: start });
assert.deepEqual(clampRange({ from: new Date("2026-01-01"), to }, start), { from: start, to });
const later = new Date("2026-09-15T00:00:00Z");
assert.deepEqual(clampRange({ from: later }, start), { from: later });
assert.deepEqual(clampRange({}, null), {});

assert.deepEqual(dayList("2026-02-27", "2026-03-01"), ["2026-02-27", "2026-02-28", "2026-03-01"]);

console.log("reporting-scope: all checks passed");
