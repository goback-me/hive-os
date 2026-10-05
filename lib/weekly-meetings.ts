import type { ClientMood, MeetingStatus, Weekday } from "@prisma/client";
import { prisma } from "./prisma";
import { sydneyDay, sydneyLocalToDate, weekStart } from "./sheet-parse";
import { ensureTask, commentOnTask } from "./clickup";
import { appUrl, sendActionEmail } from "./email";

// The weekly client call. Each client with a call agent (Client.
// weeklyCallAgentId) gets a WeeklyMeeting for its call day (weeklyCallDay,
// default Friday):
//   Monday 9am after it   created PENDING + a ClickUp task for the agent +
//                         an email "Log last Friday's call with <client>"
//   Wednesday 9am         still PENDING → a second email + a ClickUp comment
//   Friday 9am            still PENDING → MEETING_NOT_LOGGED (lib/data-health.ts)
// The agent logs it on /clients/<slug>/meetings/<id> (submitWeeklyMeeting in
// lib/actions.ts). Every step is idempotent — the 5-minute cron re-runs it.

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
export const MOOD_LABELS: Record<ClientMood, string> = { GOOD: "Good", NEUTRAL: "Neutral", AT_RISK: "At risk" };
export const NOT_HELD_REASONS = { NO_SHOW: "Client no-show", RESCHEDULED: "Rescheduled", OTHER: "Other" } as const;

// Sydney midnight `days` after the Sydney day of `d` (+ an hour of the day).
function sydneyDayPlus(d: Date, days: number, hour = 0) {
  const [y, m, day] = sydneyDay(d).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, day + days));
  return sydneyLocalToDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), hour)!;
}

// The call day in the week before `now`'s week (Sydney) — what Monday's job logs.
export const previousCallDate = (now: Date, day: Weekday) => sydneyDayPlus(weekStart(now), WEEKDAYS.indexOf(day) - 7);

// When each step is due for a meeting on `weekOf`: Monday / Wednesday /
// Friday 9am of the following week.
export function meetingSchedule(weekOf: Date) {
  const nextMonday = weekStart(sydneyDayPlus(weekStart(weekOf), 7));
  return { createAt: sydneyDayPlus(nextMonday, 0, 9), remindAt: sydneyDayPlus(nextMonday, 2, 9), alertAt: sydneyDayPlus(nextMonday, 4, 9) };
}

export const meetingKey = (clientId: string, weekOf: Date) => `${clientId}|${weekOf.toISOString()}`;

// Which meetings the job should create now — none twice (existing = keys of
// meetings already there).
export function meetingsToCreate(clients: { id: string; weeklyCallAgentId: string | null; weeklyCallDay: Weekday }[], existing: Set<string>, now: Date) {
  return clients
    .filter((c) => c.weeklyCallAgentId)
    .map((c) => ({ clientId: c.id, agentId: c.weeklyCallAgentId, weekOf: previousCallDate(now, c.weeklyCallDay) }))
    .filter((m) => now >= meetingSchedule(m.weekOf).createAt && !existing.has(meetingKey(m.clientId, m.weekOf)));
}

export const callDateLabel = (d: Date) => d.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short" });

// The ClickUp task once the call is logged: what to write on it — it's
// always closed after (HELD or NOT_HELD).
export function meetingTaskUpdate(m: {
  status: MeetingStatus;
  summary?: string | null;
  issues?: string | null;
  nextSteps?: string | null;
  clientMood?: ClientMood | null;
  notHeldReason?: string | null;
}): { description: string; close: true } | null {
  if (m.status === "PENDING") return null;
  if (m.status === "NOT_HELD") return { description: `Meeting did not happen: ${m.notHeldReason || "no reason given"}`, close: true };
  const parts = [
    m.summary?.trim() && `Summary:\n${m.summary.trim()}`,
    m.issues?.trim() && `Issues:\n${m.issues.trim()}`,
    m.nextSteps?.trim() && `Next steps:\n${m.nextSteps.trim()}`,
    m.clientMood && `Client mood: ${MOOD_LABELS[m.clientMood]}`,
  ].filter(Boolean);
  return { description: parts.join("\n\n") || "Meeting held.", close: true };
}

