// Run: npx tsx lib/account-management.check.ts — throws on the first failure.
import assert from "node:assert/strict";
import { callStats, clientsCsv, kpiTrend, loggedOnTime, weekCell, type StatCall } from "./account-management";

const H = 3_600_000;
const now = new Date("2026-10-10T00:00:00Z");
const at = (h: number) => new Date(now.getTime() - h * H);
const call = (o: Partial<StatCall>): StatCall => ({ clientId: "c1", callPersonId: "u1", scheduledAt: at(100), status: "HELD", loggedAt: null, emailedToClientAt: null, dayAfterAt: null, ...o });

// On time = logged within 24h of the day-after reminder (or before it went).
assert.equal(loggedOnTime({ scheduledAt: at(100), loggedAt: at(99), dayAfterAt: null }), true, "same day");
assert.equal(loggedOnTime({ scheduledAt: at(100), loggedAt: at(53), dayAfterAt: at(76) }), true, "23h after the reminder");
assert.equal(loggedOnTime({ scheduledAt: at(100), loggedAt: at(50), dayAfterAt: at(76) }), false, "26h after the reminder");
assert.equal(loggedOnTime({ scheduledAt: at(100), loggedAt: null, dayAfterAt: null }), false);

const s = callStats(
  [
    call({ status: "HELD", loggedAt: at(98), emailedToClientAt: at(98) }),
    call({ status: "HELD", loggedAt: at(10), dayAfterAt: at(76) }), // late
    call({ status: "RESCHEDULED" }),
    call({ status: "NOT_HELD", loggedAt: at(99) }),
    call({ status: "PENDING", scheduledAt: at(30) }), // not logged
    call({ status: "PENDING", scheduledAt: new Date(now.getTime() + 48 * H) }), // future — not due
  ],
  now
);
assert.deepEqual(s, { due: 5, held: 2, rescheduled: 1, notHeld: 1, notLogged: 1, emailed: 1, onTimePct: 67, avgDaysToLog: 1.3 });
assert.deepEqual(callStats([], now), { due: 0, held: 0, rescheduled: 0, notHeld: 0, notLogged: 0, emailed: 0, onTimePct: null, avgDaysToLog: null });

// Weekly grid: the most telling status wins.
assert.equal(weekCell([{ status: "RESCHEDULED", scheduledAt: at(50) }, { status: "HELD", scheduledAt: at(10) }], now), "HELD");
assert.equal(weekCell([{ status: "PENDING", scheduledAt: at(10) }], now), "NOT_LOGGED");
assert.equal(weekCell([{ status: "PENDING", scheduledAt: new Date(now.getTime() + H) }], now), "UPCOMING");
assert.equal(weekCell([{ status: "RESCHEDULED", scheduledAt: at(5) }], now), "RESCHEDULED");
assert.equal(weekCell([], now), "NONE");

assert.equal(kpiTrend(["green", "green", "red", null]), "up");
assert.equal(kpiTrend(["red", "amber", null]), "down");
assert.equal(kpiTrend([null, "amber"]), "flat");

// CSV: quoted when needed, AU dates.
const csv = clientsCsv([
  { id: "c1", name: 'Jake "JJ", Co', slug: "jake", amId: "u1", am: "Sam", slot: "Every Fri 10:00", next: { id: "n", at: "2026-10-15T23:00:00.000Z" }, last: null, outcome: null, health: { level: "AT_RISK", reasons: [], override: null, effective: "AT_RISK" }, comment: "Line1\nLine2", awaiting: 3, trend: "down" },
]);
const [head, row] = csv.split("\r\n");
assert.match(head, /^Client,Account manager,Regular call,Next call/);
assert.ok(row.startsWith('"Jake ""JJ"", Co",Sam,Every Fri 10:00,"16/10/2026, 10:00 am"'), row);
assert.ok(csv.includes('"Line1\nLine2"'));

console.log("account-management: all checks passed");
