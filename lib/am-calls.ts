import type { CallFrequency, CallReminderKind, ClientMood, MeetingStatus, Prisma, Weekday } from "@prisma/client";
import { prisma } from "./prisma";
import { sydneyDay, sydneyLocalToDate } from "./sheet-parse";
import { commentOnTask, ensureTask, setTaskDue } from "./clickup";
import { appUrl, emailConfigured, sendActionEmail, type EmailRow } from "./email";
import type { KpiValues } from "./kpi";
import { terms, type ClientTypeValue } from "./client-terms";

// Account-manager calls (AmCall). scheduledAt is the source of truth — any day,
// any time. Every client with an account manager always has one future
// PENDING call, from their regular slot (Client.callDay / callTime /
// callFrequency) unless one is already booked:
//   scheduled          → calendar invite (.ics) to the call person
//   +24h, still PENDING → "How did your call go?" email + ClickUp task + My Calls badge
//   +72h, still PENDING → second email + AM_CALL_NOT_LOGGED (lib/data-health.ts)
// Logging it HELD / NOT_HELD books the next call (at nextCallAt if given);
// RESCHEDULED replaces it with a new PENDING call (rescheduledFromId), whose
// reminders run from the new time. Every cron step is idempotent
// (CallReminder records what was sent).

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const WEEKDAYS: Weekday[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
};
export const OUTCOME_LABELS: Record<ClientMood, string> = { GOOD: "Good", NEUTRAL: "Neutral", AT_RISK: "At risk" };
export const STATUS_LABELS: Record<MeetingStatus, string> = { PENDING: "Upcoming", HELD: "Held", RESCHEDULED: "Rescheduled", NOT_HELD: "Didn't happen" };
export const NOT_HELD_REASONS = { NO_SHOW: "Client no-show", AM_UNAVAILABLE: "AM unavailable", OTHER: "Other" } as const;
export const FREQUENCY_LABELS: Record<CallFrequency, string> = { WEEKLY: "Every", FORTNIGHTLY: "Every 2nd" };

// ── Dates (Sydney) ─────────────────────────────────────────────────────────

const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleString("en-AU", { timeZone: "Australia/Sydney", ...o });
export const callDateLabel = (d: Date) => fmt(d, { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
export const callTimeLabel = (d: Date) => fmt(d, { hour: "numeric", minute: "2-digit", hour12: true }).replace(" ", "").toLowerCase();
export const callWhenLabel = (d: Date) => `${callDateLabel(d)}, ${callTimeLabel(d)}`;

export const isCallTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
// "Every Mon 10:00" / "Every 2nd Mon 10:00".
export const slotLabel = (c: { callDay: Weekday; callTime: string; callFrequency: CallFrequency }) =>
  `${FREQUENCY_LABELS[c.callFrequency]} ${WEEKDAY_LABELS[c.callDay].slice(0, 3)} ${c.callTime}`;

// "YYYY-MM-DDTHH:MM" (or just the date → defaultTime), Sydney → the instant.
export function parseCallWhen(s: string, defaultTime = "10:00") {
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}))?$/);
  const time = m?.[4] ?? defaultTime;
  if (!m || !isCallTime(time)) return null;
  return sydneyLocalToDate(Number(m[1]), Number(m[2]), Number(m[3]), Number(time.slice(0, 2)), Number(time.slice(3)));
}

// A Sydney wall-clock day + time → the instant (day may overflow the month).
function sydneyAt(y: number, m: number, d: number, time: string) {
  const t = new Date(Date.UTC(y, m - 1, d));
  const [h, mi] = time.split(":").map(Number);
  return sydneyLocalToDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), h, mi)!;
}

// The first `day` at `time` (Sydney) strictly after `after`.
export function nextSlot(after: Date, day: Weekday, time: string): Date {
  const [y, m, d] = sydneyDay(after).split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday = 0
  const add = (WEEKDAYS.indexOf(day) - dow + 7) % 7;
  const at = sydneyAt(y, m, d + add, time);
  return at > after ? at : sydneyAt(y, m, d + add + 7, time);
}

