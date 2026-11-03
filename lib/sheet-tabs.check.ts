// Run: npx tsx lib/sheet-tabs.check.ts — throws on the first failure.
import assert from "node:assert/strict";
import { combineTabs, sheetTabs } from "./sheet-tabs";
import { _test, findLeadRow } from "./sheet-writeback";
import { duplicateRows } from "./reconcile";

const values = (headers: string[], rows: string[][]) => ({ headers, rows, cells: rows.map((r) => [...r]) });

// sheetTabs: primary first, no duplicates; no list = just the primary.
assert.deepEqual(sheetTabs({ sheetName: "Leads", sheetNames: [] }), ["Leads"]);
assert.deepEqual(sheetTabs({ sheetName: "Jan", sheetNames: ["Jan", "Feb", "Jan"] }), ["Jan", "Feb"]);
assert.deepEqual(sheetTabs({ sheetName: "Feb", sheetNames: ["Jan", "Feb"] }), ["Feb", "Jan"]);

// One tab comes back exactly as read.
const one = combineTabs([{ tab: "Leads", values: values(["Name", "", "Email"], [["Amy", "x", "a@x.com"]]) }]);
assert.deepEqual(one.headers, ["Name", "", "Email"]);
assert.deepEqual(one.rows, [["Amy", "x", "a@x.com"]]);
assert.deepEqual(one.rowTabs, ["Leads"]);
assert.deepEqual(one.rowNumbers, [2]);

// Two tabs: columns in a different order and spelling line up by header;
// a column only the second tab has is appended; a blank header never merges.
const two = combineTabs([
  { tab: "Jan", values: values(["Name", "Email", "HIVE STATUS", ""], [["Amy", "a@x.com", "CHASE UP", "j1"], ["Bob", "b@x.com", "LIVE TRANSFER", "j2"]]) },
  { tab: "Feb", values: values(["email ", "hive status", "Name", "Campaign", ""], [["c@x.com", "WON", "Cat", "Spring", "f1"]]) },
]);
assert.deepEqual(two.headers, ["Name", "Email", "HIVE STATUS", "", "Campaign"]);
assert.deepEqual(two.rows[2], ["Cat", "c@x.com", "WON", "", "Spring"]);
assert.deepEqual(two.rows[0], ["Amy", "a@x.com", "CHASE UP", "j1", ""]);
assert.deepEqual(two.rowTabs, ["Jan", "Jan", "Feb"]);
assert.deepEqual(two.rowNumbers, [2, 3, 2]);
assert.equal(two.cells[2][1], "c@x.com");

// A header repeated within a tab stays two columns.
const rep = combineTabs([
  { tab: "A", values: values(["Name", "Notes", "Notes"], [["Amy", "n1", "n2"]]) },
  { tab: "B", values: values(["Notes", "Name", "Notes"], [["m1", "Bob", "m2"]]) },
]);
assert.deepEqual(rep.headers, ["Name", "Notes", "Notes"]);
assert.deepEqual(rep.rows[1], ["Bob", "m1", "m2"]);

// Write-back finds the lead on its own tab first, then any other tab, with
// that tab's own column positions.
const sheet = { statusColumn: "HIVE STATUS", resultStatusColumn: null };
const jan = _test.indexTab("Jan", ["Name", "Email", "HIVE STATUS"], [["Amy", "a@x.com", ""], ["Dup", "d@x.com", ""]], sheet);
const feb = _test.indexTab("Feb", ["HIVE STATUS", "Email", "Name"], [["", "c@x.com", "Cat"], ["", "d@x.com", "Dup"]], sheet);
const lead = (email: string, sheetTab: string | null) => ({ name: null, phone: null, email, sheetTab });
assert.equal(findLeadRow([jan, feb], lead("c@x.com", null))?.t.tab, "Feb");
assert.equal(findLeadRow([jan, feb], lead("c@x.com", null))?.row, 0);
assert.equal(findLeadRow([jan, feb], lead("d@x.com", "Feb"))?.t.tab, "Feb");
assert.equal(findLeadRow([jan, feb], lead("d@x.com", "Jan"))?.t.tab, "Jan");
assert.equal(findLeadRow([jan, feb], lead("d@x.com", "Gone"))?.t.tab, "Jan");
assert.equal(findLeadRow([jan, feb], lead("nobody@x.com", "Jan")), null);
assert.ok(feb.allowed.has("HIVE STATUS"));

// Duplicates across tabs report each row's own tab and row number.
const cells = (email: string) => ({ name: "", email, phone: "", hive: "", prospect: "" });
const dups = duplicateRows(
  new Map([
    [0, { ...cells("d@x.com"), lead: "L1", tab: "Jan", sheetRow: 3 }],
    [1, { ...cells("d@x.com"), lead: "L1", tab: "Feb", sheetRow: 2 }],
  ]),
  new Set([1])
);
assert.deepEqual(dups.map((d) => [d.row, d.tab, d.keptRow, d.keptTab, d.match]), [[3, "Jan", 2, "Feb", "email"]]);

console.log("sheet-tabs: all checks passed");
