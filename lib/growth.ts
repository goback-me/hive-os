import { prisma } from "./prisma";
import { addMonths, getKpiHistory, getMonthToDateVsLast, monthKeyOf, monthLabel, type KpiValues, type MonthKey } from "./kpi";
import { clampRange, getReportingScope, type Range } from "./reporting-scope";
import { terms, type ClientTypeValue } from "./client-terms";
import type { ReportVisibility } from "./report-visibility";

// Growth tab: month-by-month results since the client's start date (max 12
// months), from MonthlyKpi + the live current month (lib/kpi.ts). The maths
// below is pure so lib/growth.check.ts can pin it down.

export const COUNT_METRICS = ["leads", "liveTransfers", "quotes", "sales", "revenue"] as const;
export const RATE_METRICS = ["contactRate", "liveToQuote", "closeRate", "costPerQuote", "costPerSale"] as const;
export type Metric = (typeof COUNT_METRICS)[number] | (typeof RATE_METRICS)[number];
export const LOWER_IS_BETTER: Metric[] = ["costPerQuote", "costPerSale"];
const COSTS: Metric[] = ["costPerQuote", "costPerSale"];

export type MetricValues = Record<Metric, number | null>;
export type GrowthMonth = { month: MonthKey; label: string; partial: boolean; values: MetricValues };

const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);

export function toMetrics(v: KpiValues, costHidden: boolean): MetricValues {
  return {
    leads: v.leads,
    liveTransfers: v.liveTransfers,
    quotes: v.quotes,
    sales: v.sales,
    revenue: v.revenue,
    contactRate: pct(v.contacted, v.leads),
    liveToQuote: pct(v.quotes, v.liveTransfers),
    closeRate: pct(v.sales, v.quotes),
    costPerQuote: costHidden ? null : v.costPerQuote,
    costPerSale: costHidden ? null : v.costPerSale,
  };
}

// Mean of this month and up to two before it (what's there).
export function rolling3(values: (number | null)[]): (number | null)[] {
  return values.map((_, i) => {
    const w = values.slice(Math.max(0, i - 2), i + 1).filter((v): v is number => v != null);
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null;
  });
}

// % change vs the previous value; null when there's nothing to compare with.
export function momChange(cur: number | null, prev: number | null): number | null {
  return cur == null || prev == null || prev === 0 ? null : ((cur - prev) / prev) * 100;
}

const better = (a: number, b: number, lowerBetter: boolean) => (lowerBetter ? a < b : a > b);

// Index of the best closed month (a partial current month can't win), or -1
// when fewer than two months have a value worth comparing.
export function bestIndex(values: (number | null)[], partial: boolean[], lowerBetter: boolean): number {
  let best = -1;
  let n = 0;
  values.forEach((v, i) => {
    if (v == null || partial[i] || (!lowerBetter && v <= 0)) return;
    n++;
    if (best === -1 || better(v, values[best]!, lowerBetter)) best = i;
  });
  return n >= 2 ? best : -1;
}

// Consecutive closed months, ending with the latest, each better than the one
// before. 3 → "3 months improving".
export function improvingStreak(values: (number | null)[], partial: boolean[], lowerBetter: boolean): number {
  const closed = values.filter((_, i) => !partial[i]);
  let streak = 0;
  for (let i = closed.length - 1; i > 0; i--) {
    const [cur, prev] = [closed[i], closed[i - 1]];
    if (cur == null || prev == null || !better(cur, prev, lowerBetter)) break;
    streak++;
  }
  return streak;
}

// "Quotes up 25% vs the same days last month, cost per sale down 12%" — the
// biggest movers (5%+), from the numbers alone. Tiny bases are skipped so
// 1 sale → 0 doesn't read "down 100%": a count needs 3+ last time, and
// revenue / cost need a value on both sides.
const MIN_COUNT_BASE = 3;
export function summaryLine(current: MetricValues, previous: MetricValues, labels: Record<Metric, string>): string {
  const meaningful = (m: Metric) => {
    const [c, p] = [current[m], previous[m]];
    if (c == null || p == null) return false;
    return m === "revenue" || COSTS.includes(m) ? c > 0 && p > 0 : p >= MIN_COUNT_BASE;
  };
  const movers = (["leads", "liveTransfers", "quotes", "sales", "revenue", "costPerSale"] as Metric[])
    .filter(meaningful)
    .map((m) => ({ m, change: momChange(current[m], previous[m]) }))
    .filter((x): x is { m: Metric; change: number } => x.change != null && Math.abs(x.change) >= 5)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 3);
  const hasPrevious = (["leads", "quotes", "sales"] as Metric[]).some((m) => (previous[m] ?? 0) > 0);
  if (!movers.length) return hasPrevious ? "Holding steady vs the same days last month." : "Not enough history yet — trends show once there's a month to compare.";
  const parts = movers.map(({ m, change }, i) => `${i === 0 ? labels[m] : labels[m].toLowerCase()} ${change > 0 ? "up" : "down"} ${Math.round(Math.abs(change))}%`);
  return `${parts[0]} vs the same days last month${parts.length > 1 ? `, ${parts.slice(1).join(", ")}` : ""}.`;
}

