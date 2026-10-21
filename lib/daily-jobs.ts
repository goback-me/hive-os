import { prisma } from "./prisma";
import { sydneyDay, sydneyHour, sydneyLocalToDate } from "./sheet-parse";
import { getRangeKpis } from "./kpi";
import { getPortfolio } from "./portfolio";
import { getNeedsAction } from "./needs-action";
import { getClientFunnel } from "./lead-sync";
import { biggestDrop } from "./funnel";
import { resolveReportRange } from "./date-range";
import { adminChannel, parseSlackEvents, queueSlack, slackConfigured } from "./slack";
import { ensureTask } from "./clickup";
import { weekStart } from "./weekly";
import { terms } from "./client-terms";

// Run by the cron every day from 8am Sydney. Mondays: each client's weekly
// Slack digest (last week's numbers) and the main channel's weekly summary.
// Every day: the weekly ClickUp tasks (made once a week each). Every item
// has a dedupe key for its week, so the 5-minute cron sends each once.
// What's on is ticked per client (Slack) and in Settings (lib/automations.ts).

const DIGEST_HOUR = 8;
const appUrl = () => process.env.NEXTAUTH_URL || "";
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
  return [top?.description, drop ? `${drop.step} is the weakest step (${Math.round(drop.rate)}%, owner: ${drop.owner === "client" ? "client" : "our team"}) — ${drop.advice}` : null].filter(Boolean).join(". ");
}

