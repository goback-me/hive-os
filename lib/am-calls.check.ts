// Run: npx tsx lib/am-calls.check.ts — throws on the first failure.
// (DB-backed checks — booking, reschedule, reminders once — are in
// scripts run against a copy of the DB; these are the pure rules.)
import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";
import { signActionToken, verifyActionToken, ACTION_TOKEN_DAYS } from "./action-token";
import { canAccessClient, signInReturnUrl } from "./access";
import {
  CLIENT_CALL_SELECT,
  TEAM_CALL_SELECT,
  buildHistory,
  callInvite,
  callSelectFor,
  callTaskUpdate,
  callUpdatePath,
  clientCallEmail,
  defaultNextCall,
  nextSlot,
  parseCallWhen,
  reminderDue,
  slotLabel,
  splitSteps,
} from "./am-calls";
import { actionLink } from "./email";
import { computeHealth, kpisRed, lastTwoMissed } from "./client-health";
import type { KpiValues } from "./kpi";
import { sydneyDay } from "./sheet-parse";
import { taskText } from "./clickup";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const secret = "test-secret";
const now = new Date("2026-10-05T00:00:00Z"); // Mon 5 Oct, 11am Sydney (AEDT)
const syd = (d: Date) => d.toLocaleString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).replace(/,/g, "");

// ── Action token: sign / verify / expiry / tamper ──
const token = signActionToken({ type: "call_day_after", clientId: "c1", refIds: ["m1"] }, { now, secret });
const p = verifyActionToken(token, { now, secret })!;
assert.deepEqual([p.type, p.clientId, p.refIds], ["call_day_after", "c1", ["m1"]]);
assert.equal(p.exp, now.getTime() + ACTION_TOKEN_DAYS * DAY);
assert.equal(verifyActionToken(token, { now: new Date(now.getTime() + 14 * DAY + 1), secret }), null, "expired after 14 days");
assert.equal(verifyActionToken(token, { now, secret: "other" }), null, "wrong secret");
const [body, mac] = token.split(".");
assert.equal(verifyActionToken(`${Buffer.from(JSON.stringify({ ...p, clientId: "c2" })).toString("base64url")}.${mac}`, { now, secret }), null, "payload changed");
assert.equal(verifyActionToken(`${body}.x${mac}`, { now, secret }), null, "signature changed");

// ── Access: an agent sees only the clients they account-manage ──
const coach = { role: "COACH" as const, isAgent: false, agentClientIds: [], clientId: null };
const agent = { role: "COACH" as const, isAgent: true, agentClientIds: ["c1"], clientId: null };
const client = { role: "CLIENT" as const, isAgent: false, agentClientIds: [], clientId: "c1" };
assert.equal(canAccessClient(coach, "c2"), true);
assert.equal(canAccessClient(agent, "c1"), true);
assert.equal(canAccessClient(agent, "c2"), false);
assert.equal(canAccessClient(client, "c2"), false);

// ── Next-call generation (Sydney wall clock, any day / time) ──
assert.equal(syd(nextSlot(now, "MONDAY", "10:00")), "Mon 12 Oct 10:00", "today's 10:00 has passed → next week");
assert.equal(syd(nextSlot(now, "MONDAY", "14:30")), "Mon 5 Oct 14:30", "later today");
assert.equal(syd(nextSlot(now, "FRIDAY", "09:15")), "Fri 9 Oct 09:15");
assert.equal(syd(nextSlot(new Date("2026-10-31T00:00:00Z"), "MONDAY", "10:00")), "Mon 2 Nov 10:00", "across a month end");
assert.equal(syd(nextSlot(new Date("2026-04-01T00:00:00Z"), "SUNDAY", "10:00")), "Sun 5 Apr 10:00", "DST ends that day — still 10:00 local");
const weekly = { callDay: "FRIDAY" as const, callTime: "10:00", callFrequency: "WEEKLY" as const };
const fortnightly = { ...weekly, callFrequency: "FORTNIGHTLY" as const };
assert.equal(syd(defaultNextCall(weekly, null, now)), "Fri 9 Oct 10:00", "no calls yet → the next slot");
assert.equal(syd(defaultNextCall(weekly, new Date("2026-10-02T00:00:00Z"), now)), "Fri 9 Oct 10:00", "held Fri → next Fri");
assert.equal(syd(defaultNextCall(weekly, new Date("2026-10-08T00:00:00Z"), now)), "Fri 16 Oct 10:00", "moved to Thu → not again the next day");
assert.equal(syd(defaultNextCall(fortnightly, new Date("2026-10-02T00:00:00Z"), now)), "Fri 16 Oct 10:00", "fortnightly → two weeks on");
assert.equal(syd(defaultNextCall(fortnightly, new Date("2026-08-01T00:00:00Z"), now)), "Fri 9 Oct 10:00", "long gap → next slot");
assert.equal(slotLabel(fortnightly), "Every 2nd Fri 10:00");
assert.equal(syd(parseCallWhen("2026-10-13T15:45")!), "Tue 13 Oct 15:45");
assert.equal(syd(parseCallWhen("2026-10-13", "09:30")!), "Tue 13 Oct 09:30", "date only → the regular time");
assert.equal(parseCallWhen("13/10/2026"), null);
assert.equal(parseCallWhen("2026-02-30T10:00"), null);

