import { decryptToken } from "@/lib/crypto";

export type MetaInsights = {
  spend: number;
  revenue: number | null; // from purchase action_values, if the client tracks purchase conversions
  impressions: number;
  clicks: number;
  cpm: number;
  ctr: number;
  conversions: number;
  costPerConversion: number | null;
};

const CONVERSION_TYPES = ["lead", "purchase", "complete_registration", "offsite_conversion.fb_pixel_lead"];
const REVENUE_TYPES = ["purchase", "offsite_conversion.fb_pixel_purchase"];

// Shared by the client detail page (server-side, for the top metric cards)
// and the Meta Ads card's own API route — one source of truth for the shape.
export async function getMetaInsights(adAccountId: string, encryptedAccessToken: string): Promise<MetaInsights> {
  const accessToken = decryptToken(encryptedAccessToken);
  const fields = "spend,impressions,clicks,cpm,ctr,actions,action_values,cost_per_action_type";
  const url =
    `https://graph.facebook.com/v21.0/${adAccountId}/insights` +
    `?fields=${fields}&date_preset=last_30d&access_token=${encodeURIComponent(accessToken)}`;

  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? "Meta API request failed");

  const row = data.data?.[0];
  if (!row) {
    return { spend: 0, revenue: null, impressions: 0, clicks: 0, cpm: 0, ctr: 0, conversions: 0, costPerConversion: null };
  }

  const conversions = (row.actions ?? [])
    .filter((a: any) => CONVERSION_TYPES.some((t) => a.action_type.includes(t)))
    .reduce((sum: number, a: any) => sum + Number(a.value), 0);

  const revenueEntries = (row.action_values ?? []).filter((a: any) => REVENUE_TYPES.some((t) => a.action_type.includes(t)));
  const revenue = revenueEntries.length ? revenueEntries.reduce((sum: number, a: any) => sum + Number(a.value), 0) : null;

  const costPerConversionEntry = (row.cost_per_action_type ?? []).find((a: any) =>
    CONVERSION_TYPES.some((t) => a.action_type.includes(t))
  );

  return {
    spend: Number(row.spend ?? 0),
    revenue,
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    cpm: Number(row.cpm ?? 0),
    ctr: Number(row.ctr ?? 0),
    conversions,
    costPerConversion: costPerConversionEntry ? Number(costPerConversionEntry.value) : null,
  };
}