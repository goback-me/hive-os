import { prisma } from "./prisma";
import { milestoneSql, wonAtSql } from "./milestones";
import { getMetaAllCampaigns } from "./meta-ads";
import { clampRange, getReportingScope, type Range, type ScopeCampaign } from "./reporting-scope";
import type { ReportVisibility } from "./report-visibility";

// Ads tab: per-campaign results for a period. Every lead, live transfer,
// booking, quote and sale is credited to the campaign that generated the
// lead, and counted when it happened (lib/milestones.ts) — so "Since start"
// gives lifetime campaign totals and a month gives that month's activity.
// Revenue = won job values, dated by the won date. Only included campaigns
// get a row (lib/reporting-scope.ts); leads from campaigns that aren't in the
// ad account (or have none) get their own rows, "Unattributed" for blanks;
// leads from excluded campaigns are left out, like those campaigns' spend.

export type CampaignRow = {
  name: string;
  status: string | null; // "Active" / "Paused" from Meta; null for a non-ad source
  spend: number | null;
  leads: number;
  liveTransfers: number;
  bookings: number;
  quotes: number;
  sales: number;
  revenue: number;
  costPerLead: number | null;
  costPerLiveTransfer: number | null;
  costPerQuote: number | null;
  costPerSale: number | null;
};

export type AdsReport = {
  source: "meta" | "manual";
  spendAllTime: boolean; // manual campaigns: their spend has no dates
  startDate: string | null;
  cards: { spend: number | null; leads: number; costPerLead: number | null; quotes: number; sales: number };
  rows: CampaignRow[];
  totals: CampaignRow;
  campaigns: (ScopeCampaign & { spend: number })[] | null; // coach only — every campaign, for the include/exclude ticks
  costHidden: boolean; // CLIENT without cost metrics — spend/cost left out
  clientSeesCost: boolean;
};

type Activity = { campaign: string; leads: bigint; live: bigint; booked: bigint; quotes: bigint; sales: bigint; revenue: unknown };

const UNATTRIBUTED = "Unattributed";
const key = (name: string) => name.toLowerCase().trim();
const per = (spend: number | null, n: number) => (spend != null && n > 0 ? spend / n : null);
const statusLabel = (s: string) => (s === "ACTIVE" ? "Active" : /PAUSED/.test(s) ? "Paused" : s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " "));

function row(name: string, status: string | null, spend: number | null, a?: Omit<CampaignRow, "name" | "status" | "spend" | "costPerLead" | "costPerLiveTransfer" | "costPerQuote" | "costPerSale">): CampaignRow {
  const c = a ?? { leads: 0, liveTransfers: 0, bookings: 0, quotes: 0, sales: 0, revenue: 0 };
  return {
    name,
    status,
    spend,
    ...c,
    costPerLead: per(spend, c.leads),
    costPerLiveTransfer: per(spend, c.liveTransfers),
    costPerQuote: per(spend, c.quotes),
    costPerSale: per(spend, c.sales),
  };
}

