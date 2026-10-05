// Run: npx tsx lib/weekly-meetings.check.ts — throws on the first failure.
import assert from "node:assert/strict";
import { signActionToken, verifyActionToken, ACTION_TOKEN_DAYS } from "./action-token";
import { canAccessClient } from "./access";
import { meetingKey, meetingSchedule, meetingTaskUpdate, meetingsToCreate, previousCallDate } from "./weekly-meetings";
import { sydneyDay, sydneyHour } from "./sheet-parse";

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
assert.match(held.description, /Client mood: Good/);
assert.equal(meetingTaskUpdate({ status: "PENDING" }), null);

console.log("weekly-meetings: all checks passed");