// ── Day-after reminder fires once; the second waits for +72h and a day after the first ──
const at = new Date("2026-10-01T23:00:00Z");
assert.equal(reminderDue(at, {}, new Date(at.getTime() + 23 * HOUR)), null, "not before +24h");
assert.equal(reminderDue(at, {}, new Date(at.getTime() + 24 * HOUR)), "DAY_AFTER");
const first = new Date(at.getTime() + 24 * HOUR);
assert.equal(reminderDue(at, { DAY_AFTER: first }, new Date(at.getTime() + 30 * HOUR)), null, "day-after is never sent twice");
assert.equal(reminderDue(at, { DAY_AFTER: first }, new Date(at.getTime() + 72 * HOUR)), "SECOND");
assert.equal(reminderDue(at, { DAY_AFTER: first, SECOND: new Date() }, new Date(at.getTime() + 100 * HOUR)), null, "second is never sent twice");
assert.equal(reminderDue(at, {}, new Date(at.getTime() + 80 * HOUR)), "DAY_AFTER", "a late cron sends the first…");
assert.equal(reminderDue(at, { DAY_AFTER: new Date(at.getTime() + 80 * HOUR) }, new Date(at.getTime() + 81 * HOUR)), null, "…and not the second an hour later");
// A reschedule's new call has its own time and no reminders yet → they run from the new date.
const moved = new Date("2026-10-08T23:00:00Z");
assert.equal(reminderDue(moved, {}, new Date(at.getTime() + 30 * HOUR)), null);
assert.equal(reminderDue(moved, {}, new Date(moved.getTime() + 25 * HOUR)), "DAY_AFTER");

// ── Logging closes the ClickUp task, HELD or NOT_HELD ──
assert.deepEqual(callTaskUpdate({ status: "NOT_HELD", notHeldReason: "Client no-show" }), { description: "Meeting did not happen: Client no-show", close: true });
const held = callTaskUpdate({ status: "HELD", summary: "Went well", nextSteps: ["Send quote"], outcome: "GOOD" })!;
assert.equal(held.close, true);
assert.match(held.description, /Summary:\nWent well/);
assert.match(held.description, /Next steps:\n- Send quote/);
assert.equal(callTaskUpdate({ status: "PENDING" }), null);
assert.equal(callTaskUpdate({ status: "RESCHEDULED" }), null, "a reschedule keeps the task open");
assert.equal(taskText({ name: "Jake", slug: "jake" }, { kind: "weekly_call", title: "AM call: Jake – Fri 2 Oct", why: "x", description: "" }, "").title, "AM call: Jake – Fri 2 Oct");

// ── internalNotes / outcome never reach a CLIENT ──
assert.equal(callSelectFor("CLIENT"), CLIENT_CALL_SELECT);
assert.equal(callSelectFor("COACH"), TEAM_CALL_SELECT);
for (const k of ["internalNotes", "outcome", "notHeldReason", "rescheduleReason"]) {
  assert.ok(!(k in CLIENT_CALL_SELECT), `client select must not include ${k}`);
  assert.ok(k in TEAM_CALL_SELECT, `team select includes ${k}`);
}
const k0: KpiValues = { leads: 12, contacted: 9, liveTransfers: 3, consultsBooked: 2, quotes: 1, sales: 0, revenue: 0, spend: 100, spendSource: "meta", costPerBooking: 50, costPerQuote: 100, costPerSale: null };
const callRow = { clientName: "Jake", clientType: "TRADE" as const, amName: "Sam", scheduledAt: new Date("2026-10-01T23:00:00Z"), summary: "Good week.", nextSteps: ["Send quote", "Call Greg"], kpis: k0, internalNotes: "SECRET-NOTE", outcome: "AT_RISK" };
const mail = clientCallEmail(callRow);
assert.ok(!JSON.stringify(mail).includes("SECRET-NOTE"), "internal notes not in the client email");
assert.ok(!/at risk/i.test(JSON.stringify(mail)), "outcome not in the client email");
assert.deepEqual(mail.rows.map((r) => r.title), ["Send quote", "Call Greg", "This month so far"]);
assert.match(mail.intro, /From Sam, after our call on Fri 2 Oct: Good week\./);
assert.equal(clientCallEmail({ ...callRow, kpis: null }).rows.length, 2, "no numbers while reports are on hold");
assert.deepEqual(splitSteps("• a\n\n * b \n"), ["a", "b"]);

