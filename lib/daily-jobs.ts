import { prisma } from "./prisma";
import { sydneyDay, sydneyLocalToDate } from "./sheet-parse";
import { getRangeKpis } from "./kpi";
import { getPortfolio } from "./portfolio";
import { getNeedsAction } from "./needs-action";
import { getClientFunnel } from "./lead-sync";
import { biggestDrop } from "./funnel";
import { resolveReportRange } from "./date-range";
import { parseSlackEvents, queueSlack, slackConfigured } from "./slack";
import { ensureTask } from "./clickup";
import { weekStart } from "./weekly";
import { terms } from "./client-terms";

// Once-a-day work, run by the cron from 8am Sydney: each client's Slack
// digest, the agency's portfolio digest, and the weekly ClickUp tasks. Every
// item has a dedupe key for the day/week, so the 5-minute cron sends each
// once no matter how often it runs after 8.

const DIGEST_HOUR = 8;
const appUrl = () => process.env.NEXTAUTH_URL || "";
const sydneyHour = (d: Date) => Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", hourCycle: "h23" }).format(d));
const startOfDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return sydneyLocalToDate(y, m, d)!;
};
const addDaysKey = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

// The suggested next step for a client: its most urgent Needs Action item,
// else the weakest funnel step this month (biggest drop).
async function nextStepFor(clientId: string, needs: Awaited<ReturnType<typeof getNeedsAction>>, now: Date) {
  const top = needs.find((n) => n.clientId === clientId && n.severity !== "success");
  const funnel = await getClientFunnel(clientId, resolveReportRange({ preset: "this_month" }, now)).catch(() => null);
  const drop = funnel ? biggestDrop(funnel.overall.counts) : null;
  return [top?.description, drop ? `${drop.step} is the weakest step (${Math.round(drop.rate)}%) — ${drop.advice}` : null].filter(Boolean).join(". ");
}

export async function runDailyJobs(now = new Date()) {
  if (sydneyHour(now) < DIGEST_HOUR) return { skipped: "before 8am Sydney" };
  const today = sydneyDay(now);
  const yesterday = addDaysKey(today, -1);
  const out = { clientDigests: 0, adminDigest: false, tasks: 0 };
  const clients = await prisma.client.findMany({
    where: { archivedAt: null, status: { not: "CHURNED" } },
    select: { id: true, name: true, slug: true, slackChannelId: true, slackEvents: true, clientType: true, clickupListId: true },
  });

  // ── Client digests: yesterday's numbers + what needs doing ──
  if (slackConfigured()) {
    for (const c of clients) {
      if (!c.slackChannelId || !parseSlackEvents(c.slackEvents).dailyDigest) continue;
      const key = `client_digest:${c.id}:${today}`;
      if (await prisma.slackPostLog.findUnique({ where: { dedupeKey: key } })) continue;
      const [k, awaiting, danger, step] = await Promise.all([
        getRangeKpis(c.id, { from: startOfDay(yesterday), to: startOfDay(today) }, now),
        prisma.lead.count({ where: { clientId: c.id, deletedAt: null, awaitingClientUpdate: true } }),
        prisma.dataAlert.findMany({ where: { clientId: c.id, status: "OPEN", severity: "DANGER" }, select: { title: true, fixHint: true } }),
        prisma.contactLog.findFirst({ where: { clientId: c.id, nextStep: { not: null } }, orderBy: { contactedAt: "desc" }, select: { nextStep: true, nextStepDue: true } }),
      ]);
      const t = terms(c.clientType);
      const lines = [
        `:sunrise: *${c.name} — yesterday*`,
        `Leads *${k.leads}* · Live transfers *${k.liveTransfers}* · ${t.quotes} *${k.quotes}* · ${t.sales} *${k.sales}*${k.revenue ? ` ($${Math.round(k.revenue).toLocaleString("en-US")})` : ""}`,
        awaiting ? `:hourglass_flowing_sand: ${awaiting} lead${awaiting === 1 ? "" : "s"} awaiting the client's update` : null,
        ...danger.map((a) => `:red_circle: ${a.title} — ${a.fixHint}`),
        step?.nextStep ? `:arrow_right: Next step: ${step.nextStep}${step.nextStepDue ? ` (by ${step.nextStepDue.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short" })})` : ""}` : null,
        `<${appUrl()}/clients/${c.slug}|Open in Hive HQ>`,
      ].filter(Boolean);
      if (await queueSlack({ clientId: c.id, channel: c.slackChannelId, kind: "client_digest", dedupeKey: key, text: lines.join("\n") })) out.clientDigests++;
    }

    // ── Agency digest: only the clients with something wrong ──
    const adminChannel = process.env.SLACK_ADMIN_CHANNEL;
    const adminKey = `admin_digest:${today}`;
    if (adminChannel && !(await prisma.slackPostLog.findUnique({ where: { dedupeKey: adminKey } }))) {
      const [{ rows }, needs] = await Promise.all([getPortfolio({ preset: "this_month" }, now), getNeedsAction()]);
      const overdue = new Set(needs.filter((n) => n.type === "client_updates_overdue").map((n) => n.clientId));
      const flagged = rows.filter((r) => r.health !== "green" || r.dangerAlerts > 0 || overdue.has(r.clientId));
      const lines: string[] = [];
      for (const r of flagged) {
        const issues = [
          r.dangerAlerts ? `${r.dangerAlerts} serious data problem${r.dangerAlerts === 1 ? "" : "s"}` : null,
          overdue.has(r.clientId) ? "client updates overdue" : null,
          r.needsAction ? `${r.needsAction} to action` : null,
        ].filter(Boolean);
        const step = await nextStepFor(r.clientId, needs, now);
        lines.push(`${r.health === "red" ? ":red_circle:" : ":large_orange_circle:"} *<${appUrl()}/clients/${r.slug}|${r.name}>* — ${issues.join(", ") || "needs attention"}${step ? `\n      → ${step}` : ""}`);
      }
      const text = lines.length ? `:clipboard: *Portfolio — ${lines.length} client${lines.length === 1 ? "" : "s"} need attention*\n${lines.join("\n")}` : ":white_check_mark: All clients on track.";
      out.adminDigest = await queueSlack({ channel: adminChannel, kind: "admin_digest", dedupeKey: adminKey, text });
    }
  }

  // ── Weekly ClickUp tasks ──
  const week = weekStart(now);
  const weekKey = sydneyDay(week);
  const friday = startOfDay(addDaysKey(weekKey, 4));
  const fridayFive = new Date(friday.getTime() + 17 * 3_600_000);
  const needs = await getNeedsAction();
  const red = new Set((await getPortfolio({ preset: "this_month" }, now)).rows.filter((r) => r.health === "red").map((r) => r.clientId));
  for (const c of clients.filter((x) => x.clickupListId)) {
    if (await ensureTask(c.id, { kind: "weekly_update", dedupeKey: `weekly:${c.id}:${weekKey}`, title: `Weekly update: ${c.name}`, description: `Write and publish this week's update in Hive HQ.\n\n${appUrl()}/clients/${c.slug}?tab=dashboard`, dueDate: fridayFive })) out.tasks++;
    if (red.has(c.id)) {
      const step = await nextStepFor(c.id, needs, now);
      if (await ensureTask(c.id, { kind: "account_review", dedupeKey: `review:${c.id}:${weekKey}`, title: `Account review: ${c.name}`, description: `${c.name} is at risk on the portfolio.\n\n**Suggested next step:** ${step || "Review the client page."}\n\n${appUrl()}/clients/${c.slug}` })) out.tasks++;
    }
  }
  return out;
}