// The next regular call: the slot after now — and at least ~a week (or two,
// fortnightly) after the last call, so a call moved late in the week doesn't
// get another one two days later.
export function defaultNextCall(c: { callDay: Weekday; callTime: string; callFrequency: CallFrequency }, lastCallAt: Date | null, now: Date) {
  const gap = (c.callFrequency === "FORTNIGHTLY" ? 13 : 6) * DAY;
  const after = lastCallAt && lastCallAt.getTime() + gap > now.getTime() ? new Date(lastCallAt.getTime() + gap) : now;
  return nextSlot(after, c.callDay, c.callTime);
}

// ── What a CLIENT may see ──────────────────────────────────────────────────

// internalNotes, the outcome and the reasons are never selected for a CLIENT,
// so they can't leak through any page or API built on these.
export const CLIENT_CALL_SELECT = {
  id: true,
  scheduledAt: true,
  status: true,
  summary: true,
  nextSteps: true,
  stepsDone: true,
  nextCallAt: true,
  loggedAt: true,
  callPerson: { select: { name: true } },
} satisfies Prisma.AmCallSelect;
export const TEAM_CALL_SELECT = {
  ...CLIENT_CALL_SELECT,
  internalNotes: true,
  outcome: true,
  notHeldReason: true,
  rescheduleReason: true,
  rescheduledFromId: true,
  durationMins: true,
  emailedToClientAt: true,
  submittedBy: true,
  leadsReturned: true,
} satisfies Prisma.AmCallSelect;
export const callSelectFor = (role: "COACH" | "CLIENT") => (role === "CLIENT" ? CLIENT_CALL_SELECT : TEAM_CALL_SELECT);

// Next steps are typed one per line; leading bullets are dropped.
export const splitSteps = (s: string | null | undefined) => (s ?? "").split("\n").map((l) => l.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);

// ── Text for the ClickUp task and the client's email ───────────────────────

// The ClickUp task once the call is logged — always closed after.
export function callTaskUpdate(c: { status: MeetingStatus; summary?: string | null; nextSteps?: string[]; outcome?: ClientMood | null; notHeldReason?: string | null }): { description: string; close: true } | null {
  if (c.status === "NOT_HELD") return { description: `Meeting did not happen: ${c.notHeldReason || "no reason given"}`, close: true };
  if (c.status !== "HELD") return null;
  const parts = [
    c.summary?.trim() && `Summary:\n${c.summary.trim()}`,
    c.nextSteps?.length && `Next steps:\n${c.nextSteps.map((s) => `- ${s}`).join("\n")}`,
    c.outcome && `Outcome: ${OUTCOME_LABELS[c.outcome]}`,
  ].filter(Boolean);
  return { description: parts.join("\n\n") || "Call held.", close: true };
}

// The "Weekly status update" email to the client after a held call: summary,
// next steps and this month's numbers so far. Only client-facing fields go in.
export function clientCallEmail(c: { clientName: string; clientType: ClientTypeValue; amName: string | null; scheduledAt: Date; summary: string; nextSteps: string[]; kpis: KpiValues | null }) {
  const t = terms(c.clientType);
  const rows: EmailRow[] = c.nextSteps.map((step) => ({ title: step, detail: "Next step" }));
  if (c.kpis) {
    const k = c.kpis;
    rows.push({
      title: "This month so far",
      detail: `${k.leads} leads · ${k.liveTransfers} live transfers · ${k.consultsBooked} consults booked · ${k.quotes} ${t.quotes.toLowerCase()} · ${k.sales} ${t.sales.toLowerCase()}`,
    });
  }
  const day = callDateLabel(c.scheduledAt);
  return {
    subject: `${c.clientName}: your weekly status update — ${day}`,
    heading: "Your weekly status update",
    intro: `${c.amName ? `From ${c.amName}, after` : "After"} our call on ${day}: ${c.summary}`,
    rows,
  };
}

