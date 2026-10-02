import { prisma } from "./prisma";
import { sydneyDay } from "./sheet-parse";
import { getCachedCampaignInsights, getCachedMetaCampaignList, getMetaCampaignInsights, getMetaCampaignList } from "./meta-ads";

// What counts in a client's reports: only leads, sales and spend on/after
// Client.startDate (their onboarding date), and only spend from "our"
// campaigns. A campaign is ours by default when it started on/after the start
// date; a coach can override either way (AdCampaign.includedInReporting).
// No start date = everything counts (and the UI asks the coach to set one).
//
// Every report that touches spend goes through scopedSpend/dailySpend below,
// and every lead query clamps its range with clampRange.

export type Range = { from?: Date; to?: Date }; // `to` exclusive

export type ScopeCampaign = {
  id: string; // Meta campaign id, or AdCampaign id for manually tracked ones
  name: string;
  status: string;
  startedAt: string | null;
  defaultIncluded: boolean;
  override: boolean | null;
  included: boolean;
};

export type ReportingScope = {
  clientId: string;
  startDate: Date | null;
  source: "meta" | "manual"; // where `campaigns` came from
  includedCampaignIds: string[];
  campaigns: ScopeCampaign[]; // Meta's list when connected, else the manual rows
  manual: ScopeCampaign[]; // manual rows — the spend fallback if a Meta call fails
  manualSpend: Map<string, number>; // AdCampaign id → all-time spend
  metaError: string | null;
};

type Opts = { cached?: boolean }; // false outside Next (scripts) — unstable_cache needs Next

function entry(id: string, name: string, status: string, startedAt: Date | string | null, override: boolean | null, startDate: Date | null): ScopeCampaign {
  const started = startedAt ? new Date(startedAt) : null;
  // Compared as Sydney days; an unknown start date counts as ours.
  const defaultIncluded = !startDate || !started || sydneyDay(started) >= sydneyDay(startDate);
  return { id, name, status, startedAt: started?.toISOString() ?? null, defaultIncluded, override, included: override ?? defaultIncluded };
}

export async function getReportingScope(clientId: string, { cached = true }: Opts = {}): Promise<ReportingScope> {
  const [client, rows] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { startDate: true, metaAdAccountId: true, metaAccessToken: true } }),
    prisma.adCampaign.findMany({ where: { clientId } }),
  ]);
  const startDate = client?.startDate ?? null;

  const manualRows = rows.filter((r) => !r.metaCampaignId);
  const manual = manualRows.map((r) => entry(r.id, r.name, r.status, r.createdAt, r.includedInReporting, startDate));
  const manualSpend = new Map(manualRows.map((r) => [r.id, Number(r.spend)]));

  let campaigns: ScopeCampaign[] | null = null;
  let metaError: string | null = null;
  if (client?.metaAdAccountId && client.metaAccessToken) {
    try {
      const list = await (cached ? getCachedMetaCampaignList : getMetaCampaignList)(client.metaAdAccountId, client.metaAccessToken);
      const overrides = new Map(rows.filter((r) => r.metaCampaignId).map((r) => [r.metaCampaignId!, r.includedInReporting]));
      campaigns = list.map((c) => entry(c.id, c.name, c.status, c.startedAt, overrides.get(c.id) ?? null, startDate));
    } catch (e) {
      metaError = e instanceof Error ? e.message : "Meta API request failed";
    }
  }

  const list = campaigns ?? manual;
  return {
    clientId,
    startDate,
    source: campaigns ? "meta" : "manual",
    includedCampaignIds: list.filter((c) => c.included).map((c) => c.id),
    campaigns: list,
    manual,
    manualSpend,
    metaError,
  };
}

// A report range narrowed to the reporting scope: nothing before startDate.
// An open-ended start ("Since start") becomes startDate → `to`.
export function clampRange(range: Range, startDate: Date | null): Range {
  if (!startDate) return range;
  return { ...range, from: range.from && range.from > startDate ? range.from : startDate };
}

const isEmpty = (r: Range) => !!(r.from && r.to && r.from >= r.to);

async function metaCreds(clientId: string) {
  const c = await prisma.client.findUnique({ where: { id: clientId }, select: { metaAdAccountId: true, metaAccessToken: true } });
  return c?.metaAdAccountId && c.metaAccessToken ? { account: c.metaAdAccountId, token: c.metaAccessToken } : null;
}

export type ScopedSpend = {
  // meta = live per-campaign Meta spend for the range; daily = AdSpendDaily
  // rows (dated, but not per campaign); manual = AdCampaign totals, which have
  // no dates, so they're all-time whatever the range.
  source: "meta" | "daily" | "manual" | null;
  total: number | null;
  byName: Map<string, number> | null; // lower-cased campaign name → spend
};

