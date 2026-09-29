import { prisma } from "./prisma";
import { resolveDateRange, type DateRangePreset } from "./date-range";
import { getCachedCampaignInsights } from "./meta-ads";
import { getRevenueEntries, revenueBetween } from "./revenue";
import { parseVisibility, type ReportVisibility } from "./report-visibility";

export type ClientStats = {
  revenue: number;
  spend: number;
  // "meta" = live Meta spend for this exact range. "manual" = the manually
  // tracked campaigns, which have no dates, so they're always all-time.
  spendSource: "meta" | "manual";
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
export async function getClientStats(clientId: string, preset: DateRangePreset): Promise<ClientStats> {
  const range = resolveDateRange(preset);
  const [client, entries, campaigns] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { metaAdAccountId: true, metaAccessToken: true } }),
    getRevenueEntries([clientId]),
    prisma.adCampaign.findMany({ where: { clientId }, select: { spend: true } }),
  ]);

  let spend: number | null = null;
  if (client?.metaAdAccountId && client.metaAccessToken) {
    spend = await getCachedCampaignInsights(client.metaAdAccountId, client.metaAccessToken, range)
      .then((rows) => rows.reduce((s, r) => s + r.spend, 0))
      .catch(() => null); // expired token etc. → fall back to the manual numbers
  }
  const spendSource = spend == null ? "manual" : "meta";
  if (spend == null) spend = campaigns.reduce((s, c) => s + Number(c.spend), 0);

  const revenue = revenueBetween(entries, range);
  return {
    revenue,
    spend,
    spendSource,
    spendAllTime: spendSource === "manual" && preset !== "maximum",
    profit: revenue - spend,
    lifetimeRevenue: revenueBetween(entries, {}),
  };
}
