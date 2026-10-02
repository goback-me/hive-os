import { prisma } from "./prisma";
import { STAGE_LABELS, type LeadStageValue } from "./lead-status";

// "This lead needs your update": a lead the client owes us news on — awaiting
// their update after a handover, or sitting at Consult booked / Quote sent —
// for 7+ days without being won or lost. Raised by the cron; shown as a task
// in the client's "Update your leads" panel and emailed (Resend) when
// RESEND_API_KEY + EMAIL_FROM are set. At most one per lead per 7 days.

export const REMINDER_DAYS = 7;
const DAY = 86_400_000;

type Due = { id: string; clientId: string; name: string | null; stage: LeadStageValue; awaitingClientUpdate: boolean; since: Date };

export async function raiseReminders(now = new Date()) {
  const cutoff = new Date(now.getTime() - REMINDER_DAYS * DAY);
  // How long it's been waiting = since it reached its current stage.
  const due = await prisma.$queryRaw<Due[]>`
    SELECT * FROM (
      SELECT l.id, l."clientId", l.name, l.stage, l."awaitingClientUpdate",
        COALESCE((SELECT MAX(e.at) FROM "LeadStageEvent" e WHERE e."leadId" = l.id AND e.stage = l.stage AND e.source::text <> 'INFERRED'), l."createdAt") AS since
      FROM "Lead" l JOIN "Client" c ON c.id = l."clientId"
      WHERE l."deletedAt" IS NULL AND c."archivedAt" IS NULL
        AND (l."awaitingClientUpdate" OR l.stage IN ('CONSULT_BOOKED', 'QUOTE_SENT'))
        AND (c."startDate" IS NULL OR l."createdAt" >= c."startDate")
        AND NOT EXISTS (SELECT 1 FROM "LeadReminder" r WHERE r."leadId" = l.id AND r."createdAt" > ${cutoff})
    ) d
    WHERE d.since <= ${cutoff}
  `;
  if (!due.length) return { raised: 0, emailed: 0 };

  await prisma.leadReminder.createMany({
    data: due.map((d) => ({ clientId: d.clientId, leadId: d.id, reason: d.awaitingClientUpdate ? "awaiting" : d.stage })),
  });

  let emailed = 0;
  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
    const byClient = new Map<string, Due[]>();
    for (const d of due) byClient.set(d.clientId, [...(byClient.get(d.clientId) ?? []), d]);
    for (const [clientId, leads] of byClient) {
      try {
        if (await emailClient(clientId, leads, now)) {
          emailed += leads.length;
          await prisma.leadReminder.updateMany({ where: { clientId, leadId: { in: leads.map((l) => l.id) }, emailedAt: null }, data: { emailedAt: now } });
        }
      } catch (err) {
        console.error(`Reminder email for ${clientId} failed:`, err); // the in-app task still shows
      }
    }
  }
  return { raised: due.length, emailed };
}

async function emailClient(clientId: string, leads: Due[], now: Date) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { name: true, slug: true, email: true, users: { where: { role: "CLIENT" }, select: { email: true } } },
  });
  const to = client?.users.length ? client.users.map((u) => u.email) : client?.email ? [client.email] : [];
  if (!client || !to.length) return false;

  const appUrl = process.env.NEXTAUTH_URL || "";
  const days = (d: Due) => Math.floor((now.getTime() - new Date(d.since).getTime()) / DAY);
  const lines = leads.map((l) => `• ${l.name || "Unnamed lead"} — ${l.awaitingClientUpdate ? "waiting on your update" : STAGE_LABELS[l.stage]} (${days(l)} days)`);
  const text = [
    `Hi ${client.name},`,
    "",
    `${leads.length} lead${leads.length === 1 ? " needs" : "s need"} an update from you — please mark each as won (with the job value) or lost:`,
    "",
    ...lines,
    "",
    `Update them here: ${appUrl}/clients/${client.slug}?tab=dashboard`,
    "",
    "— Hive Social",
  ].join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject: `${leads.length} lead${leads.length === 1 ? "" : "s"} waiting on your update`, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return true;
}
