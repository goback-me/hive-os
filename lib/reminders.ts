import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { HANDOVER_STAGES, STAGE_LABELS, type LeadStageValue } from "./lead-status";
import { milestoneSql } from "./milestones";
import { sydneyDay, sydneyHour, weekStart } from "./sheet-parse";
import { queueSlack } from "./slack";
import { ensureTask } from "./clickup";
import { getClientCycle, type CycleStep } from "./buying-cycle";
import { appUrl, emailConfigured, sendActionEmail, type EmailRow } from "./email";

// "This lead needs your update". The daily cron (from 9am Sydney) reminds
// the client about leads waiting on them, on a schedule per step — using
// their own buying cycle (lib/buying-cycle.ts):
//   awaiting (PENDING UPDATE)  7 days after handoverAt, then every 7 days
//   CONSULT_BOOKED             1 day after the consult if we know its date,
//                              else handover + handover→attended median;
//                              then every 7 days
//   CONSULT_ATTENDED           attended + attended→quote median, then every
//                              half that median
//   QUOTE_SENT                 quote + quote→close median, then every
//                              max(7, median / 2) days
// At 2× the step's median (14 days for awaiting) the lead is staleInStage:
// "Likely lost? Close it out" on the Update panel + CLIENT_UPDATE_OVERDUE.
// Each run sends ONE combined message per client — the in-app task
// (LeadReminder rows, shown on the "Update your leads" panel), an email
// (Resend, when RESEND_API_KEY + EMAIL_FROM are set) and a post to the
// client's Slack channel — plus a "Chase client" ClickUp task for our team,
// at most once per client per week. LeadReminder (one row per lead per step
// sent) is what stops a reminder going out twice.

export const REMINDER_DAYS = 7;
export const REMINDER_HOUR = 9;
const DAY = 86_400_000;

export type ReminderStep = "awaiting" | "CONSULT_BOOKED" | "CONSULT_ATTENDED" | "QUOTE_SENT";
export const STAGE_STEPS: ReminderStep[] = ["CONSULT_BOOKED", "CONSULT_ATTENDED", "QUOTE_SENT"];
export type ReminderPlan = { first: Date; everyDays: number; staleAt: Date };

const plus = (d: Date, days: number) => new Date(d.getTime() + days * DAY);

// When a step's reminders start, how often they repeat, and when the lead is
// stale. `anchor` = when the step started (handover / attended / quoted);
// `consultAt` = the consult's own date — not in the sheet yet, so null.
export function reminderPlan(step: ReminderStep, anchor: Date, cycle: Record<CycleStep, number>, consultAt: Date | null = null): ReminderPlan {
  switch (step) {
    case "awaiting":
      return { first: plus(anchor, REMINDER_DAYS), everyDays: REMINDER_DAYS, staleAt: plus(anchor, 2 * REMINDER_DAYS) };
    case "CONSULT_BOOKED": {
      const m = cycle.handoverToAttended;
      return { first: consultAt ? plus(consultAt, 1) : plus(anchor, m), everyDays: REMINDER_DAYS, staleAt: plus(anchor, 2 * m) };
    }
    case "CONSULT_ATTENDED": {
      const m = cycle.attendedToQuote;
      return { first: plus(anchor, m), everyDays: m / 2, staleAt: plus(anchor, 2 * m) };
    }
    case "QUOTE_SENT": {
      const m = cycle.quoteToClose;
      return { first: plus(anchor, m), everyDays: Math.max(REMINDER_DAYS, m / 2), staleAt: plus(anchor, 2 * m) };
    }
  }
}

export const nextReminderAt = (plan: ReminderPlan, lastSent: Date | null) =>
  lastSent ? new Date(Math.max(plan.first.getTime(), lastSent.getTime() + plan.everyDays * DAY)) : plan.first;
// By Sydney day, so everything due today goes out together in the 9am run.
export const isDueOn = (at: Date, now: Date) => sydneyDay(at) <= sydneyDay(now);

// handoverAt for one lead or a whole client: the first handover's milestone
// (lib/milestones.ts), else the first time a sync saw it at a handover.
// ponytail: recomputed with correlated subqueries per sync — index on
// LeadStageEvent(leadId, stage) keeps it cheap; only writes rows that change.
export async function refreshHandoverAt(where: { clientId: string } | { leadId: string }) {
  const filter = "leadId" in where ? Prisma.sql`l.id = ${where.leadId}` : Prisma.sql`l."clientId" = ${where.clientId}`;
  await prisma.$executeRaw`
    UPDATE "Lead" t SET "handoverAt" = x.at FROM (
      SELECT l.id, COALESCE(
        ${milestoneSql(HANDOVER_STAGES)},
        (SELECT MIN(e.at) FROM "LeadStageEvent" e WHERE e."leadId" = l.id AND e.stage::text IN (${Prisma.join(HANDOVER_STAGES)}) AND e.source::text <> 'INFERRED')
      ) AS at
      FROM "Lead" l WHERE ${filter}
    ) x
    WHERE t.id = x.id AND t."handoverAt" IS DISTINCT FROM x.at
  `;
}

