import { prisma } from "./prisma";
import { sydneyDay } from "./sheet-parse";
import { getCachedCampaignInsights, getCachedMetaCampaignList, getMetaCampaignInsights, getMetaCampaignList, metaDays, type MetaCampaignInfo } from "./meta-ads";

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
  // Meta campaigns from the saved history (lib/meta-archive.ts) — Meta is
  // disconnected, or its live list failed. Spend then comes from there too.
  archived: boolean;
  includedCampaignIds: string[];
  campaigns: ScopeCampaign[]; // Meta's list when connected, else the saved Meta list, else the manual rows
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

  const overrides = new Map(rows.filter((r) => r.metaCampaignId).map((r) => [r.metaCampaignId!, r.includedInReporting]));
  const toEntries = (list: MetaCampaignInfo[]) => list.map((c) => entry(c.id, c.name, c.status, c.startedAt, overrides.get(c.id) ?? null, startDate));
  let campaigns: ScopeCampaign[] | null = null;
  let archived = false;
  let metaError: string | null = null;
  if (client?.metaAdAccountId && client.metaAccessToken) {
    try {
      campaigns = toEntries(await (cached ? getCachedMetaCampaignList : getMetaCampaignList)(client.metaAdAccountId, client.metaAccessToken));
    } catch (e) {
      metaError = e instanceof Error ? e.message : "Meta API request failed";
    }
  }
  // Not connected (or Meta failing) but its history was saved: report from
  // that, so past spend and cost-per figures survive a disconnect.
  if (!campaigns) {
    const saved = await archivedCampaignList(clientId);
    if (saved.length) {
      campaigns = toEntries(saved);
      archived = true;
    }
  }

  const list = campaigns ?? manual;
  return {
    clientId,
    startDate,
    source: campaigns ? "meta" : "manual",
    archived,
    includedCampaignIds: list.filter((c) => c.included).map((c) => c.id),
    campaigns: list,
    manual,
    manualSpend,
    metaError,
  };
}

// A report range narrowed to the reporting scope: nothing before startDate.
// An open-ended start ("Maximum") becomes startDate → `to`.
export function clampRange(range: Range, startDate: Date | null): Range {
  if (!startDate) return range;
  return { ...range, from: range.from && range.from > startDate ? range.from : startDate };
}

const isEmpty = (r: Range) => !!(r.from && r.to && r.from >= r.to);

// ── The saved Meta history (lib/meta-archive.ts) ────────────────────────
// Every campaign seen across the client's archived ad accounts: the saved
// campaign list, plus any campaign that only appears in the insight rows
// (archived before the list was saved) — its first day with activity stands
// in for its start.
async function archivedCampaignList(clientId: string): Promise<MetaCampaignInfo[]> {
  const [listed, seen] = await Promise.all([
    prisma.metaArchivedCampaign.findMany({ where: { clientId }, select: { campaignId: true, name: true, status: true, startedAt: true } }),
    prisma.$queryRaw<{ campaignId: string; name: string; first: string }[]>`
      SELECT "campaignId", (array_agg("campaignName" ORDER BY date DESC))[1] AS name, MIN(date) AS first
      FROM "MetaAdInsight" WHERE "clientId" = ${clientId} GROUP BY "campaignId"
    `,
  ]);
  const out = new Map<string, MetaCampaignInfo>(listed.map((c) => [c.campaignId, { id: c.campaignId, name: c.name, status: c.status, startedAt: c.startedAt }]));
  for (const s of seen) if (!out.has(s.campaignId)) out.set(s.campaignId, { id: s.campaignId, name: s.name, status: "UNKNOWN", startedAt: s.first });
  return Array.from(out.values());
}

// Saved spend for a range, per campaign — the same Sydney-day bounds as a
// live Meta call (metaDays). null = nothing was ever archived for the client.
export async function archivedCampaignSpend(clientId: string, range: Range) {
  const any = await prisma.metaAdInsight.findFirst({ where: { clientId }, select: { id: true } });
  if (!any) return null;
  const { since, until } = metaDays(range);
  const rows = await prisma.metaAdInsight.groupBy({
    by: ["campaignId", "campaignName"],
    where: { clientId, date: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } },
    _sum: { spend: true },
  });
  return rows.map((r) => ({ campaignId: r.campaignId, campaignName: r.campaignName, spend: Number(r._sum.spend ?? 0) }));
}

// Last day the saved history covers — shown next to archived figures.
export async function archivedThrough(clientId: string): Promise<string | null> {
  return (await prisma.metaAdInsight.aggregate({ where: { clientId }, _max: { date: true } }))._max.date ?? null;
}

// Included campaigns' spend → {total, by lower-cased campaign name}.
function sumIncluded(scope: ReportingScope, rows: { campaignId: string; campaignName: string; spend: number }[]): ScopedSpend {
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
}

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
    if (!scope.archived) {
      const creds = await metaCreds(scope.clientId);
      try {
        if (!creds) throw new Error("Meta disconnected");
        return sumIncluded(scope, await (cached ? getCachedCampaignInsights : getMetaCampaignInsights)(creds.account, creds.token, r));
      } catch (e) {
        if (strict) throw e; // expired token etc. — fall back like before
      }
    }
    // Disconnected, or the live call failed: the saved Meta history.
    const saved = await archivedCampaignSpend(scope.clientId, r);
    if (saved) return sumIncluded(scope, saved);
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
    const included = new Set(scope.includedCampaignIds);
    const creds = scope.archived ? null : await metaCreds(scope.clientId);
    if (creds) {
      try {
        const rows = await (cached ? getCachedCampaignInsights : getMetaCampaignInsights)(creds.account, creds.token, r, true);
        for (const row of rows) if (included.has(row.campaignId) && row.date) add(row.date, row.spend);
        return { source: "meta", days };
      } catch {
        // fall through to the saved history, then the stored sources
      }
    }
    if (await prisma.metaAdInsight.findFirst({ where: { clientId: scope.clientId }, select: { id: true } })) {
      const { since, until } = metaDays(r);
      const saved = await prisma.metaAdInsight.findMany({
        where: { clientId: scope.clientId, date: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } },
        select: { campaignId: true, date: true, spend: true },
      });
      for (const row of saved) if (included.has(row.campaignId)) add(row.date, Number(row.spend));
      return { source: "meta", days };
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
