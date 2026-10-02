import { prisma } from "./prisma";
import { sydneyDay } from "./sheet-parse";
import { wonAtSql } from "./milestones";
import { metaDays } from "./meta-ads";
import { addMonths, monthKeyOf, toneFor, type Tone } from "./kpi";
import { dailySpend, getReportingScope, type Range } from "./reporting-scope";
import type { ReportVisibility } from "./report-visibility";

// Sales section (Leads tab): a sale = a Won lead, dated by its won date
// (wonAtSql — same rule as the revenue-closed card). Only leads that came
// in on/after the client's reporting start date count (lib/reporting-scope.ts).
//
// Cost of sale (per row) = included spend from the start date up to the won
// day ÷ sales from the start date up to and including that sale — the running
// cost per sale at the moment it closed.

export type SaleRow = {
  id: string;
  wonAt: string;
  name: string | null;
  campaign: string | null;
  value: number | null;
  daysToWon: number | null;
  costOfSale: number | null;
};

type Period = { count: number; revenue: number };

export type SalesResponse = {
  summary: {
    thisMonth: Period;
    lastMonth: Period;
    lastMonthToDate: Period; // same days of last month — what "this month" is compared against
    lifetime: Period;
    tone: { count: Tone | null; revenue: Tone | null };
    compareLabel: string;
    costPerSale: number | null; // selected range
    lastSale: { wonAt: string; name: string | null } | null;
  };
  sales: SaleRow[]; // selected range, newest first
  spendSource: "meta" | "daily" | "manual" | null;
  costHidden: boolean; // CLIENT without showCostMetrics — costs left out
  clientSeesCost: boolean; // for the coach's "hidden from client" badge
};

const DAY = 86_400_000;

export async function getSales(
  clientId: string,
  range: Range,
  viewer: { role: "COACH" | "CLIENT" },
  visibility: ReportVisibility,
  now = new Date()
): Promise<SalesResponse> {
  const scope = await getReportingScope(clientId);
  const since = scope.startDate ?? new Date(0);

  const rows = await prisma.$queryRaw<{ id: string; name: string | null; campaign: string | null; value: unknown; createdAt: Date; won_at: Date }[]>`
    SELECT l.id, l.name, l.campaign, l.value, l."createdAt", ${wonAtSql()} AS won_at
    FROM "Lead" l
    WHERE l."clientId" = ${clientId} AND l."deletedAt" IS NULL AND l.stage = 'WON' AND l."createdAt" >= ${since}
  `;
  const all = rows.filter((r) => r.won_at >= since).sort((a, b) => a.won_at.getTime() - b.won_at.getTime() || a.id.localeCompare(b.id));

  const costHidden = viewer.role === "CLIENT" && !visibility.showCostMetrics;

  // Running spend by day, from the start (or the first sale's lead) to today.
  const firstDay = scope.startDate ?? (all.length ? all.reduce((m, r) => (r.createdAt < m ? r.createdAt : m), all[0].createdAt) : now);
  const spend = costHidden || !all.length ? { source: null, days: new Map<string, number>() } : await dailySpend(scope, { from: firstDay, to: now });
  const spendDays = Array.from(spend.days.entries()).sort(([a], [b]) => a.localeCompare(b));
  const hasSpend = spend.source != null;
  const costs = runningCostPerSale(all.map((r) => sydneyDay(r.won_at)), spendDays);

  const inRange = (d: Date) => (!range.from || d >= range.from) && (!range.to || d < range.to);
  const sales: SaleRow[] = all.map((r, i) => {
    return {
      id: r.id,
      wonAt: r.won_at.toISOString(),
      name: r.name,
      campaign: r.campaign,
      value: r.value == null ? null : Number(r.value),
      daysToWon: r.won_at >= r.createdAt ? Math.round((r.won_at.getTime() - r.createdAt.getTime()) / DAY) : null,
      costOfSale: hasSpend ? costs[i] : null,
    };
  });

  // This month vs last month (Sydney), compared like the Snapshot cards:
  // month-to-date against the same days of last month.
  const thisKey = monthKeyOf(now);
  const lastKey = addMonths(thisKey, -1);
  const todayDom = Number(sydneyDay(now).slice(8, 10));
  const period = (pick: (s: SaleRow) => boolean): Period => {
    const list = sales.filter(pick);
    return { count: list.length, revenue: list.reduce((s, x) => s + (x.value ?? 0), 0) };
  };
  const monthOf = (s: SaleRow) => monthKeyOf(new Date(s.wonAt));
  const thisMonth = period((s) => monthOf(s) === thisKey);
  const lastMonth = period((s) => monthOf(s) === lastKey);
  const lastMonthToDate = period((s) => monthOf(s) === lastKey && Number(sydneyDay(new Date(s.wonAt)).slice(8, 10)) <= todayDom);

  const ranged = sales.filter((s) => inRange(new Date(s.wonAt)));
  const { since: rs, until: ru } = metaDays(range);
  const rangeSpend = spendDays.reduce((s, [d, v]) => ((!rs || d >= rs) && (!ru || d <= ru) ? s + v : s), 0);
  const last = sales[sales.length - 1];
  const lastMonthName = new Date(`${lastKey}-15T00:00:00Z`).toLocaleDateString("en-AU", { month: "short", timeZone: "UTC" });

  return {
    summary: {
      thisMonth,
      lastMonth,
      lastMonthToDate,
      lifetime: period(() => true),
      tone: { count: toneFor("count", thisMonth.count, lastMonthToDate.count), revenue: toneFor("count", thisMonth.revenue, lastMonthToDate.revenue) },
      compareLabel: `vs 1–${todayDom} ${lastMonthName}`,
      costPerSale: costHidden || !hasSpend || !ranged.length ? null : rangeSpend / ranged.length,
      lastSale: last ? { wonAt: last.wonAt, name: last.name } : null,
    },
    sales: ranged.reverse().map((s) => (costHidden ? { ...s, costOfSale: null } : s)),
    spendSource: costHidden ? null : spend.source,
    costHidden,
    clientSeesCost: visibility.showCostMetrics,
  };
}

// For sales in won order (Sydney days, ascending): spend on/before each sale's
// day ÷ the number of sales up to and including it.
export function runningCostPerSale(wonDays: string[], spendDays: [string, number][]): number[] {
  let j = 0;
  let spent = 0;
  return wonDays.map((day, i) => {
    for (; j < spendDays.length && spendDays[j][0] <= day; j++) spent += spendDays[j][1];
    return spent / (i + 1);
  });
}
