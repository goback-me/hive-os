import { unstable_cache } from "next/cache";
import { decryptToken } from "@/lib/crypto";
import { sydneyDay } from "@/lib/sheet-parse";

export type MetaCampaignSpend = {
  campaignId: string;
  campaignName: string;
  date?: string; // Sydney day, only when fetched with `daily`
  spend: number;
  impressions: number;
  clicks: number;
};

// Every page of a Graph API list — Meta pages at 25 rows by default, which
// silently dropped campaigns (and daily rows) past the first page.
async function metaGetAll(url: string): Promise<any[]> {
  const out: any[] = [];
  for (let next: string | undefined = url; next; ) {
    const res: Response = await fetch(next, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data?.error?.message ?? "Meta API request failed");
    out.push(...(data.data ?? []));
    next = data.paging?.next;
  }
  return out;
}

// An app range ({from, to exclusive}) → Meta's inclusive day bounds, as
// Sydney calendar days (the ad accounts run on Sydney time).
export function metaDays(range?: { from?: Date; to?: Date }) {
  return {
    since: range?.from ? sydneyDay(range.from) : undefined,
    until: range?.to ? sydneyDay(new Date(range.to.getTime() - 1)) : undefined,
  };
}

// Meta only serves ~37 months of insights.
const META_HISTORY_DAYS = 37 * 30;

// Per-campaign spend for an inclusive Sydney day window (`since`/`until`
// both omitted = the account's full history). `daily` breaks it down by day.
async function fetchCampaignInsights(adAccountId: string, encryptedAccessToken: string, since?: string, until?: string, daily = false): Promise<MetaCampaignSpend[]> {
  const accessToken = decryptToken(encryptedAccessToken);
  const fields = "campaign_id,campaign_name,spend,impressions,clicks";
  const dateParam =
    since || until || daily
      ? `time_range=${encodeURIComponent(
          JSON.stringify({ since: since ?? sydneyDay(new Date(Date.now() - META_HISTORY_DAYS * 86_400_000)), until: until ?? sydneyDay(new Date()) })
        )}`
      : "date_preset=maximum";
  const rows = await metaGetAll(
    `https://graph.facebook.com/v21.0/${adAccountId}/insights` +
      `?level=campaign&fields=${fields}&${dateParam}${daily ? "&time_increment=1" : ""}&limit=500&access_token=${encodeURIComponent(accessToken)}`
  );
  return rows.map((row: any) => ({
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    ...(daily ? { date: row.date_start } : {}),
    spend: Number(row.spend ?? 0),
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
  }));
}

// Same account, broken down per campaign (level=campaign), for the same
// {from, to} range the caller counted its leads over — `date_preset=maximum`
// (full account history) when the range is empty.
export function getMetaCampaignInsights(adAccountId: string, encryptedAccessToken: string, dateRange?: { from?: Date; to?: Date }, daily = false) {
  const { since, until } = metaDays(dateRange);
  return fetchCampaignInsights(adAccountId, encryptedAccessToken, since, until, daily);
}

export type MetaCampaignInfo = { id: string; name: string; status: string; startedAt: string | null };

// Every campaign that's ever existed in the account (active, paused or
// archived), with when it started — the reporting scope's default rule
// compares that to the client's start date.
export async function getMetaCampaignList(adAccountId: string, encryptedAccessToken: string): Promise<MetaCampaignInfo[]> {
  const accessToken = decryptToken(encryptedAccessToken);
  const rows = await metaGetAll(
    `https://graph.facebook.com/v21.0/${adAccountId}/campaigns?fields=id,name,effective_status,start_time,created_time&limit=500&access_token=${encodeURIComponent(accessToken)}`
  );
  return rows.map((c: any) => ({ id: c.id, name: c.name, status: c.effective_status ?? "UNKNOWN", startedAt: c.start_time ?? c.created_time ?? null }));
}

export type MetaCampaign = MetaCampaignInfo & { spend: number; impressions: number; clicks: number };

// The campaign list joined with spend for a range (all-time when omitted).
// Insights only cover campaigns with some activity; a brand new campaign with
// nothing spent yet just shows $0 rather than being dropped.
export async function getMetaAllCampaigns(adAccountId: string, encryptedAccessToken: string, dateRange?: { from?: Date; to?: Date }): Promise<MetaCampaign[]> {
  const [list, insights] = await Promise.all([
    getCachedMetaCampaignList(adAccountId, encryptedAccessToken),
    getCachedCampaignInsights(adAccountId, encryptedAccessToken, dateRange),
  ]);
  const byId = new Map(insights.map((i) => [i.campaignId, i]));
  return list.map((c) => ({ ...c, spend: byId.get(c.id)?.spend ?? 0, impressions: byId.get(c.id)?.impressions ?? 0, clicks: byId.get(c.id)?.clicks ?? 0 }));
}

// Meta calls are slow and only have day granularity — cached for 5 min,
// keyed by day, so flipping between date ranges doesn't wait on Meta again.
// unstable_cache only works inside Next — scripts (the KPI backfill) call the
// uncached versions.
const cachedInsights = unstable_cache(fetchCampaignInsights, ["meta-campaign-insights-v2"], { revalidate: 300 });
export const getCachedMetaCampaignList = unstable_cache(getMetaCampaignList, ["meta-campaign-list"], { revalidate: 300 });

export function getCachedCampaignInsights(adAccountId: string, encryptedAccessToken: string, dateRange?: { from?: Date; to?: Date }, daily = false) {
  const { since, until } = metaDays(dateRange);
  return cachedInsights(adAccountId, encryptedAccessToken, since, until, daily);
}

// Whether a client's Meta token still works and when it runs out — Meta's
// debug_token. expiresAt null = never expires (or unknown). Cached an hour.
async function fetchMetaTokenInfo(encryptedAccessToken: string): Promise<{ valid: boolean; expiresAt: string | null; error: string | null }> {
  const token = decryptToken(encryptedAccessToken);
  const res = await fetch(`https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) return { valid: false, expiresAt: null, error: data?.error?.message ?? `Meta returned ${res.status}` };
  const d = data.data ?? {};
  return { valid: !!d.is_valid, expiresAt: d.expires_at ? new Date(d.expires_at * 1000).toISOString() : null, error: d.error?.message ?? null };
}
export const getMetaTokenInfo = unstable_cache(fetchMetaTokenInfo, ["meta-token-info"], { revalidate: 3600 });
