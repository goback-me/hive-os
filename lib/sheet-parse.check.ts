// Run: npx tsx lib/sheet-parse.check.ts — throws on the first failure.
import assert from "node:assert/strict";
import { findColumn, normalizePhone, normalizeStatus, parseSheetDate, serialToDate } from "./sheet-parse";

// Status normalization
assert.equal(normalizeStatus("DISQUALIFIED "), "disqualified");
assert.equal(normalizeStatus(":phone: Lead Contacted :phone:"), "lead contacted");
assert.equal(normalizeStatus("📞 Lead contacted"), "lead contacted");
assert.equal(normalizeStatus("Didn't attend"), "didnt attend");
assert.equal(normalizeStatus("N/A"), "n a");
assert.equal(normalizeStatus("DQ - Not Interested"), "dq not interested");

// Phones
assert.equal(normalizePhone("0412 345 678"), "61412345678");
assert.equal(normalizePhone("+61 412 345 678"), "61412345678");
assert.equal(normalizePhone("412345678"), "61412345678");

// Headers: exact beats keyword, exclusions veto
assert.equal(findColumn(["Campaign Name", "Ad Name", "Name"], ["name"], ["campaign", "ad"]), 2);
assert.equal(findColumn(["Campaign Name", "Full Name"], ["name"], ["campaign", "ad"]), 1);
assert.equal(findColumn(["Business Name", "Address"], ["name"], ["business", "ad"]), -1);
assert.equal(findColumn(["UTM Source", "Lead Source"], ["source"], ["utm"]), 1);

// Dates — Sydney local, dd/mm first, never mm/dd
const iso = (d: Date | null) => d?.toISOString();
assert.equal(iso(parseSheetDate("03/04/2026")), "2026-04-02T13:00:00.000Z"); // 3 Apr, AEDT (+11) until 5 Apr
assert.equal(iso(parseSheetDate("15/07/2026 9:30 am")), "2026-07-14T23:30:00.000Z"); // AEST (+10)
assert.equal(iso(parseSheetDate("15/07/2026 21:30")), "2026-07-15T11:30:00.000Z");
assert.equal(parseSheetDate("07/15/2026"), null); // mm/dd rejected
assert.equal(iso(parseSheetDate("2026-01-10")), "2026-01-09T13:00:00.000Z");
assert.equal(iso(parseSheetDate("2026-01-10T05:00:00Z")), "2026-01-10T05:00:00.000Z");
assert.equal(iso(serialToDate(46000)), iso(parseSheetDate("09/12/2025"))); // serial 46000 = 9 Dec 2025
assert.equal(iso(parseSheetDate(46000.5)), iso(parseSheetDate("09/12/2025 12:00")));
assert.equal(parseSheetDate("31/02/2026"), null);

console.log("sheet-parse: all checks passed");