export async function runDailyJobs(now = new Date()) {
  if (sydneyHour(now) < DIGEST_HOUR) return { skipped: "before 8am Sydney" };
  const today = sydneyDay(now);
  const week = weekStart(now);
  const weekKey = sydneyDay(week);
  const lastWeekKey = addDaysKey(weekKey, -7);
  const lastWeek = { from: startOfDay(lastWeekKey), to: startOfDay(weekKey) };
  const fmtDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
  const weekLabel = `${fmtDay(lastWeekKey)} – ${fmtDay(addDaysKey(weekKey, -1))}`;
  const out = { clientDigests: 0, adminDigest: false, tasks: 0 };
  const clients = await prisma.client.findMany({
    where: { archivedAt: null, status: { not: "CHURNED" } },
    select: { id: true, name: true, slug: true, slackChannelId: true, slackEvents: true, clientType: true, clickupListId: true },
    orderBy: { name: "asc" },
  });
  const kpiCache = new Map<string, Awaited<ReturnType<typeof getRangeKpis>>>();
  const weekKpis = async (id: string) => kpiCache.get(id) ?? kpiCache.set(id, await getRangeKpis(id, lastWeek, now)).get(id)!;
  const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;

  // ── Mondays: client digests — last week's numbers + what needs doing ──
  if (today === weekKey && (await slackConfigured())) {
    for (const c of clients) {
      if (!c.slackChannelId || !parseSlackEvents(c.slackEvents).weeklyDigest) continue;
      const key = `client_weekly:${c.id}:${weekKey}`;
      if (await prisma.slackPostLog.findUnique({ where: { dedupeKey: key } })) continue;
      const [k, awaiting, danger, step] = await Promise.all([
        weekKpis(c.id),
        prisma.lead.count({ where: { clientId: c.id, deletedAt: null, awaitingClientUpdate: true } }),
        prisma.dataAlert.findMany({ where: { clientId: c.id, status: "OPEN", severity: "DANGER" }, select: { title: true, fixHint: true } }),
        prisma.contactLog.findFirst({ where: { clientId: c.id, nextStep: { not: null } }, orderBy: { contactedAt: "desc" }, select: { nextStep: true, nextStepDue: true } }),
      ]);
      // Plain sentences — this goes to the client's own channel.
      const t = terms(c.clientType);
      const quiet = !k.leads && !k.liveTransfers && !k.quotes && !k.sales;
      const lines = [
        `:calendar: *Here's how last week (${weekLabel}) went for ${c.name}:*`,
        ...(quiet
          ? ["• A quiet week — no new leads, transfers, quotes or wins."]
          : [
              `• ${n(k.leads, "new lead", "new leads")}`,
              `• ${n(k.liveTransfers, "live transfer", "live transfers")}`,
              `• ${n(k.quotes, t.quote.toLowerCase(), t.quotes.toLowerCase())} sent`,
              `• ${n(k.sales, t.sale.toLowerCase(), t.sales.toLowerCase())}${k.revenue ? ` worth $${Math.round(k.revenue).toLocaleString("en-US")}` : ""}`,
            ]),
        awaiting ? `:hourglass_flowing_sand: ${n(awaiting, "lead is", "leads are")} waiting for your update — let us know what happened with ${awaiting === 1 ? "it" : "them"}.` : null,
        ...danger.map((a) => `:warning: ${a.title}. ${a.fixHint}`),
        step?.nextStep ? `:point_right: Next step: ${step.nextStep}${step.nextStepDue ? ` (by ${step.nextStepDue.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short" })})` : ""}` : null,
        `<${appUrl()}/clients/${c.slug}|Open Hive HQ>`,
      ].filter(Boolean);
      if (await queueSlack({ clientId: c.id, channel: c.slackChannelId, kind: "client_digest", dedupeKey: key, text: lines.join("\n") })) out.clientDigests++;
    }

    // ── Mondays: main channel — every client's week, then who needs attention ──
    const mainChannel = await adminChannel();
    const adminKey = `admin_weekly:${weekKey}`;
    if (mainChannel && !(await prisma.slackPostLog.findUnique({ where: { dedupeKey: adminKey } }))) {
      const [{ rows }, needs] = await Promise.all([getPortfolio({ preset: "this_month" }, now), getNeedsAction()]);
      const numbers: string[] = [];
      for (const c of clients) {
        const k = await weekKpis(c.id);
        const t = terms(c.clientType);
        const stats = !k.leads && !k.liveTransfers && !k.quotes && !k.sales
          ? "quiet week"
          : [n(k.leads, "lead", "leads"), n(k.liveTransfers, "transfer", "transfers"), n(k.quotes, t.quote.toLowerCase(), t.quotes.toLowerCase()), `${n(k.sales, t.sale.toLowerCase(), t.sales.toLowerCase())}${k.revenue ? ` ($${Math.round(k.revenue).toLocaleString("en-US")})` : ""}`].join(" · ");
        numbers.push(`• *<${appUrl()}/clients/${c.slug}|${c.name}>* — ${stats}`);
      }
      const overdue = new Set(needs.filter((x) => x.type === "client_updates_overdue").map((x) => x.clientId));
      const flagged = rows.filter((r) => r.health !== "green" || r.dangerAlerts > 0 || overdue.has(r.clientId));
      const attention: string[] = [];
      for (const r of flagged) {
        const issues = [
          r.dangerAlerts ? `${r.dangerAlerts} serious data problem${r.dangerAlerts === 1 ? "" : "s"}` : null,
          overdue.has(r.clientId) ? "client updates overdue" : null,
          r.needsAction ? `${r.needsAction} to action` : null,
        ].filter(Boolean);
        const step = await nextStepFor(r.clientId, needs, now);
        attention.push(`${r.health === "red" ? ":red_circle:" : ":large_orange_circle:"} *<${appUrl()}/clients/${r.slug}|${r.name}>* — ${issues.join(", ") || "needs attention"}${step ? `\n      → ${step}` : ""}`);
      }
      const text = [
        `:bar_chart: *Last week (${weekLabel})*`,
        ...numbers,
        "",
        attention.length ? `:clipboard: *${attention.length} client${attention.length === 1 ? "" : "s"} need attention*` : ":white_check_mark: All clients on track.",
        ...attention,
      ].join("\n");
      out.adminDigest = await queueSlack({ channel: mainChannel, kind: "admin_digest", dedupeKey: adminKey, text });
    }
  }

  // ── Weekly ClickUp tasks ──
  const friday = startOfDay(addDaysKey(weekKey, 4));
  const fridayFive = new Date(friday.getTime() + 17 * 3_600_000);
  const needs = await getNeedsAction();
  const red = new Set((await getPortfolio({ preset: "this_month" }, now)).rows.filter((r) => r.health === "red").map((r) => r.clientId));
  for (const c of clients.filter((x) => x.clickupListId)) {
    if (await ensureTask(c.id, { kind: "weekly_update", dedupeKey: `weekly:${c.id}:${weekKey}`, title: "Write and publish this week's update (due Friday 5pm)", why: "Every client gets a weekly update from us — this is this week's. Publishing it also posts it to their Slack channel.", description: `Write and publish this week's update in Hive HQ.\n\n${appUrl()}/clients/${c.slug}?tab=dashboard`, dueDate: fridayFive })) out.tasks++;
    if (red.has(c.id)) {
      const step = await nextStepFor(c.id, needs, now);
      if (await ensureTask(c.id, { kind: "account_review", dedupeKey: `review:${c.id}:${weekKey}`, title: "Account review — client at risk", why: "The client is red on the portfolio (serious data problems or overdue actions). Review the account this week.", description: `${c.name} is at risk on the portfolio.\n\n**Suggested next step:** ${step || "Review the client page."}\n\n${appUrl()}/clients/${c.slug}` })) out.tasks++;
    }
  }
  return out;
}