export async function getAdsReport(clientId: string, requested: Range, viewer: { role: "COACH" | "CLIENT" }, visibility: ReportVisibility, now = new Date()): Promise<AdsReport> {
  const scope = await getReportingScope(clientId);
  const range = clampRange(requested, scope.startDate);
  const since = scope.startDate ?? new Date(0);
  const from = range.from ?? since;
  const to = range.to ?? now;
  const empty = from >= to; // the period ends before the start date

  const [activity, client] = await Promise.all([
    prisma.$queryRaw<Activity[]>`
      WITH l AS (
        -- Blank, "-" and an unfilled ad template ("{{campaign.name}}") are all "no campaign".
        SELECT id, "createdAt", stage, value,
          CASE WHEN TRIM(COALESCE(campaign, '')) IN ('', '-') OR campaign LIKE '{{%' THEN ${UNATTRIBUTED} ELSE TRIM(campaign) END AS campaign
        FROM "Lead" WHERE "clientId" = ${clientId} AND "deletedAt" IS NULL AND "createdAt" >= ${since}
      ), m AS (
        SELECT l.campaign, l."createdAt" AS opt_in, l.value,
          ${milestoneSql("HANDOVER_LIVE")} AS live,
          ${milestoneSql("CONSULT_BOOKED")} AS booked,
          ${milestoneSql("QUOTE_SENT")} AS quote,
          CASE WHEN l.stage = 'WON' THEN ${wonAtSql()} END AS won
        FROM l
      )
      SELECT campaign,
        COUNT(*) FILTER (WHERE opt_in >= ${from} AND opt_in < ${to}) AS leads,
        COUNT(*) FILTER (WHERE live >= ${from} AND live < ${to}) AS live,
        COUNT(*) FILTER (WHERE booked >= ${from} AND booked < ${to}) AS booked,
        COUNT(*) FILTER (WHERE quote >= ${from} AND quote < ${to}) AS quotes,
        COUNT(*) FILTER (WHERE won >= ${from} AND won < ${to}) AS sales,
        COALESCE(SUM(value) FILTER (WHERE won >= ${from} AND won < ${to}), 0) AS revenue
      FROM m GROUP BY campaign
    `,
    prisma.client.findUnique({ where: { id: clientId }, select: { metaAdAccountId: true, metaAccessToken: true } }),
  ]);

  // Spend per campaign for the period — Meta's live numbers, else the manual
  // rows (all-time, no dates).
  let source: AdsReport["source"] = "manual";
  let campaigns: (ScopeCampaign & { spend: number })[] = scope.manual.map((c) => ({ ...c, spend: scope.manualSpend.get(c.id) ?? 0 }));
  if (scope.source === "meta" && client?.metaAdAccountId && client.metaAccessToken) {
    const meta = await getMetaAllCampaigns(client.metaAdAccountId, client.metaAccessToken, empty ? undefined : range).catch(() => null);
    if (meta) {
      source = "meta";
      const spend = new Map(meta.map((c) => [c.id, empty ? 0 : c.spend]));
      campaigns = scope.campaigns.map((c) => ({ ...c, spend: spend.get(c.id) ?? 0 }));
    }
  }

  const byName = new Map(
    activity.map((a) => [
      key(a.campaign),
      {
        leads: Number(a.leads),
        liveTransfers: Number(a.live),
        bookings: Number(a.booked),
        quotes: Number(a.quotes),
        sales: Number(a.sales),
        revenue: Number(a.revenue ?? 0),
      },
    ])
  );
  const known = new Set(campaigns.map((c) => key(c.name)));

  const rows: CampaignRow[] = [];
  for (const c of campaigns.filter((x) => x.included)) {
    const a = byName.get(key(c.name));
    if (!c.spend && !a) continue; // nothing in this period
    rows.push(row(c.name, source === "meta" ? statusLabel(c.status) : null, c.spend, a));
  }
  // Lead sources with no campaign in the ad account (incl. blanks).
  for (const a of activity) {
    if (known.has(key(a.campaign))) continue;
    rows.push(row(a.campaign, null, null, byName.get(key(a.campaign))));
  }
  rows.sort((x, y) => Number(x.name === UNATTRIBUTED) - Number(y.name === UNATTRIBUTED) || (y.spend ?? -1) - (x.spend ?? -1) || y.leads - x.leads);

  const sum = (k: keyof Pick<CampaignRow, "leads" | "liveTransfers" | "bookings" | "quotes" | "sales" | "revenue">) => rows.reduce((s, r) => s + r[k], 0);
  const spendRows = rows.filter((r) => r.spend != null);
  const totalSpend = spendRows.length || campaigns.some((c) => c.included) ? spendRows.reduce((s, r) => s + (r.spend ?? 0), 0) : null;
  const totals = row("All campaigns", null, totalSpend, {
    leads: sum("leads"),
    liveTransfers: sum("liveTransfers"),
    bookings: sum("bookings"),
    quotes: sum("quotes"),
    sales: sum("sales"),
    revenue: sum("revenue"),
  });

  const isCoach = viewer.role === "COACH";
  const costHidden = !isCoach && !visibility.showCostMetrics;
  const strip = (r: CampaignRow): CampaignRow =>
    costHidden ? { ...r, spend: null, costPerLead: null, costPerLiveTransfer: null, costPerQuote: null, costPerSale: null } : r;

  return {
    source,
    spendAllTime: source === "manual",
    startDate: scope.startDate?.toISOString() ?? null,
    cards: {
      spend: costHidden ? null : totals.spend,
      leads: totals.leads,
      costPerLead: costHidden ? null : totals.costPerLead,
      quotes: totals.quotes,
      sales: totals.sales,
    },
    rows: rows.map(strip),
    totals: strip(totals),
    campaigns: isCoach ? campaigns : null,
    costHidden,
    clientSeesCost: visibility.showCostMetrics,
  };
}