// Leads the client is overdue on right now: handed over 7+ days ago with no
// update, or stale in their stage — the data-health CLIENT_UPDATE_OVERDUE
// check and the weekly draft.
export async function overdueLeads(clientId: string, now = new Date()) {
  const cutoff = new Date(now.getTime() - REMINDER_DAYS * DAY);
  return prisma.$queryRaw<{ id: string }[]>`
    SELECT l.id FROM "Lead" l JOIN "Client" c ON c.id = l."clientId"
    WHERE l."clientId" = ${clientId} AND l."deletedAt" IS NULL
      AND (c."startDate" IS NULL OR l."createdAt" >= c."startDate")
      AND ((l."awaitingClientUpdate" AND COALESCE(l."handoverAt", l."createdAt") <= ${cutoff}) OR l."staleInStage")
  `;
}

// The "Update your leads" panel's leads (and the Dashboard tab's count):
// awaiting from day 1, plus booked / attended / quoted once reminded or stale.
export const updatePanelWhere = (clientId: string): Prisma.LeadWhereInput => ({
  clientId,
  deletedAt: null,
  OR: [{ awaitingClientUpdate: true }, { staleInStage: true }, ...STAGE_STEPS.map((s) => ({ stage: s as LeadStageValue, reminders: { some: { reason: s } } }))],
});

export const handoverLabel = (stage: LeadStageValue | null) => (stage && HANDOVER_STAGES.includes(stage) ? STAGE_LABELS[stage] : "Handed over");

type Candidate = {
  id: string;
  clientId: string;
  name: string | null;
  stage: LeadStageValue;
  awaiting: boolean;
  staleInStage: boolean;
  handoverAt: Date | null;
  createdAt: Date;
  bookedAt: Date | null;
  attendedAt: Date | null;
  quoteAt: Date | null;
  stageSince: Date | null;
  lastSent: Date | null;
};

const stepOf = (c: Pick<Candidate, "awaiting" | "stage">): ReminderStep => (c.awaiting ? "awaiting" : (c.stage as ReminderStep));

// When the lead's current step started: its milestone, else when it reached
// the stage, else the opt-in date.
export function stepAnchor(c: Omit<Candidate, "id" | "clientId" | "name" | "staleInStage" | "lastSent">): Date {
  const since = c.stageSince ?? c.createdAt;
  switch (stepOf(c)) {
    case "awaiting":
      return c.handoverAt ?? c.createdAt;
    case "CONSULT_BOOKED":
      return c.handoverAt ?? c.bookedAt ?? since;
    case "CONSULT_ATTENDED":
      return c.attendedAt ?? since;
    case "QUOTE_SENT":
      return c.quoteAt ?? since;
  }
}

function line(c: Candidate, anchor: Date, stale: boolean, now: Date) {
  const n = Math.max(0, Math.floor((now.getTime() - anchor.getTime()) / DAY));
  const d = `${n} day${n === 1 ? "" : "s"}`;
  const text = {
    awaiting: `${handoverLabel(c.stage)}, waiting ${d}`,
    CONSULT_BOOKED: `consult booked, ${d} since handover — did it go ahead?`,
    CONSULT_ATTENDED: `consult attended ${d} ago — has a quote gone out?`,
    QUOTE_SENT: `quoted ${d} ago — won or lost?`,
  }[stepOf(c)];
  return `• ${c.name || "Unnamed lead"} — ${text}${stale ? " Likely lost? Close it out." : ""}`;
}

// The same lead as a row in the email's list.
function emailRow(c: Candidate, anchor: Date, stale: boolean, now: Date): EmailRow {
  const days = Math.max(0, Math.floor((now.getTime() - anchor.getTime()) / DAY));
  const detail = {
    awaiting: `${handoverLabel(c.stage)} — what happened next?`,
    CONSULT_BOOKED: "Consult booked — did it go ahead?",
    CONSULT_ATTENDED: "Consult done — has a quote gone out?",
    QUOTE_SENT: "Quote sent — won or lost?",
  }[stepOf(c)];
  return { title: c.name || "Unnamed lead", detail, days, flag: stale ? "likely lost?" : undefined };
}

