// Run: npx tsx lib/date-range.check.ts — throws on the first failure.
import assert from "node:assert/strict";
import { parseReportRange, previousReportRange, reportRangeQuery, resolveReportRange } from "./date-range";

const q = (s: string) => new URLSearchParams(s);
// 2 Oct 2026 09:00 Sydney (AEST, DST starts 4 Oct 2026).
const now = new Date("2026-10-01T23:00:00Z");

// This month = 1 Oct Sydney midnight → now.
assert.deepEqual(resolveReportRange({ preset: "this_month" }, now), { from: new Date("2026-09-30T14:00:00Z"), to: now });
// Last month = all of September, Sydney.
assert.deepEqual(resolveReportRange({ preset: "last_month" }, now), { from: new Date("2026-08-31T14:00:00Z"), to: new Date("2026-09-30T14:00:00Z") });
// Last 3 months = 1 Aug → now.
assert.equal(resolveReportRange({ preset: "last_3_months" }, now).from!.toISOString(), "2026-07-31T14:00:00.000Z");
// Since start has no lower bound (the server clamps to the start date).
assert.deepEqual(resolveReportRange({ preset: "since_start" }, now), {});
// Custom is inclusive of both days; 5 Oct is AEDT (+11).
assert.deepEqual(resolveReportRange({ preset: "custom", from: "2026-10-01", to: "2026-10-05" }, now), {
  from: new Date("2026-09-30T14:00:00Z"),
  to: new Date("2026-10-05T13:00:00Z"),
});

// URL round trip; bad or reversed customs.
assert.deepEqual(parseReportRange(q(reportRangeQuery({ preset: "custom", from: "2026-09-01", to: "2026-09-10" }))), { preset: "custom", from: "2026-09-01", to: "2026-09-10" });
assert.deepEqual(parseReportRange(q("range=custom&from=2026-09-10&to=2026-09-01")), { preset: "custom", from: "2026-09-01", to: "2026-09-10" });
assert.deepEqual(parseReportRange(q("range=custom&from=2026-02-31&to=2026-03-01")), { preset: "since_start" });
assert.deepEqual(parseReportRange(q("range=nope")), { preset: "since_start" });
assert.deepEqual(parseReportRange(q("range=last_month")), { preset: "last_month" });

// Previous periods.
const p1 = previousReportRange({ preset: "this_month" }, now)!; // 1–2 Sep
assert.deepEqual([p1.from.toISOString(), p1.to.toISOString()], ["2026-08-31T14:00:00.000Z", "2026-09-02T14:00:00.000Z"]);
assert.match(p1.label, /^1–2 Sept?$/); // ICU builds differ on "Sep"/"Sept"
const p2 = previousReportRange({ preset: "this_month" }, new Date("2026-03-31T01:00:00Z"))!; // 31 Mar → 1–28 Feb
assert.equal(p2.label, "1–28 Feb");
assert.equal(previousReportRange({ preset: "last_month" }, now)!.label, "Aug");
assert.equal(previousReportRange({ preset: "last_3_months" }, now)!.label, "May–Jul");
const p3 = previousReportRange({ preset: "custom", from: "2026-09-11", to: "2026-09-20" }, now)!; // 10 days before
assert.match(p3.label, /^1 Sept? 2026 – 10 Sept? 2026$/);
assert.equal(previousReportRange({ preset: "since_start" }, now), null);

console.log("date-range: all checks passed");