// ── Calendar invite ────────────────────────────────────────────────────────

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

// One VEVENT. The UID stays the same through reschedules (the chain's first
// call) and SEQUENCE grows, so calendars move the event instead of adding one.
export function callInvite(e: { uid: string; sequence: number; start: Date; minutes: number; title: string; description: string; url: string; attendee: string }) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hive HQ//AM calls//EN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${e.uid}@hive-hq`,
    `SEQUENCE:${e.sequence}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(e.start)}`,
    `DTEND:${icsDate(new Date(e.start.getTime() + e.minutes * 60_000))}`,
    `SUMMARY:${icsText(e.title)}`,
    `DESCRIPTION:${icsText(`${e.description}\n\n${e.url}`)}`,
    `URL:${e.url}`,
    `ATTENDEE;RSVP=FALSE:mailto:${e.attendee}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

// The first call of a reschedule chain — the invite's UID.
async function chainRoot(callId: string) {
  let id = callId;
  for (let i = 0; i < 50; i++) {
    const c = await prisma.amCall.findUnique({ where: { id }, select: { rescheduledFromId: true } });
    if (!c?.rescheduledFromId) break;
    id = c.rescheduledFromId;
  }
  return id;
}

// Email the call person the invite (best effort — never blocks scheduling).
export async function sendCallInvite(callId: string) {
  if (!emailConfigured()) return false;
  const c = await prisma.amCall.findUnique({ where: { id: callId }, include: { client: { select: { name: true } }, callPerson: { select: { email: true } } } });
  if (!c || c.status !== "PENDING" || !c.callPerson?.email) return false;
  const path = `/my-calls?update=${c.id}`;
  const ics = callInvite({
    uid: await chainRoot(c.id),
    // ponytail: seconds since 2023 — always larger than the last one sent, no counter column needed.
    sequence: Math.floor(Date.now() / 1000) - 1_672_531_200,
    start: c.scheduledAt,
    minutes: 30,
    title: `AM call: ${c.client.name}`,
    description: `Your call with ${c.client.name}. Log how it went in Hive HQ afterwards.`,
    url: `${appUrl()}${path}`,
    attendee: c.callPerson.email,
  });
  const sent = await sendActionEmail({
    to: [c.callPerson.email],
    type: "call_invite",
    clientId: c.clientId,
    refIds: [c.id],
    path,
    subject: `[${c.client.name}] Call booked — ${callWhenLabel(c.scheduledAt)}`,
    heading: `Call with ${c.client.name}: ${callWhenLabel(c.scheduledAt)}`,
    intro: "The calendar invite is attached. Afterwards, log how it went in Hive HQ.",
    button: "Open in Hive HQ",
    footnote: `You're getting this because you're ${c.client.name}'s account manager in Hive HQ.`,
    attachments: [{ filename: "invite.ics", content: Buffer.from(ics).toString("base64"), contentType: "text/calendar; method=REQUEST" }],
  }).catch((e) => (console.error(`Invite for ${callId} failed:`, e), false));
  if (sent) await prisma.callReminder.upsert({ where: { callId_kind: { callId, kind: "INVITE" } }, create: { callId, kind: "INVITE" }, update: { sentAt: new Date() } });
  return sent;
}

// ── Scheduling ─────────────────────────────────────────────────────────────

