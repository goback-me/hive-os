// Run: npx tsx lib/weekly-meetings.check.ts — throws on the first failure.
import assert from "node:assert/strict";
import { signActionToken, verifyActionToken, ACTION_TOKEN_DAYS } from "./action-token";
import { canAccessClient, signInReturnUrl } from "./access";
import { CLIENT_CALL_SELECT, TEAM_CALL_SELECT, callSelectFor, clientCallEmail, currentCallDate, meetingKey, meetingPath, meetingSchedule, meetingTaskUpdate, meetingsToCreate, nextCallLabel, previousCallDate, splitSteps } from "./weekly-meetings";
import { actionLink } from "./email";
import { computeHealth, kpisRed } from "./client-health";
import type { KpiValues } from "./kpi";
import { sydneyDay, sydneyHour } from "./sheet-parse";
import { taskText } from "./clickup";

const DAY = 86_400_000;
const secret = "test-secret";
const now = new Date("2026-10-05T00:00:00Z"); // Mon 5 Oct, 11am Sydney

// ── Action token: sign / verify / expiry / tamper ──
const token = signActionToken({ type: "client_update", clientId: "c1", refIds: ["l1", "l2"] }, { now, secret });
const p = verifyActionToken(token, { now, secret })!;
assert.deepEqual([p.type, p.clientId, p.refIds], ["client_update", "c1", ["l1", "l2"]]);
assert.equal(p.exp, now.getTime() + ACTION_TOKEN_DAYS * DAY);
assert.ok(verifyActionToken(token, { now: new Date(now.getTime() + 13 * DAY), secret }), "still valid on day 13");
assert.equal(verifyActionToken(token, { now: new Date(now.getTime() + 14 * DAY + 1), secret }), null, "expired after 14 days");
assert.equal(verifyActionToken(token, { now, secret: "other" }), null, "wrong secret");
const [body, mac] = token.split(".");
const forged = Buffer.from(JSON.stringify({ ...p, clientId: "c2" })).toString("base64url");
assert.equal(verifyActionToken(`${forged}.${mac}`, { now, secret }), null, "payload changed");
assert.equal(verifyActionToken(`${body}.x${mac}`, { now, secret }), null, "signature changed");
assert.equal(verifyActionToken("garbage", { now, secret }), null);
assert.equal(verifyActionToken(undefined, { now, secret }), null);

// ── Access: the token is never a login — the page checks the viewer ──
const coach = { role: "COACH" as const, isAgent: false, agentClientIds: [], clientId: null };
const agent = { role: "COACH" as const, isAgent: true, agentClientIds: ["c1"], clientId: null };
const client = { role: "CLIENT" as const, isAgent: false, agentClientIds: [], clientId: "c1" };
assert.equal(canAccessClient(coach, "c2"), true);
assert.equal(canAccessClient(agent, "c1"), true);
assert.equal(canAccessClient(agent, "c2"), false, "agent: only assigned clients");
assert.equal(canAccessClient(client, "c1"), true);
assert.equal(canAccessClient(client, "c2"), false, "client: only their own");

// ── Schedule: Monday 9am after the call → Wednesday → Friday ──
const lastFri = previousCallDate(now, "FRIDAY");
assert.equal(sydneyDay(lastFri), "2026-10-02");
assert.equal(sydneyDay(previousCallDate(now, "MONDAY")), "2026-09-28");
const s = meetingSchedule(lastFri);
assert.deepEqual([sydneyDay(s.createAt), sydneyHour(s.createAt)], ["2026-10-05", 9]);
assert.equal(sydneyDay(s.remindAt), "2026-10-07");
assert.equal(sydneyDay(s.alertAt), "2026-10-09");

