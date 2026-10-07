import { prisma } from "./prisma";
import { getRangeKpis, type KpiValues } from "./kpi";
import { getClientsHealth, kpisRed, type Health } from "./client-health";
import { getNeedsAction } from "./needs-action";
import { previousReportRange, resolveReportRange, type ReportRange } from "./date-range";

// Agency portfolio (/dashboard): one row per active client for the selected
// period vs the one before it, with a health dot, open data alerts, Needs
// Action count and the last account-manager contact. At-risk first.

export type PortfolioMetric = "leads" | "liveTransfers" | "quotesOrBookings" | "sales" | "revenue" | "costPerQuoteOrBooking" | "costPerSale";
type Values = Record<PortfolioMetric, number | null>;

export type PortfolioRow = {
  clientId: string;
  name: string;
  slug: string;
  values: Values;
  previous: Values | null; // null = nothing before to compare ("Maximum")
  health: "green" | "amber" | "red"; // data / needs-action health (the dot)
  amHealth: Health; // account health (lib/client-health.ts)
  openAlerts: number;
  dangerAlerts: number;
  needsAction: number;
  lastMeeting: { at: string; mood: "GOOD" | "NEUTRAL" | "AT_RISK" | null } | null; // "Last call": the latest call that happened (HELD)
};

// Quote / booking: any kind of booking (consult or quote), each lead once.
const pick = (v: KpiValues): Values => {
  const qb = v.quotesOrBookings ?? v.quotes;
  return {
    leads: v.leads,
    liveTransfers: v.liveTransfers,
    quotesOrBookings: qb,
    sales: v.sales,
    revenue: v.revenue,
    costPerQuoteOrBooking: v.spend != null && qb > 0 ? v.spend / qb : null,
    costPerSale: v.costPerSale,
  };
};

const HEALTH_ORDER = { red: 0, amber: 1, green: 2 } as const;

export async function getPortfolio(report: ReportRange, now = new Date()): Promise<{ rows: PortfolioRow[]; previousLabel: string | null }> {
  const range = resolveReportRange(report, now);
  const prev = previousReportRange(report, now);
  const clients = await prisma.client.findMany({ where: { archivedAt: null, status: { not: "CHURNED" } }, select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } });
  const ids = clients.map((c) => c.id);
  const [alerts, needs, meetings] = await Promise.all([
    prisma.dataAlert.groupBy({ by: ["clientId", "severity"], where: { clientId: { in: ids }, status: "OPEN" }, _count: true }),
    getNeedsAction(),
    prisma.amCall.findMany({ where: { clientId: { in: ids }, status: "HELD" }, orderBy: { scheduledAt: "desc" }, distinct: ["clientId"], select: { clientId: true, scheduledAt: true, outcome: true } }),
  ]);

  // Month to date vs the same days last month is exactly health's KPI sign,
  // so that range's numbers are reused for it.
  const redFor = new Map<string, boolean>();
  const rows = await Promise.all(
    clients.map(async (c): Promise<Omit<PortfolioRow, "amHealth">> => {
      const [cur, before] = await Promise.all([getRangeKpis(c.id, range, now), prev ? getRangeKpis(c.id, prev, now) : Promise.resolve(null)]);
      if (report.preset === "this_month" && before) redFor.set(c.id, kpisRed(cur, before));
      const open = alerts.filter((a) => a.clientId === c.id);
      const dangerAlerts = open.filter((a) => a.severity === "DANGER").reduce((s, a) => s + a._count, 0);
      const openAlerts = open.reduce((s, a) => s + a._count, 0);
      const mine = needs.filter((n) => n.clientId === c.id);
      const health = dangerAlerts || mine.some((n) => n.severity === "danger") ? "red" : openAlerts || mine.some((n) => n.severity === "muted") ? "amber" : "green";
      return {
        clientId: c.id,
        name: c.name,
        slug: c.slug,
        values: pick(cur),
        previous: before ? pick(before) : null,
        health,
        openAlerts,
        dangerAlerts,
        needsAction: mine.filter((n) => n.severity !== "success").length,
        lastMeeting: ((m) => (m ? { at: m.scheduledAt.toISOString(), mood: m.outcome } : null))(meetings.find((x) => x.clientId === c.id)),
      };
    })
  );
  const amHealth = await getClientsHealth(ids, { now, kpisRedFor: report.preset === "this_month" ? redFor : undefined });
  const withHealth: PortfolioRow[] = rows.map((r) => ({ ...r, amHealth: amHealth.get(r.clientId)! }));
  withHealth.sort((a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] || b.needsAction - a.needsAction || a.name.localeCompare(b.name));
  return { rows: withHealth, previousLabel: prev?.label ?? null };
}