// Keep one future PENDING call for the client. `preferred` (a logged call's
// "next call" date) books or moves it there. Returns the future call, or null
// when the client has no account manager.
export async function ensureNextCall(clientId: string, opts: { now?: Date; preferred?: Date | null } = {}) {
  const now = opts.now ?? new Date();
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { archivedAt: true, accountManagerId: true, callDay: true, callTime: true, callFrequency: true } });
  if (!client?.accountManagerId || client.archivedAt) return null;
  const preferred = opts.preferred && opts.preferred > now ? opts.preferred : null;
  const future = await prisma.amCall.findFirst({ where: { clientId, status: "PENDING", scheduledAt: { gt: now } }, orderBy: { scheduledAt: "asc" } });
  if (future) return preferred && preferred.getTime() !== future.scheduledAt.getTime() ? moveCall(future.id, preferred) : future;
  const last = await prisma.amCall.findFirst({ where: { clientId, status: { in: ["HELD", "NOT_HELD", "PENDING"] } }, orderBy: { scheduledAt: "desc" }, select: { scheduledAt: true } });
  // ponytail: no lock — the cron and a save racing could each book one; the extra shows up as a second upcoming call.
  const call = await prisma.amCall.create({ data: { clientId, callPersonId: client.accountManagerId, scheduledAt: preferred ?? defaultNextCall(client, last?.scheduledAt ?? null, now) } });
  await sendCallInvite(call.id);
  return call;
}

// Move a call that hasn't happened yet (a planning change — no reschedule
// record): the ClickUp due date and the invite follow.
export async function moveCall(callId: string, at: Date) {
  const call = await prisma.amCall.update({ where: { id: callId }, data: { scheduledAt: at } });
  if (call.clickupTaskId) await setTaskDue(call.clickupTaskId, at);
  await sendCallInvite(call.id);
  return call;
}

// The client's regular slot changed: their next call (if it hasn't happened
// yet) moves to the new slot.
export async function applySlotChange(clientId: string, now = new Date()) {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { accountManagerId: true, callDay: true, callTime: true, callFrequency: true } });
  const future = await prisma.amCall.findFirst({ where: { clientId, status: "PENDING", scheduledAt: { gt: now } }, orderBy: { scheduledAt: "asc" } });
  if (!client?.accountManagerId) return null;
  if (!future) return ensureNextCall(clientId, { now });
  const last = await prisma.amCall.findFirst({ where: { clientId, status: { in: ["HELD", "NOT_HELD"] } }, orderBy: { scheduledAt: "desc" }, select: { scheduledAt: true } });
  const at = defaultNextCall(client, last?.scheduledAt ?? null, now);
  await prisma.amCall.update({ where: { id: future.id }, data: { callPersonId: client.accountManagerId } });
  return at.getTime() === future.scheduledAt.getTime() ? future : moveCall(future.id, at);
}

// The call didn't happen at its time but will at `at`: it becomes RESCHEDULED
// (with the reason) and a new PENDING call takes over — same call person, same
// ClickUp task (commented, due date moved). Reminders run from the new time.
export async function rescheduleCall(callId: string, at: Date, reason: string, by: string) {
  const old = await prisma.amCall.findUnique({ where: { id: callId }, include: { client: { select: { name: true } } } });
  if (!old) throw new Error("Call not found");
  if (old.status !== "PENDING") throw new Error("Only an upcoming or unlogged call can be rescheduled");
  const [, next] = await prisma.$transaction([
    prisma.amCall.update({ where: { id: callId }, data: { status: "RESCHEDULED", rescheduleReason: reason || null, loggedAt: new Date(), submittedBy: by } }),
    prisma.amCall.create({ data: { clientId: old.clientId, callPersonId: old.callPersonId, scheduledAt: at, rescheduledFromId: old.id, clickupTaskId: old.clickupTaskId } }),
  ]);
  if (old.clickupTaskId) {
    await commentOnTask(old.clickupTaskId, `Rescheduled to ${callWhenLabel(at)}${reason ? `: ${reason}` : ""}`);
    await setTaskDue(old.clickupTaskId, at);
  }
  await sendCallInvite(next.id);
  return next;
}

// ── Reminders (cron) ───────────────────────────────────────────────────────

// Which reminder a PENDING call is due now, if any: the day-after one from
// +24h, the second from +72h (and at least a day after the first, so a late
// cron never sends both at once).
export function reminderDue(scheduledAt: Date, sent: Partial<Record<CallReminderKind, Date>>, now: Date): "DAY_AFTER" | "SECOND" | null {
  const since = now.getTime() - scheduledAt.getTime();
  if (since < DAY) return null;
  if (!sent.DAY_AFTER) return "DAY_AFTER";
  if (!sent.SECOND && since >= 3 * DAY && now.getTime() - sent.DAY_AFTER.getTime() >= DAY) return "SECOND";
  return null;
}

