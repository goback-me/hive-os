// What a CLIENT login may see in their own reports (Client.reportVisibility).
// Coaches always see everything — these flags only strip data from what the
// server sends a CLIENT, and drive the coach's "hidden from client" badges.

export type ReportVisibility = {
  showProfit: boolean;
  showCostMetrics: boolean;
  showDqBreakdown: boolean;
  showFunnel: boolean;
};

export const DEFAULT_VISIBILITY: ReportVisibility = {
  showProfit: false,
  showCostMetrics: true,
  showDqBreakdown: true,
  showFunnel: true,
};

export const VISIBILITY_LABELS: Record<keyof ReportVisibility, { label: string; hint: string }> = {
  showProfit: { label: "Profit / ROI", hint: "Revenue minus ad spend, and return on spend" },
  showCostMetrics: { label: "Cost metrics", hint: "Ad spend, cost per booking/quote/lead" },
  showDqBreakdown: { label: "DQ & lost breakdown", hint: "Disqualified and lost counts by phase and reason" },
  showFunnel: { label: "Funnel", hint: "Stage-by-stage funnel, timings and per-campaign table" },
};

export const VISIBILITY_KEYS = Object.keys(DEFAULT_VISIBILITY) as (keyof ReportVisibility)[];

// Stored JSON → full flag set. Anything missing or not a boolean = default.
export function parseVisibility(raw: unknown): ReportVisibility {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_VISIBILITY };
  for (const k of VISIBILITY_KEYS) if (typeof obj[k] === "boolean") out[k] = obj[k] as boolean;
  return out;
}

// The client page's tabs, in order — what Client.hiddenTabs can switch off
// for the client's own login (also drops the matching sidebar link).
export const CLIENT_TABS = [
  { key: "onboarding", label: "Onboarding" },
  { key: "dashboard", label: "Dashboard" },
  { key: "weekly", label: "Weekly status" },
  { key: "leads", label: "Leads" },
  { key: "growth", label: "Growth" },
  { key: "playbooks", label: "Playbooks" },
  { key: "ads", label: "Ads" },
  { key: "awards", label: "Awards" },
  { key: "referrals", label: "Referrals" },
] as const;