// Included spend for a range (clamped to the start date). `strict` throws on
// a Meta failure instead of falling back — the month-end freeze must not
// store a fallback number over a transient Meta error.
export async function scopedSpend(scope: ReportingScope, range: Range, { cached = true, strict = false }: Opts & { strict?: boolean } = {}): Promise<ScopedSpend> {
  const r = clampRange(range, scope.startDate);
  if (scope.metaError && strict) throw new Error(scope.metaError);

  if (scope.source === "meta") {
    if (isEmpty(r)) return { source: "meta", total: 0, byName: new Map() };
    const creds = await metaCreds(scope.clientId);
    try {
      if (!creds) throw new Error("Meta disconnected");
      const rows = await (cached ? getCachedCampaignInsights : getMetaCampaignInsights)(creds.account, creds.token, r);
      const included = new Set(scope.includedCampaignIds);
      const byName = new Map<string, number>();
      let total = 0;
      for (const row of rows) {
        if (!included.has(row.campaignId)) continue;
        const k = row.campaignName.toLowerCase().trim();
        byName.set(k, (byName.get(k) ?? 0) + row.spend);
        total += row.spend;
      }
      return { source: "meta", total, byName };
    } catch (e) {
      if (strict) throw e; // expired token etc. — fall back like before
    }
  }

  const daily = await prisma.adSpendDaily.aggregate({
    _sum: { spend: true },
    _count: true,
    where: { clientId: scope.clientId, date: { ...(r.from ? { gte: r.from } : {}), ...(r.to ? { lt: r.to } : {}) } },
  });
  if (daily._count) return { source: "daily", total: Number(daily._sum.spend ?? 0), byName: null };

  const manual = scope.manual.filter((c) => c.included);
  if (!scope.manual.length) return { source: null, total: null, byName: null };
  const byName = new Map<string, number>();
  for (const c of manual) byName.set(c.name.toLowerCase().trim(), (byName.get(c.name.toLowerCase().trim()) ?? 0) + (scope.manualSpend.get(c.id) ?? 0));
  return { source: "manual", total: Array.from(byName.values()).reduce((a, b) => a + b, 0), byName };
}

// Included spend per Sydney day ("2026-09-29" → $), for running totals like
// cost per sale. Meta's daily breakdown when connected, else AdSpendDaily,
// else each included manual campaign's total spread evenly from its start
// (or the client's start date) to today.
export async function dailySpend(scope: ReportingScope, range: Range, { cached = true }: Opts = {}): Promise<{ source: ScopedSpend["source"]; days: Map<string, number> }> {
  const r = clampRange(range, scope.startDate);
  const days = new Map<string, number>();
  const add = (day: string, v: number) => days.set(day, (days.get(day) ?? 0) + v);
  if (isEmpty(r)) return { source: null, days };

  if (scope.source === "meta") {
    const creds = await metaCreds(scope.clientId);
    if (creds) {
      try {
        const rows = await (cached ? getCachedCampaignInsights : getMetaCampaignInsights)(creds.account, creds.token, r, true);
        const included = new Set(scope.includedCampaignIds);
        for (const row of rows) if (included.has(row.campaignId) && row.date) add(row.date, row.spend);
        return { source: "meta", days };
      } catch {
        // fall through to the stored sources
      }
    }
  }

  const rows = await prisma.adSpendDaily.findMany({
    where: { clientId: scope.clientId, date: { ...(r.from ? { gte: r.from } : {}), ...(r.to ? { lt: r.to } : {}) } },
    select: { date: true, spend: true },
  });
  if (rows.length) {
    for (const row of rows) add(sydneyDay(row.date), Number(row.spend));
    return { source: "daily", days };
  }

  // ponytail: manual campaigns have one all-time total, so it's prorated
  // evenly by day; add per-day spend rows if these clients need exact numbers.
  const today = sydneyDay(r.to ?? new Date());
  for (const c of scope.manual.filter((m) => m.included)) {
    const spend = scope.manualSpend.get(c.id) ?? 0;
    if (!spend) continue;
    const start = sydneyDay(scope.startDate ?? (c.startedAt ? new Date(c.startedAt) : new Date()));
    const list = dayList(start, today);
    for (const d of list) add(d, spend / list.length);
  }
  return { source: scope.manual.length ? "manual" : null, days };
}

// Inclusive list of "YYYY-MM-DD" days.
export function dayList(from: string, to: string): string[] {
  const out: string[] = [];
  const [y, m, d] = from.split("-").map(Number);
  for (let t = Date.UTC(y, m - 1, d); ; t += 86_400_000) {
    const k = new Date(t).toISOString().slice(0, 10);
    if (k > to) break;
    out.push(k);
  }
  return out.length ? out : [to];
}

// Exported for the self-check (lib/reporting-scope.check.ts).
export const _test = { entry };