export const callUpdatePath = (callId: string) => `/my-calls?update=${callId}`;

// Hourly-or-more: book everyone's next call, then send what's due.
export async function runCallJobs(now = new Date()) {
  const out = { booked: 0, dayAfter: 0, second: 0, tasks: 0 };
  const clients = await prisma.client.findMany({ where: { archivedAt: null, accountManagerId: { not: null } }, select: { id: true } });
  for (const c of clients) {
    const had = await prisma.amCall.count({ where: { clientId: c.id, status: "PENDING", scheduledAt: { gt: now } } });
    if (!had && (await ensureNextCall(c.id, { now }))) out.booked++;
  }

  const due = await prisma.amCall.findMany({
    where: { status: "PENDING", scheduledAt: { lte: new Date(now.getTime() - DAY), gte: new Date(now.getTime() - 30 * DAY) } },
    include: { client: { select: { name: true } }, callPerson: { select: { email: true, name: true, clickupUserId: true } }, reminders: true },
  });
  for (const c of due) {
    const kind = reminderDue(c.scheduledAt, Object.fromEntries(c.reminders.map((r) => [r.kind, r.sentAt])), now);
    if (!kind) continue;
    // Claimed first: the unique (callId, kind) row means it's sent at most once.
    const claimed = await prisma.callReminder.createMany({ data: [{ callId: c.id, kind }], skipDuplicates: true });
    if (!claimed.count) continue;
    const day = callDateLabel(c.scheduledAt);
    const link = `${appUrl()}${callUpdatePath(c.id)}`;

    if (kind === "DAY_AFTER" && !c.clickupTaskId) {
      const taskId = await ensureTask(c.clientId, {
        kind: "weekly_call",
        dedupeKey: `call:${c.id}`,
        title: `AM call: ${c.client.name} – ${day}`,
        why: `${c.callPerson?.name ?? "The account manager"} had a call with this client on ${day} — log how it went in Hive HQ. This task closes itself once it's logged.`,
        description: `Log the call in Hive HQ:\n${link}`,
        dueDate: c.scheduledAt,
        assignees: c.callPerson?.clickupUserId ? [c.callPerson.clickupUserId] : [],
      }).catch(() => null);
      if (taskId) {
        await prisma.amCall.update({ where: { id: c.id }, data: { clickupTaskId: taskId } });
        out.tasks++;
      }
    }
    if (kind === "SECOND" && c.clickupTaskId) await commentOnTask(c.clickupTaskId, `Reminder: this call still isn't logged in Hive HQ — ${link}`);

    if (c.callPerson?.email) {
      const sent = await sendActionEmail({
        to: [c.callPerson.email],
        type: kind === "DAY_AFTER" ? "call_day_after" : "call_second",
        clientId: c.clientId,
        refIds: [c.id],
        path: callUpdatePath(c.id),
        subject: kind === "DAY_AFTER" ? `[${c.client.name}] How did your call on ${day} go?` : `[${c.client.name}] Reminder: your call on ${day} isn't logged yet`,
        heading: `How did your call with ${c.client.name} on ${day} go?`,
        intro:
          kind === "DAY_AFTER"
            ? "Say if it happened, was rescheduled or didn't happen — a held call takes a minute to log, and the client gets their update."
            : "It's 3 days since the call and it still isn't logged — the admins can see it's overdue.",
        button: "Update the call",
        footnote: `You're getting this because you're ${c.client.name}'s account manager in Hive HQ.`,
      }).catch((e) => (console.error(`Call reminder (${kind}) for ${c.id} failed:`, e), false));
      if (sent) out[kind === "DAY_AFTER" ? "dayAfter" : "second"]++;
    }
  }
  return out;
}

