// Run: npx tsx lib/reconcile.check.ts — throws on the first failure.
import assert from "node:assert/strict";
import { countValues, reconcile, type SideCounts } from "./reconcile";

// Fixture sheet: 5 rows — one is a duplicate of Jane (same email), so HQ
// holds 4 leads; one Won row has $12,000.
const sheetRows = [
  { email: "jane@x.com", hive: "LIVE TRANSFER", prospect: "WON", value: 12000 },
  { email: "jane@x.com", hive: "LIVE TRANSFER", prospect: "WON", value: 12000 },
  { email: "bob@x.com", hive: "Lead Contacted", prospect: "", value: null },
  { email: "amy@x.com", hive: "DISQUALIFIED", prospect: "N/A", value: null },
  { email: "tom@x.com", hive: "", prospect: "", value: null },
];
const sheet: SideCounts = {
  rows: sheetRows.length,
  hive: countValues(sheetRows.map((r) => r.hive)),
  prospect: countValues(sheetRows.map((r) => r.prospect)),
  won: sheetRows.filter((r) => r.prospect === "WON").length,
  wonValue: sheetRows.reduce((s, r) => s + (r.prospect === "WON" ? r.value ?? 0 : 0), 0),
  unmatched: sheetRows.length - new Set(sheetRows.map((r) => r.email)).size,
};
assert.deepEqual(sheet.hive, { "LIVE TRANSFER": 2, "Lead Contacted": 1, DISQUALIFIED: 1 });
assert.deepEqual(sheet.prospect, { WON: 2, "N/A": 1 });

// HQ after a correct sync: the duplicate collapsed into one lead.
const hq: SideCounts = {
  rows: 4,
  hive: { "LIVE TRANSFER": 1, "Lead Contacted": 1, DISQUALIFIED: 1 },
  prospect: { WON: 1, "N/A": 1 },
  won: 1,
  wonValue: 12000,
  unmatched: 0,
};
assert.deepEqual(reconcile(sheet, hq), [
  { metric: "Leads (non-blank rows vs active leads)", sheet: 5, hq: 4 },
  { metric: 'HIVE STATUS "LIVE TRANSFER"', sheet: 2, hq: 1 },
  { metric: 'Prospect Status "WON"', sheet: 2, hq: 1 },
  { metric: "Won", sheet: 2, hq: 1 },
  { metric: "Won job value ($)", sheet: 24000, hq: 12000 },
  { metric: "Sheet rows with no lead of their own (duplicate email/phone/name)", sheet: 1, hq: 0 },
]);

// Same data both sides → nothing to report.
const clean = { ...sheet, unmatched: 0 };
assert.deepEqual(reconcile(clean, { ...clean }), []);

// A lead HQ lost track of, and a status value read differently.
assert.deepEqual(reconcile(clean, { ...clean, unmatched: 2, hive: { ...clean.hive, "Lead Contacted": 0 } }), [
  { metric: 'HIVE STATUS "Lead Contacted"', sheet: 1, hq: 0 },
  { metric: "HQ leads with no sheet row", sheet: 0, hq: 2 },
]);
// Cents don't false-alarm.
assert.deepEqual(reconcile({ ...clean, wonValue: 0.1 + 0.2 }, { ...clean, wonValue: 0.3 }), []);

console.log("reconcile: all checks passed");