// ── Monday job is idempotent: a second run creates nothing ──
const clients = [
  { id: "c1", weeklyCallAgentId: "u1", weeklyCallDay: "FRIDAY" as const },
  { id: "c2", weeklyCallAgentId: null, weeklyCallDay: "FRIDAY" as const }, // no agent → no meeting
];
const first = meetingsToCreate(clients, new Set(), now);
assert.deepEqual(first.map((m) => [m.clientId, m.agentId, sydneyDay(m.weekOf)]), [["c1", "u1", "2026-10-02"]]);
assert.deepEqual(meetingsToCreate(clients, new Set(first.map((m) => meetingKey(m.clientId, m.weekOf))), now), []);
// Before Monday 9am Sydney: nothing yet.
assert.deepEqual(meetingsToCreate(clients, new Set(), new Date("2026-10-04T21:00:00Z")), []); // Mon 8am Sydney
// Later in the week it still targets last week's call, once.
assert.equal(sydneyDay(meetingsToCreate(clients, new Set(), new Date("2026-10-08T00:00:00Z"))[0].weekOf), "2026-10-02");

// ── Logging closes the ClickUp task, HELD or NOT_HELD ──
assert.deepEqual(meetingTaskUpdate({ status: "NOT_HELD", notHeldReason: "Client no-show" }), { description: "Meeting did not happen: Client no-show", close: true });
const held = meetingTaskUpdate({ status: "HELD", summary: "Went well", nextSteps: "Send quote", clientMood: "GOOD" })!;
assert.equal(held.close, true);
assert.match(held.description, /Summary:\nWent well/);
assert.match(held.description, /Next steps:\nSend quote/);
assert.match(held.description, /Outcome: Good/);
assert.equal(meetingTaskUpdate({ status: "PENDING" }), null);

// ── Every ClickUp task says which client and why ──
const tt = taskText({ name: "Jake Of All Tradez", slug: "jake" }, { kind: "chase_client", title: "Chase client — 7 leads waiting", why: "Leads need an update.", description: "• Greg" }, "https://hq.example");
assert.equal(tt.title, "[Jake Of All Tradez] Chase client — 7 leads waiting");
assert.deepEqual(tt.description.split("\n").slice(0, 3), [
  "**Client:** Jake Of All Tradez",
  "**Why this task:** Leads need an update.",
  "**Open in Hive HQ:** https://hq.example/clients/jake",
]);
assert.match(tt.description, /Created automatically by Hive HQ/);
assert.equal(taskText({ name: "Jake Of All Tradez", slug: "jake" }, { kind: "manual", title: "[Jake Of All Tradez] Call back", why: "x", description: "" }, "").title, "[Jake Of All Tradez] Call back"); // no double prefix
assert.match(taskText({ name: "J", slug: "j" }, { kind: "manual", title: "t", why: "x", description: "" }, "").description, /Created in Hive HQ\./);

// ── Ad-hoc "Log a call" files under this week's call day ──
assert.equal(sydneyDay(currentCallDate(now, "FRIDAY")), "2026-10-09");
assert.equal(first[0].weekOf.getTime(), (first[0] as { scheduledAt?: Date }).scheduledAt?.getTime(), "scheduledAt set on create");

// ── internalNotes / outcome never reach a CLIENT ──
assert.equal(callSelectFor("CLIENT"), CLIENT_CALL_SELECT);
assert.equal(callSelectFor("COACH"), TEAM_CALL_SELECT);
for (const k of ["internalNotes", "clientMood", "notHeldReason"]) {
  assert.ok(!(k in CLIENT_CALL_SELECT), `client select must not include ${k}`);
  assert.ok(k in TEAM_CALL_SELECT, `team select includes ${k}`);
}
const k0: KpiValues = { leads: 12, contacted: 9, liveTransfers: 3, consultsBooked: 2, quotes: 1, sales: 0, revenue: 0, spend: 100, spendSource: "meta", costPerBooking: 50, costPerQuote: 100, costPerSale: null };
const callRow = { clientName: "Jake", clientType: "TRADE" as const, amName: "Sam", weekOf: lastFri, summary: "Good week.", nextSteps: "- Send quote\nCall Greg", kpis: k0, internalNotes: "SECRET-NOTE", clientMood: "AT_RISK" };
const mail = clientCallEmail(callRow);
assert.ok(!JSON.stringify(mail).includes("SECRET-NOTE"), "internal notes not in the client email");
assert.ok(!/at risk/i.test(JSON.stringify(mail)), "outcome not in the client email");
assert.deepEqual(mail.rows.map((r) => r.title), ["Send quote", "Call Greg", "This month so far"]);
assert.match(mail.rows[2].detail, /1 onsite quotes · 0 jobs won/);
assert.match(mail.intro, /From Sam, after our call on Fri,? 2 Oct: Good week\./);
assert.equal(clientCallEmail({ ...callRow, kpis: null }).rows.length, 2, "no numbers while reports are on hold");
assert.deepEqual(splitSteps("• a\n\n * b \n"), ["a", "b"]);