// ── Weekly status tab ──────────────────────────────────────────────────────

// One logged call as the tab shows it. `internal` exists only for the team.
export type StatusCall = {
  id: string;
  scheduledAt: string;
  status: "HELD" | "NOT_HELD" | "RESCHEDULED";
  amName: string | null;
  summary: string | null;
  steps: string[];
  stepsDone: number[];
  nextCallAt: string | null;
  movedTo: string | null; // RESCHEDULED: the new call's time
  loggedAt: string | null;
  internal?: { notes: string | null; outcome: string | null; reason: string | null };
};

type ClientRow = Prisma.AmCallGetPayload<{ select: typeof CLIENT_CALL_SELECT }>;
const toStatus = (c: ClientRow, movedTo: Map<string, Date>): StatusCall => ({
  id: c.id,
  scheduledAt: c.scheduledAt.toISOString(),
  status: c.status as StatusCall["status"],
  amName: c.callPerson?.name ?? null,
  summary: c.status === "HELD" ? c.summary : null,
  steps: c.status === "HELD" ? c.nextSteps : [],
  stepsDone: c.stepsDone,
  nextCallAt: c.nextCallAt?.toISOString() ?? null,
  movedTo: movedTo.get(c.id)?.toISOString() ?? null,
  loggedAt: c.loggedAt?.toISOString() ?? null,
});

// Logged calls, newest first. A CLIENT's query never selects internalNotes,
// the outcome or any reason.
export async function getStatusCalls(clientId: string, role: "COACH" | "CLIENT", take = 26): Promise<StatusCall[]> {
  const where = { clientId, status: { in: ["HELD", "NOT_HELD", "RESCHEDULED"] as MeetingStatus[] } };
  const movedToOf = async (rows: { id: string; status: MeetingStatus }[]) => {
    const ids = rows.filter((r) => r.status === "RESCHEDULED").map((r) => r.id);
    const next = ids.length ? await prisma.amCall.findMany({ where: { rescheduledFromId: { in: ids } }, select: { rescheduledFromId: true, scheduledAt: true } }) : [];
    return new Map(next.map((n) => [n.rescheduledFromId!, n.scheduledAt]));
  };
  if (role === "CLIENT") {
    const rows = await prisma.amCall.findMany({ where, orderBy: { scheduledAt: "desc" }, take, select: CLIENT_CALL_SELECT });
    const movedTo = await movedToOf(rows);
    return rows.map((c) => toStatus(c, movedTo));
  }
  const rows = await prisma.amCall.findMany({ where, orderBy: { scheduledAt: "desc" }, take, select: TEAM_CALL_SELECT });
  const movedTo = await movedToOf(rows);
  return rows.map((c) => ({ ...toStatus(c, movedTo), internal: { notes: c.internalNotes, outcome: c.outcome ? OUTCOME_LABELS[c.outcome] : null, reason: c.notHeldReason ?? c.rescheduleReason } }));
}

// "Fri 17 Oct, 10:00am with Sam" — the client's next booked call.
export async function nextCallLabel(clientId: string, now = new Date()) {
  const next = await prisma.amCall.findFirst({ where: { clientId, status: "PENDING", scheduledAt: { gt: now } }, orderBy: { scheduledAt: "asc" }, select: { scheduledAt: true, callPerson: { select: { name: true } } } });
  return next ? `${callWhenLabel(next.scheduledAt)}${next.callPerson ? ` with ${next.callPerson.name}` : ""}` : null;
}

// ── A client's call history (the shared dropdown — components/ClientCallsDropdown.tsx) ──

export type HistoryCall = {
  id: string;
  scheduledAt: string;
  status: MeetingStatus;
  callPerson: string | null;
  outcome: string | null;
  summary: string | null;
  nextSteps: string[];
  internalNotes: string | null;
  reason: string | null; // not held / rescheduled
  chain: { at: string; status: MeetingStatus }[]; // reschedules, oldest first, ending with this call
  loggedDaysAfter: number | null; // HELD / NOT_HELD: days from the call to its log
};
export type ClientCallHistory = {
  next: { id: string; scheduledAt: string } | null;
  history: HistoryCall[];
  stats: { heldThisMonth: number; missedThisMonth: number; rescheduledThisMonth: number; avgDaysToLog: number | null };
};

