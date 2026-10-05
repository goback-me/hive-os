import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { HANDOVER_STAGES, STAGE_LABELS, type LeadStageValue } from "./lead-status";
import { milestoneSql } from "./milestones";
import { sydneyDay, sydneyHour, weekStart } from "./sheet-parse";
import { queueSlack } from "./slack";
import { ensureTask } from "./clickup";

// "This lead needs your update": a handed-over lead the client hasn't
// reported back on (awaitingClientUpdate). Day 7 after the handover, then
// every 7 days while it's still waiting, the daily cron (from 9am Sydney)
// sends ONE combined reminder per client: the in-app task (LeadReminder rows,
// shown on the "Update your leads" panel), an email (Resend, when
// RESEND_API_KEY + EMAIL_FROM are set), a post to the client's Slack channel,
// and a "Chase client" ClickUp task for our team — Slack + ClickUp at most
// once per client per week. LeadReminder = at most one per lead per 7 days.

export const REMINDER_DAYS = 7;
export const REMINDER_HOUR = 9;
const DAY = 86_400_000;

// The waiting clock: from the handover. A lead marked "pending update" in
// the sheet without any handover on record falls back to its opt-in date.
const waitingSince = Prisma.sql`COALESCE(l."handoverAt", l."createdAt")`;

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

type Waiting = { id: string; clientId: string; name: string | null; stage: LeadStageValue; since: Date };

// Leads a client has owed an update on for 7+ days since the handover, right
// now — the data-health CLIENT_UPDATE_OVERDUE check and the reminder list.
export async function overdueLeads(clientId: string | null, now = new Date()) {
  const cutoff = new Date(now.getTime() - REMINDER_DAYS * DAY);
  return prisma.$queryRaw<Waiting[]>`
    SELECT * FROM (
      SELECT l.id, l."clientId", l.name, l.stage, ${waitingSince} AS since
      FROM "Lead" l JOIN "Client" c ON c.id = l."clientId"
      WHERE l."deletedAt" IS NULL AND c."archivedAt" IS NULL AND l."awaitingClientUpdate"
        AND (c."startDate" IS NULL OR l."createdAt" >= c."startDate")
        ${clientId ? Prisma.sql`AND l."clientId" = ${clientId}` : Prisma.empty}
    ) d WHERE d.since <= ${cutoff}
    ORDER BY d.since ASC
  `;
}

export const handoverLabel = (stage: LeadStageValue) => (HANDOVER_STAGES.includes(stage) ? STAGE_LABELS[stage] : "Handed over");

export async function raiseReminders(now = new Date()) {
  if (sydneyHour(now) < REMINDER_HOUR) return { skipped: "before 9am Sydney" };
  const cutoff = new Date(now.getTime() - REMINDER_DAYS * DAY);
  const overdue = await overdueLeads(null, now);
  const reminded = new Set(
    (await prisma.leadReminder.findMany({ where: { leadId: { in: overdue.map((l) => l.id) }, createdAt: { gt: cutoff } }, select: { leadId: true } })).map((r) => r.leadId)
  );
  const due = overdue.filter((l) => !reminded.has(l.id));
  if (!due.length) return { raised: 0, emailed: 0, clients: 0 };

  await prisma.leadReminder.createMany({ data: due.map((d) => ({ clientId: d.clientId, leadId: d.id, reason: "awaiting" })) });

  // One message per client, listing every overdue lead (not just the ones
  // whose reminder fell due today).
  const dueClients = new Set(due.map((d) => d.clientId));
  const weekKey = sydneyDay(weekStart(now));
  let emailed = 0;
  for (const clientId of dueClients) {
    const leads = overdue.filter((l) => l.clientId === clientId);
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { name: true, slug: true, email: true, slackChannelId: true, users: { where: { role: "CLIENT" }, select: { email: true } } },
    });
    if (!client) continue;
    const link = `${process.env.NEXTAUTH_URL || ""}/clients/${client.slug}?tab=dashboard`;
    const lines = leads.map((l) => `• ${l.name || "Unnamed lead"} — ${handoverLabel(l.stage)}, waiting ${Math.floor((now.getTime() - new Date(l.since).getTime()) / DAY)} days`);
    const n = `${leads.length} lead${leads.length === 1 ? "" : "s"}`;

    if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
      try {
        if (await email(client, `${n} waiting on your update`, [`Hi ${client.name},`, "", `${n} ${leads.length === 1 ? "needs" : "need"} an update from you — tell us what happened with each (booked, quoted, won or lost):`, "", ...lines, "", `Update them here: ${link}`, "", "— Hive Social"].join("\n"))) {
          emailed++;
          await prisma.leadReminder.updateMany({ where: { clientId, leadId: { in: due.map((d) => d.id) }, emailedAt: null }, data: { emailedAt: now } });
        }
      } catch (err) {
        console.error(`Reminder email for ${clientId} failed:`, err); // the in-app task still shows
      }
    }
    if (client.slackChannelId) {
      await queueSlack({ clientId, channel: client.slackChannelId, kind: "client_update_reminder", dedupeKey: `client_update_reminder:${clientId}:${weekKey}`, text: [`:hourglass_flowing_sand: *${n} waiting on an update*`, ...lines, `<${link}|Update them in Hive HQ>`].join("\n") }).catch((e) => console.error("Slack queue failed:", e));
    }
    await ensureTask(clientId, { kind: "chase_client", dedupeKey: `chase:${clientId}:${weekKey}`, title: `Chase client to update ${n}`, description: `${lines.join("\n")}\n\n${link}` });
  }
  return { raised: due.length, emailed, clients: dueClients.size };
}

async function email(client: { email: string | null; users: { email: string }[] }, subject: string, text: string) {
  const to = client.users.length ? client.users.map((u) => u.email) : client.email ? [client.email] : [];
  if (!to.length) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return true;
}