export async function raiseReminders(now = new Date()) {
  if (sydneyHour(now) < REMINDER_HOUR) return { skipped: "before 9am Sydney" };

  // ponytail: lastSent is the latest reminder for this step ever — a lead
  // that leaves a step and comes back months later resumes its old cadence.
  const candidates = await prisma.$queryRaw<Candidate[]>`
    SELECT l.id, l."clientId", l.name, l.stage, l."awaitingClientUpdate" AS awaiting, l."staleInStage", l."handoverAt", l."createdAt",
      ${milestoneSql("CONSULT_BOOKED")} AS "bookedAt",
      ${milestoneSql("CONSULT_ATTENDED")} AS "attendedAt",
      ${milestoneSql("QUOTE_SENT")} AS "quoteAt",
      (SELECT MAX(e.at) FROM "LeadStageEvent" e WHERE e."leadId" = l.id AND e.stage = l.stage AND e.source::text <> 'INFERRED') AS "stageSince",
      (SELECT MAX(r."createdAt") FROM "LeadReminder" r WHERE r."leadId" = l.id
        AND r.reason = CASE WHEN l."awaitingClientUpdate" THEN 'awaiting' ELSE l.stage::text END) AS "lastSent"
    FROM "Lead" l JOIN "Client" c ON c.id = l."clientId"
    WHERE l."deletedAt" IS NULL AND c."archivedAt" IS NULL
      AND (l."awaitingClientUpdate" OR l.stage::text IN (${Prisma.join(STAGE_STEPS)}))
      AND (c."startDate" IS NULL OR l."createdAt" >= c."startDate")
  `;

  const cycles = new Map<string, Record<CycleStep, number>>();
  for (const clientId of new Set(candidates.map((c) => c.clientId))) {
    const cy = await getClientCycle(clientId);
    cycles.set(clientId, { handoverToAttended: cy.handoverToAttended.medianDays, attendedToQuote: cy.attendedToQuote.medianDays, quoteToClose: cy.quoteToClose.medianDays });
  }

  const planned = candidates.map((c) => {
    const anchor = stepAnchor(c);
    const plan = reminderPlan(stepOf(c), anchor, cycles.get(c.clientId)!);
    return { c, anchor, plan, outstanding: now >= plan.first, due: isDueOn(nextReminderAt(plan, c.lastSent), now), stale: now >= plan.staleAt };
  });

  // staleInStage follows the schedule; a lead that left its step drops it.
  const staleIds = planned.filter((p) => p.stale).map((p) => p.c.id);
  await prisma.$transaction([
    prisma.lead.updateMany({ where: { staleInStage: true, id: { notIn: staleIds } }, data: { staleInStage: false } }),
    prisma.lead.updateMany({ where: { staleInStage: false, id: { in: staleIds } }, data: { staleInStage: true } }),
  ]);

  const due = planned.filter((p) => p.due);
  if (!due.length) return { raised: 0, emailed: 0, clients: 0, stale: staleIds.length };
  await prisma.leadReminder.createMany({ data: due.map((p) => ({ clientId: p.c.clientId, leadId: p.c.id, reason: stepOf(p.c) })) });

  // One message per client, listing every lead past its first reminder (not
  // just the ones that fell due today), longest-waiting first.
  const dueClients = new Set(due.map((p) => p.c.clientId));
  const today = sydneyDay(now);
  const weekKey = sydneyDay(weekStart(now));
  let emailed = 0;
  for (const clientId of dueClients) {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { name: true, slug: true, email: true, slackChannelId: true, users: { where: { role: "CLIENT" }, select: { email: true } } },
    });
    if (!client) continue;
    const mine = planned.filter((p) => p.c.clientId === clientId && p.outstanding).sort((a, b) => a.anchor.getTime() - b.anchor.getTime());
    const lines = mine.map((p) => line(p.c, p.anchor, p.stale, now));
    const path = `/clients/${client.slug}/updates`;
    const link = `${appUrl()}${path}`;
    const n = `${mine.length} lead${mine.length === 1 ? "" : "s"}`;

    if (emailConfigured()) {
      try {
        // The leads in this email are pinned at the top of the page it opens.
        const sent = await sendActionEmail({
          to: client.users.length ? client.users.map((u) => u.email) : client.email ? [client.email] : [],
          type: "client_update",
          clientId,
          refIds: mine.map((p) => p.c.id),
          path,
          subject: `${client.name}: ${n} waiting on your update`,
          heading: `${n} ${mine.length === 1 ? "is" : "are"} waiting on your update`,
          intro: `Hi ${client.name} — we handed these leads over to you. Let us know what happened with each one so we can keep your results accurate. It takes a few seconds per lead.`,
          rows: mine.map((p) => emailRow(p.c, p.anchor, p.stale, now)),
          footnote: "You're getting this because Hive Social passes leads to you and tracks how they turn out in Hive HQ.",
          button: "Update your leads",
        });
        if (sent) {
          emailed++;
          await prisma.leadReminder.updateMany({ where: { clientId, leadId: { in: due.map((p) => p.c.id) }, emailedAt: null }, data: { emailedAt: now } });
        }
      } catch (err) {
        console.error(`Reminder email for ${clientId} failed:`, err); // the in-app task still shows
      }
    }
    if (client.slackChannelId) {
      await queueSlack({ clientId, channel: client.slackChannelId, kind: "client_update_reminder", dedupeKey: `client_update_reminder:${clientId}:${today}`, text: [`:hourglass_flowing_sand: *${n} waiting on an update*`, ...lines, `<${link}|Update them in Hive HQ>`].join("\n") }).catch((e) => console.error("Slack queue failed:", e));
    }
    await ensureTask(clientId, { kind: "chase_client", dedupeKey: `chase:${clientId}:${weekKey}`, title: `Chase client — ${n} waiting on their update`, why: "We handed these leads over and the client hasn't told us what happened. Ask them to update each lead (link below) — their reminder email has the same link.", description: `${lines.join("\n")}\n\n${link}` });
  }
  return { raised: due.length, emailed, clients: dueClients.size, stale: staleIds.length };
}