export const daysBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / DAY));

// Reschedules collapsed into chains: one entry per call that replaced nobody
// later (held / didn't happen / still pending), newest first, carrying the
// times it moved through. Team only (internal notes, outcome).
export function buildHistory(calls: { id: string; scheduledAt: Date; status: MeetingStatus; rescheduledFromId: string | null; callPerson: { name: string } | null; outcome: ClientMood | null; summary: string | null; nextSteps: string[]; internalNotes: string | null; notHeldReason: string | null; rescheduleReason: string | null; loggedAt: Date | null }[]): HistoryCall[] {
  const byId = new Map(calls.map((c) => [c.id, c]));
  const replaced = new Set(calls.map((c) => c.rescheduledFromId).filter(Boolean));
  return calls
    .filter((c) => !replaced.has(c.id))
    .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime())
    .map((c) => {
      const chain: { at: string; status: MeetingStatus }[] = [];
      for (let x: typeof c | undefined = c, i = 0; x && i < 50; x = x.rescheduledFromId ? byId.get(x.rescheduledFromId) : undefined, i++) chain.unshift({ at: x.scheduledAt.toISOString(), status: x.status });
      const firstReason = c.rescheduledFromId ? byId.get(c.rescheduledFromId)?.rescheduleReason ?? null : null;
      return {
        id: c.id,
        scheduledAt: c.scheduledAt.toISOString(),
        status: c.status,
        callPerson: c.callPerson?.name ?? null,
        outcome: c.outcome ? OUTCOME_LABELS[c.outcome] : null,
        summary: c.summary,
        nextSteps: c.nextSteps,
        internalNotes: c.internalNotes,
        reason: c.notHeldReason ?? firstReason,
        chain,
        loggedDaysAfter: c.loggedAt && (c.status === "HELD" || c.status === "NOT_HELD") ? daysBetween(c.scheduledAt, c.loggedAt) : null,
      };
    });
}

export async function getClientCallHistory(clientId: string, now = new Date()): Promise<ClientCallHistory> {
  const calls = await prisma.amCall.findMany({
    where: { clientId, scheduledAt: { gte: new Date(now.getTime() - 180 * DAY) } },
    orderBy: { scheduledAt: "desc" },
    select: { id: true, scheduledAt: true, status: true, rescheduledFromId: true, callPerson: { select: { name: true } }, outcome: true, summary: true, nextSteps: true, internalNotes: true, notHeldReason: true, rescheduleReason: true, loggedAt: true },
  });
  const month = sydneyDay(now).slice(0, 7);
  const thisMonth = calls.filter((c) => sydneyDay(c.scheduledAt).slice(0, 7) === month);
  const logged = calls.filter((c) => c.loggedAt && (c.status === "HELD" || c.status === "NOT_HELD"));
  const next = calls.filter((c) => c.status === "PENDING" && c.scheduledAt > now).sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0];
  return {
    next: next ? { id: next.id, scheduledAt: next.scheduledAt.toISOString() } : null,
    history: buildHistory(calls),
    stats: {
      heldThisMonth: thisMonth.filter((c) => c.status === "HELD").length,
      missedThisMonth: thisMonth.filter((c) => c.status === "NOT_HELD" || (c.status === "PENDING" && c.scheduledAt < now)).length,
      rescheduledThisMonth: thisMonth.filter((c) => c.status === "RESCHEDULED").length,
      avgDaysToLog: logged.length ? Math.round((logged.reduce((s, c) => s + (c.loggedAt!.getTime() - c.scheduledAt.getTime()), 0) / logged.length / DAY) * 10) / 10 : null,
    },
  };
}
