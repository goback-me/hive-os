import { prisma } from "./prisma";
import { getRangeKpis, type KpiValues } from "./kpi";
import { getNeedsAction } from "./needs-action";
import { previousReportRange, resolveReportRange, type ReportRange } from "./date-range";

// Agency portfolio (/dashboard): one row per active client for the selected
// period vs the one before it, with a health dot, open data alerts, Needs
// Action count and the last account-manager contact. At-risk first.

export type PortfolioMetric = "leads" | "liveTransfers" | "quotes" | "sales" | "revenue" | "costPerQuote" | "costPerSale";
type Values = Record<PortfolioMetric, number | null>;

export type PortfolioRow = {
  clientId: string;
  name: string;
  slug: string;
  values: Values;
  previous: Values | null; // null = nothing before to compare ("Since start")
  health: "green" | "amber" | "red";
  openAlerts: number;
  dangerAlerts: number;
  needsAction: number;
  lastContact: string | null; // ContactLog — a held weekly call adds one too
  lastMeeting: { at: string; mood: "GOOD" | "NEUTRAL" | "AT_RISK" | null } | null; // latest HELD weekly call
};

const pick = (v: KpiValues): Values => ({
  leads: v.leads,
  liveTransfers: v.liveTransfers,
  quotes: v.quotes,
  sales: v.sales,
  revenue: v.revenue,
  costPerQuote: v.costPerQuote,
  costPerSale: v.costPerSale,
});

const HEALTH_ORDER = { red: 0, amber: 1, green: 2 } as const;

export async function getPortfolio(report: ReportRange, now = new Date()): Promise<{ rows: PortfolioRow[]; previousLabel: string | null }> {
  const range = resolveReportRange(report, now);
  const prev = previousReportRange(report, now);
  const clients = await prisma.client.findMany({ where: { archivedAt: null, status: { not: "CHURNED" } }, select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } });
  const ids = clients.map((c) => c.id);
  const [alerts, contacts, needs, meetings] = await Promise.all([
    prisma.dataAlert.groupBy({ by: ["clientId", "severity"], where: { clientId: { in: ids }, status: "OPEN" }, _count: true }),
    prisma.contactLog.groupBy({ by: ["clientId"], where: { clientId: { in: ids } }, _max: { contactedAt: true } }),
    getNeedsAction(),
    prisma.weeklyMeeting.findMany({ where: { clientId: { in: ids }, status: "HELD" }, orderBy: { weekOf: "desc" }, distinct: ["clientId"], select: { clientId: true, weekOf: true, clientMood: true } }),
  ]);

  const rows = await Promise.all(
    clients.map(async (c): Promise<PortfolioRow> => {
      const [cur, before] = await Promise.all([getRangeKpis(c.id, range, now), prev ? getRangeKpis(c.id, prev, now) : Promise.resolve(null)]);
      const open = alerts.filter((a) => a.clientId === c.id);
      const dangerAlerts = open.filter((a) => a.severity === "DANGER").reduce((s, a) => s + a._count, 0);
      const openAlerts = open.reduce((s, a) => s + a._count, 0);
      const mine = needs.filter((n) => n.clientId === c.id);
      const health = dangerAlerts || mine.some((n) => n.severity === "danger") ? "red" : openAlerts || mine.some((n) => n.severity === "muted") ? "amber" : "green";
      const last = contacts.find((x) => x.clientId === c.id)?._max.contactedAt ?? null;
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
        lastContact: last ? new Date(last).toISOString() : null,
        lastMeeting: ((m) => (m ? { at: m.weekOf.toISOString(), mood: m.clientMood } : null))(meetings.find((x) => x.clientId === c.id)),
      };
    })
  );
  rows.sort((a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] || b.needsAction - a.needsAction || a.name.localeCompare(b.name));
  return { rows, previousLabel: prev?.label ?? null };
}
