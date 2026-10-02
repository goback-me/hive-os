import { prisma } from "./prisma";
import { clampRange, getReportingScope, scopedSpend } from "./reporting-scope";
import { getRevenueEntries, revenueBetween } from "./revenue";
import { parseVisibility, type ReportVisibility } from "./report-visibility";

export type ClientStats = {
  revenue: number;
  spend: number;
  // "meta" = live Meta spend for this exact range, "daily" = dated daily-spend
  // rows. "manual" = the manually tracked campaigns, which have no dates, so
  // they're always all-time.
  spendSource: "meta" | "daily" | "manual";
  spendAllTime: boolean;
  profit: number;
  lifetimeRevenue: number;
};

// What actually goes to the browser. A CLIENT never receives profit/ROI
// unless showProfit is on, nor spend unless showCostMetrics is on — the data
// is left out, not just hidden in the UI. Coaches get everything.
export type ViewerStats = Omit<ClientStats, "spend" | "profit"> & {
  spend: number | null;
  profit: number | null;
  roi: number | null; // profit / spend, e.g. 1.5 = 150%
  visibility: ReportVisibility;
};

export function statsForViewer(s: ClientStats, role: "COACH" | "CLIENT", visibility: ReportVisibility): ViewerStats {
  const client = role === "CLIENT";
  const showProfit = !client || visibility.showProfit;
  return {
    ...s,
    spend: client && !visibility.showCostMetrics ? null : s.spend,
    profit: showProfit ? s.profit : null,
    roi: showProfit && s.spend > 0 ? s.profit / s.spend : null,
    visibility,
  };
}

export async function getReportVisibility(clientId: string): Promise<ReportVisibility> {
  const c = await prisma.client.findUnique({ where: { id: clientId }, select: { reportVisibility: true } });
  return parseVisibility(c?.reportVisibility);
}

// The client Dashboard cards for one date range — used for the first server
// render and by /api/clients/stats when the range changes, so both agree.
// Scoped to the client's reporting start date and included campaigns
// (lib/reporting-scope.ts): "Maximum" = start date → today.
export async function getClientStats(clientId: string, requested: { from?: Date; to?: Date }, allTime: boolean): Promise<ClientStats> {
  const scope = await getReportingScope(clientId);
  const range = clampRange(requested, scope.startDate);
  const [entries, scoped] = await Promise.all([
    getRevenueEntries([clientId]),
    scopedSpend(scope, range),
  ]);

  const spend = scoped.total ?? 0;
  const spendSource = scoped.source ?? "manual";
  const revenue = revenueBetween(entries, range);
  return {
    revenue,
    spend,
    spendSource,
    spendAllTime: spendSource === "manual" && !allTime,
    profit: revenue - spend,
    lifetimeRevenue: revenueBetween(entries, clampRange({}, scope.startDate)),
  };
}