// ── Email deep link → the call form; signed-out → back to it after sign-in ──
process.env.APP_URL = "https://hq.example";
assert.equal(meetingPath("acme", "m1"), "/clients/acme/calls/m1");
const link = actionLink({ type: "meeting_log", clientId: "c1", refIds: ["m1"], path: meetingPath("acme", "m1") }, { now, secret });
assert.ok(link.href.startsWith("https://hq.example/clients/acme/calls/m1?a="));
assert.deepEqual(verifyActionToken(new URL(link.href).searchParams.get("a"), { now, secret })?.refIds, ["m1"]);
assert.match(actionLink({ type: "call_update", clientId: "c1", refIds: ["m1"], path: "/clients/acme?tab=weekly" }, { now, secret }).href, /\?tab=weekly&a=/);
assert.equal(signInReturnUrl("http://localhost:3000/clients/acme/calls/m1?a=tok", "http://localhost:3011"), "http://localhost:3011/clients/acme/calls/m1?a=tok");
assert.equal(signInReturnUrl("http://localhost:3000/clients/acme", undefined), "http://localhost:3000/clients/acme");

// ── ClickUp: "AM call: <client> – <date>", no double client prefix ──
assert.equal(taskText({ name: "Jake", slug: "jake" }, { kind: "weekly_call", title: "AM call: Jake – Fri 2 Oct", why: "x", description: "" }, "").title, "AM call: Jake – Fri 2 Oct");

// ── Computed health: any sign → At risk, 3+ → Critical ──
const none = { calls: false, outcome: false, kpis: false, updates: false, alerts: false };
assert.equal(computeHealth(none).level, "ON_TRACK");
assert.deepEqual(computeHealth({ ...none, outcome: true }), { level: "AT_RISK", reasons: ["Last call's outcome was At risk"] });
assert.equal(computeHealth({ ...none, calls: true, kpis: true }).level, "AT_RISK");
assert.equal(computeHealth({ ...none, calls: true, kpis: true, alerts: true }).level, "CRITICAL");
const half = (f: number): KpiValues => ({ ...k0, leads: k0.leads * f, liveTransfers: k0.liveTransfers * f, consultsBooked: k0.consultsBooked * f, quotes: k0.quotes * f, sales: k0.sales * f });
assert.equal(kpisRed(half(0.5), k0), true, "everything halved → red");
assert.equal(kpisRed(k0, k0), false);
assert.equal(kpisRed(k0, { ...k0, leads: 0, liveTransfers: 0, consultsBooked: 0, quotes: 0, sales: 0 }), false, "nothing to compare → not red");

// ── Weekly status tab: "Next call: <date> with <AM>" ──
const wed = new Date("2026-10-07T01:00:00Z"); // Wed 7 Oct, Sydney
assert.match(nextCallLabel(wed, "FRIDAY", null, "Sam")!, /^Fri,? 9 Oct with Sam$/, "this week's call day, still ahead");
assert.match(nextCallLabel(new Date("2026-10-10T01:00:00Z"), "FRIDAY", null, "Sam")!, /^Fri,? 16 Oct with Sam$/, "Saturday → next week's");
assert.match(nextCallLabel(wed, "FRIDAY", new Date("2026-10-13T13:00:00Z"), "Sam")!, /^Wed,? 14 Oct with Sam$/, "the date the last call set wins");
assert.match(nextCallLabel(wed, "FRIDAY", new Date("2026-09-30T14:00:00Z"), "Sam")!, /9 Oct/, "a past set date is ignored");
assert.equal(nextCallLabel(wed, "FRIDAY", null, null), null, "no AM, no date → nothing");

console.log("weekly-meetings: all checks passed");