const meetingPath = (slug: string, id: string) => `/clients/${slug}/meetings/${id}`;

export async function runMeetingJobs(now = new Date()) {
  const out = { created: 0, tasks: 0, emails: 0, reminders: 0 };
  const clients = await prisma.client.findMany({
    where: { archivedAt: null, weeklyCallAgentId: { not: null } },
    select: { id: true, weeklyCallAgentId: true, weeklyCallDay: true },
  });
  if (clients.length) {
    const recent = await prisma.weeklyMeeting.findMany({ where: { clientId: { in: clients.map((c) => c.id) }, weekOf: { gte: new Date(now.getTime() - 21 * 86_400_000) } }, select: { clientId: true, weekOf: true } });
    const todo = meetingsToCreate(clients, new Set(recent.map((m) => meetingKey(m.clientId, m.weekOf))), now);
    if (todo.length) out.created = (await prisma.weeklyMeeting.createMany({ data: todo, skipDuplicates: true })).count;
  }

  // Follow-ups for every pending meeting from the last few weeks.
  const pending = await prisma.weeklyMeeting.findMany({
    where: { status: "PENDING", weekOf: { gte: new Date(now.getTime() - 21 * 86_400_000) } },
    include: { client: { select: { name: true, slug: true } }, agent: { select: { email: true, name: true, clickupUserId: true } } },
  });
  for (const m of pending) {
    const when = meetingSchedule(m.weekOf);
    if (now < when.createAt) continue;
    const day = callDateLabel(m.weekOf);
    const link = `${appUrl()}${meetingPath(m.client.slug, m.id)}`;

    // ClickUp: one task per meeting, made once (clickupTaskId) — a ClickUp
    // failure is logged and never stops the email.
    if (!m.clickupTaskId) {
      const taskId = await ensureTask(m.clientId, {
        kind: "weekly_call",
        dedupeKey: `meeting:${m.id}`,
        title: `Log the weekly call — ${day}`,
        why: `${m.agent?.name ?? "The agent"} ran (or should have run) this client's weekly call on ${day} — log how it went in Hive HQ. This task closes itself once it's logged.`,
        description: `Log the call in Hive HQ:\n${link}`,
        assignees: m.agent?.clickupUserId ? [m.agent.clickupUserId] : [],
      }).catch(() => null);
      if (taskId) {
        await prisma.weeklyMeeting.update({ where: { id: m.id }, data: { clickupTaskId: taskId } });
        m.clickupTaskId = taskId;
        out.tasks++;
      }
    }

    if (!m.agent?.email) continue;
    const sentTypes = new Set((await prisma.emailLog.findMany({ where: { refIds: { has: m.id } }, select: { type: true } })).map((e) => e.type));
    // Subject says which client and what for; the heading is the plain ask.
    const email = (type: string, subject: string, heading: string, intro: string) =>
      sendActionEmail({
        to: [m.agent!.email],
        type,
        clientId: m.clientId,
        refIds: [m.id],
        path: meetingPath(m.client.slug, m.id),
        subject,
        heading,
        intro,
        button: "Log the call",
        footnote: `You're getting this because you run the weekly call with ${m.client.name} in Hive HQ.`,
      }).catch((e) => (console.error(`Meeting email (${type}) for ${m.id} failed:`, e), false));

    if (!sentTypes.has("meeting_log")) {
      if (await email("meeting_log", `[${m.client.name}] Log your weekly call — ${day}`, `How did ${day}'s call with ${m.client.name} go?`, `Log the summary, issues, next steps and the client's mood — it takes a minute. If the call didn't happen, just say why.`)) out.emails++;
    } else if (now >= when.remindAt && !sentTypes.has("meeting_reminder")) {
      if (await email("meeting_reminder", `[${m.client.name}] Reminder: weekly call not logged yet — ${day}`, `${day}'s call with ${m.client.name} still isn't logged`, `Please log it today — if it's still open on Friday it's flagged to the admins.`)) {
        out.reminders++;
        if (m.clickupTaskId) await commentOnTask(m.clickupTaskId, `Reminder: this call still isn't logged in Hive HQ — ${link}`);
      }
    }
  }
  return out;
}
