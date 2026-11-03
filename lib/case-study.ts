import { prisma } from "./prisma";
import { getAdsReport } from "./campaign-report";
import { getReportingScope } from "./reporting-scope";
import { getReportVisibility } from "./client-stats";
import { addMonths, monthKeyOf, monthLabel } from "./kpi";
import { sydneyLocalToDate } from "./sheet-parse";

// Case-study export (Ads tab → "Download case study data"): one row per month
// from the client's start date, plus an all-time total. Every number is the
// Ads tab's own (getAdsReport) — included campaigns only, leads by opt-in
// date, sales and revenue by won date — so the file matches what HQ shows.
// Spend is Meta's (live, or the saved history after a disconnect); impressions
// and clicks come from the saved history (lib/meta-archive.ts) only.

const MAX_MONTHS = 60;

type Row = {
  period: string;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  leads: number;
  costPerLead: number | null;
  liveTransfers: number;
  bookings: number;
  quotes: number;
  sales: number;
  revenue: number;
  costPerSale: number | null;
  roas: number | null;
};

const monthStart = (k: string) => sydneyLocalToDate(Number(k.slice(0, 4)), Number(k.slice(5, 7)), 1)!;

export async function getCaseStudyRows(clientId: string, now = new Date()): Promise<Row[]> {
  const scope = await getReportingScope(clientId);
  const [firstLead, firstSaved] = await Promise.all([
    prisma.lead.findFirst({ where: { clientId, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.metaAdInsight.findFirst({ where: { clientId }, orderBy: { date: "asc" }, select: { date: true } }),
  ]);
  const savedStart = firstSaved ? new Date(`${firstSaved.date}T12:00:00Z`) : null;
  const begin = scope.startDate ?? [firstLead?.createdAt, savedStart].filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? now;

  const last = monthKeyOf(now);
  let first = monthKeyOf(begin);
  if (addMonths(first, MAX_MONTHS - 1) < last) first = addMonths(last, -(MAX_MONTHS - 1));
  const months: string[] = [];
  for (let k = first; k <= last; k = addMonths(k, 1)) months.push(k);

  // Impressions/clicks per month for the included campaigns, from the saved history.
  const included = scope.includedCampaignIds;
  const reach = await prisma.$queryRaw<{ month: string; impressions: bigint; clicks: bigint }[]>`
    SELECT substr(date, 1, 7) AS month, SUM(impressions)::bigint AS impressions, SUM(clicks)::bigint AS clicks
    FROM "MetaAdInsight"
    WHERE "clientId" = ${clientId} AND "campaignId" = ANY(${included}) AND date >= ${`${first}-01`}
    GROUP BY 1
  `;
  const reachByMonth = new Map(reach.map((r) => [r.month, { impressions: Number(r.impressions), clicks: Number(r.clicks) }]));
  const hasReach = !!firstSaved;

  const visibility = await getReportVisibility(clientId);
  const coach = { role: "COACH" as const };
  const toRow = (period: string, r: Awaited<ReturnType<typeof getAdsReport>>, reachRow: { impressions: number; clicks: number } | null): Row => ({
    period,
    spend: r.totals.spend,
    impressions: hasReach ? reachRow?.impressions ?? 0 : null,
    clicks: hasReach ? reachRow?.clicks ?? 0 : null,
    leads: r.totals.leads,
    costPerLead: r.totals.costPerLead,
    liveTransfers: r.totals.liveTransfers,
    bookings: r.totals.bookings,
    quotes: r.totals.quotes,
    sales: r.totals.sales,
    revenue: r.totals.revenue,
    costPerSale: r.totals.costPerSale,
    roas: r.totals.spend ? r.totals.revenue / r.totals.spend : null,
  });

  const rows: Row[] = [];
  // One month at a time — keeps Meta's rate limit (live spend) out of trouble.
  for (const k of months) {
    const report = await getAdsReport(clientId, { from: monthStart(k), to: monthStart(addMonths(k, 1)) }, coach, visibility, now);
    rows.push(toRow(monthLabel(k), report, reachByMonth.get(k) ?? null));
  }
  const total = await getAdsReport(clientId, { from: monthStart(first) }, coach, visibility, now);
  const totalReach = Array.from(reachByMonth.values()).reduce((s, r) => ({ impressions: s.impressions + r.impressions, clicks: s.clicks + r.clicks }), { impressions: 0, clicks: 0 });
  rows.push(toRow("All time", total, totalReach));
  return rows;
}

const HEADERS: [keyof Row, string][] = [
  ["period", "Month"],
  ["spend", "Ad spend"],
  ["impressions", "Impressions"],
  ["clicks", "Clicks"],
  ["leads", "Leads"],
  ["costPerLead", "Cost per lead"],
  ["liveTransfers", "Live transfers"],
  ["bookings", "Bookings"],
  ["quotes", "Quotes"],
  ["sales", "Sales"],
  ["revenue", "Revenue"],
  ["costPerSale", "Cost per sale"],
  ["roas", "Return on ad spend"],
];

const MONEY = new Set<keyof Row>(["spend", "costPerLead", "revenue", "costPerSale"]);

export function caseStudyCsv(rows: Row[]): string {
  const cell = (k: keyof Row, v: Row[keyof Row]) => {
    if (v == null) return "";
    if (typeof v === "string") return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    if (k === "roas") return v.toFixed(2);
    return MONEY.has(k) ? v.toFixed(2) : String(v);
  };
  return [HEADERS.map(([, h]) => h).join(","), ...rows.map((r) => HEADERS.map(([k]) => cell(k, r[k])).join(","))].join("\n") + "\n";
}