export function metricLabels(clientType: ClientTypeValue | null | undefined): Record<Metric, string> {
  const t = terms(clientType);
  return {
    leads: "Leads",
    liveTransfers: "Live transfers",
    quotes: t.quotes,
    sales: t.sales,
    revenue: "Revenue",
    contactRate: "Contact rate",
    liveToQuote: `Live transfer → ${t.quote.toLowerCase()}`,
    closeRate: `${t.quote} → ${t.sale.toLowerCase()} (close rate)`,
    costPerQuote: `Cost per ${t.quote.toLowerCase()}`,
    costPerSale: `Cost per ${t.sale.toLowerCase()}`,
  };
}

export type GrowthResponse = {
  labels: Record<Metric, string>;
  summary: string;
  months: GrowthMonth[]; // oldest first
  headline: Record<(typeof COUNT_METRICS)[number], { thisMonth: number; pace: number | null; lastMonth: number | null; avg3: number | null }>;
  best: Partial<Record<Metric, MonthKey>>;
  streaks: Partial<Record<Metric, number>>;
  costHidden: boolean;
  clientSeesCost: boolean;
};

export async function getGrowth(clientId: string, range: Range, viewer: { role: "COACH" | "CLIENT" }, visibility: ReportVisibility, now = new Date()): Promise<GrowthResponse> {
  const costHidden = viewer.role === "CLIENT" && !visibility.showCostMetrics;
  const [scope, client, firstLead] = await Promise.all([
    getReportingScope(clientId),
    prisma.client.findUnique({ where: { id: clientId }, select: { clientType: true } }),
    prisma.lead.findFirst({ where: { clientId, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  const current = monthKeyOf(now);
  const r = clampRange(range, scope.startDate);
  const floor = monthKeyOf(scope.startDate ?? firstLead?.createdAt ?? now);
  const last = r.to ? monthKeyOf(new Date(Math.min(r.to.getTime() - 1, now.getTime()))) : current;
  let first = r.from ? monthKeyOf(r.from) : floor;
  if (first < floor) first = floor;
  if (first < addMonths(last, -11)) first = addMonths(last, -11); // max 12 months
  const n = last < first ? 1 : (Number(last.slice(0, 4)) - Number(first.slice(0, 4))) * 12 + Number(last.slice(5)) - Number(first.slice(5)) + 1;

  const [history, recent, mtd] = await Promise.all([
    getKpiHistory(clientId, last, n, now),
    getKpiHistory(clientId, current, 4, now), // this month + the 3 before, for the headline
    getMonthToDateVsLast(clientId, now),
  ]);

  const months: GrowthMonth[] = history.map((h) => ({ month: h.month, label: monthLabel(h.month), partial: h.month === current, values: toMetrics(h.values, costHidden) }));
  const partial = months.map((m) => m.partial);
  const best: GrowthResponse["best"] = {};
  const streaks: GrowthResponse["streaks"] = {};
  for (const m of [...COUNT_METRICS, ...RATE_METRICS] as Metric[]) {
    if (costHidden && COSTS.includes(m)) continue;
    const vals = months.map((x) => x.values[m]);
    const b = bestIndex(vals, partial, LOWER_IS_BETTER.includes(m));
    if (b !== -1) best[m] = months[b].month;
    const s = improvingStreak(vals, partial, LOWER_IS_BETTER.includes(m));
    if (s >= 2) streaks[m] = s;
  }

  const closed = recent.filter((h) => h.month !== current);
  const headline = Object.fromEntries(
    COUNT_METRICS.map((m) => {
      const thisMonth = recent[recent.length - 1].values[m];
      const lastMonth = closed.length ? closed[closed.length - 1].values[m] : null;
      const avg3 = closed.length ? closed.reduce((s, h) => s + h.values[m], 0) / closed.length : null;
      const pace = mtd.today < mtd.daysInMonth && thisMonth ? Math.round((thisMonth / mtd.today) * mtd.daysInMonth) : null;
      return [m, { thisMonth, pace, lastMonth, avg3 }];
    })
  ) as GrowthResponse["headline"];

  const labels = metricLabels(client?.clientType);
  return {
    labels,
    summary: summaryLine(toMetrics(mtd.current, costHidden), toMetrics(mtd.previous, costHidden), labels),
    months,
    headline,
    best,
    streaks,
    costHidden,
    clientSeesCost: visibility.showCostMetrics,
  };
}