// ── Deep link → the update panel; signed-out → back to it after sign-in ──
process.env.APP_URL = "https://hq.example";
const link = actionLink({ type: "call_day_after", clientId: "c1", refIds: ["m1"], path: callUpdatePath("m1") }, { now, secret });
assert.ok(link.href.startsWith("https://hq.example/my-calls?update=m1&a="), link.href);
assert.deepEqual(verifyActionToken(new URL(link.href).searchParams.get("a"), { now, secret })?.refIds, ["m1"]);
assert.equal(signInReturnUrl("http://localhost:3000/my-calls?update=m1&a=tok", "http://localhost:3011"), "http://localhost:3011/my-calls?update=m1&a=tok");

// ── Calendar invite: one UID through reschedules, UTC times, escaped text ──
const ics = callInvite({ uid: "root1", sequence: 3, start: new Date("2026-10-13T23:00:00Z"), minutes: 30, title: "AM call: Jake, Co", description: "Line1\nLine2", url: "https://hq.example/my-calls?update=m2", attendee: "sam@x.com" });
assert.match(ics, /\r\nUID:root1@hive-hq\r\n/);
assert.match(ics, /\r\nSEQUENCE:3\r\n/);
assert.match(ics, /\r\nDTSTART:20261013T230000Z\r\nDTEND:20261013T233000Z\r\n/);
assert.match(ics, /SUMMARY:AM call: Jake\\, Co/);
assert.match(ics, /DESCRIPTION:Line1\\nLine2\\n\\nhttps:\/\/hq.example/);

// ── History: reschedule chains collapse into one entry ──
const base = { callPerson: { name: "Sam" }, outcome: null, summary: null, nextSteps: [], internalNotes: null, notHeldReason: null, rescheduleReason: null, loggedAt: null };
const hist = buildHistory([
  { ...base, id: "a", scheduledAt: new Date("2026-10-05T23:00:00Z"), status: "RESCHEDULED", rescheduledFromId: null, rescheduleReason: "Client sick" },
  { ...base, id: "b", scheduledAt: new Date("2026-10-07T23:00:00Z"), status: "HELD", rescheduledFromId: "a", outcome: "GOOD", loggedAt: new Date("2026-10-09T01:00:00Z") },
  { ...base, id: "c", scheduledAt: new Date("2026-10-14T23:00:00Z"), status: "PENDING", rescheduledFromId: null },
]);
assert.deepEqual(hist.map((h) => h.id), ["c", "b"], "newest first, the replaced call folded in");
assert.deepEqual(hist[1].chain.map((x) => x.status), ["RESCHEDULED", "HELD"]);
assert.equal(hist[1].reason, "Client sick");
assert.equal(hist[1].loggedDaysAfter, 1);
assert.equal(hist[1].outcome, "Good");

// ── Computed health: any sign → At risk, 3+ → Critical ──
const none = { calls: false, outcome: false, kpis: false, updates: false, alerts: false };
assert.equal(computeHealth(none).level, "ON_TRACK");
assert.deepEqual(computeHealth({ ...none, outcome: true }), { level: "AT_RISK", reasons: ["Last call's outcome was At risk"] });
assert.equal(computeHealth({ ...none, calls: true, kpis: true, alerts: true }).level, "CRITICAL");
assert.equal(lastTwoMissed(["NOT_HELD", "PENDING", "HELD"]), true);
assert.equal(lastTwoMissed(["HELD", "NOT_HELD"]), false);
assert.equal(lastTwoMissed(["NOT_HELD"]), false, "one call isn't two");
const scaled = (f: number): KpiValues => ({ ...k0, leads: k0.leads * f, liveTransfers: k0.liveTransfers * f, consultsBooked: k0.consultsBooked * f, quotes: k0.quotes * f, sales: k0.sales * f });
assert.equal(kpisRed(scaled(0.5), k0), true);
assert.equal(kpisRed(k0, k0), false);

// ── The client dropdown never navigates: buttons only, no links ──
(async () => {
  (globalThis as { React?: typeof React }).React = React; // the component files use the classic JSX transform under tsx
  const { default: ClientCallsDropdown } = await import("../components/ClientCallsDropdown");
  const html = renderToString(
    React.createElement(ClientCallsDropdown, {
      clientId: "c1",
      initial: { next: { id: "c", scheduledAt: "2026-10-14T23:00:00.000Z" }, history: hist, stats: { heldThisMonth: 1, missedThisMonth: 0, rescheduledThisMonth: 1, avgDaysToLog: 1 } },
    })
  );
  assert.ok(html.includes("Log now") && html.includes("Reschedule"), "renders the actions");
  assert.ok(!/<a\b/.test(html) && !/href=/.test(html), "no links in the dropdown");
  assert.ok(!/<form\b/.test(html), "no forms that could submit/navigate");
  console.log(`am-calls: all checks passed (week of ${sydneyDay(now)})`);
})();
