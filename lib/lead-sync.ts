import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken, getSheetValues } from "@/lib/google-sheets";
import { getMetaCampaignInsights } from "@/lib/meta-ads";
import type { LeadStatusValue } from "@/lib/lead-status";
import { LEAD_STATUSES, moreConclusive, stageTimestampPatch } from "@/lib/lead-status";

function normalizeHeader(h: string) {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Sheet headers are messy in practice (line breaks, trailing "?"/spaces) —
// match by keyword rather than exact string. Returns the first header whose
// normalized form contains ANY of the given keywords.
function findColumn(headers: string[], keywords: string[]): number {
  const normalized = headers.map(normalizeHeader);
  for (const kw of keywords) {
    const i = normalized.findIndex((h) => h.includes(kw));
    if (i !== -1) return i;
  }
  return -1;
}

function normalizeIdentity(v: string) {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function parseMoney(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n !== 0 ? n : null;
}

function parseDate(v: string | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type SyncSummary = { total: number; created: number; updated: number };

// Pulls the client's assigned sheet (read-only, always) and upserts each row
// into the Lead table. A lead whose status has been manually set in the app
// (statusManuallySetAt) never has its status overwritten by a later sync —
// every other field still refreshes normally.
export async function syncLeadsFromSheet(clientId: string): Promise<SyncSummary> {
  const sheet = await prisma.clientSheet.findUnique({ where: { clientId } });
  if (!sheet) throw new Error("No Google Sheet assigned to this client yet — connect one on the Leads page first.");

  const accessToken = await getValidAccessToken();
  const { headers, rows } = await getSheetValues(accessToken, sheet.spreadsheetId, sheet.sheetName);

  const statusMapping = (sheet.statusMapping as Record<string, LeadStatusValue> | null) ?? {};
  const statusColIdx = sheet.statusColumn ? headers.indexOf(sheet.statusColumn) : -1;
  const resultStatusMapping = (sheet.resultStatusMapping as Record<string, LeadStatusValue> | null) ?? {};
  const resultStatusColIdx = sheet.resultStatusColumn ? headers.indexOf(sheet.resultStatusColumn) : -1;

  const nameIdx = findColumn(headers, ["name"]);
  const phoneIdx = findColumn(headers, ["phone"]);
  const emailIdx = findColumn(headers, ["email"]);
  const sourceIdx = findColumn(headers, ["source"]);
  const campaignIdx = findColumn(headers, ["campaign"]);
  const adsetIdx = findColumn(headers, ["adset", "ad set"]);
  const revenueIdx = findColumn(headers, ["revenue generated", "revenue"]);
  const quoteIdx = findColumn(headers, ["quote value", "quote"]);
  const dateOptInIdx = findColumn(headers, ["date opt in", "opt in"]);

  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const name = nameIdx !== -1 ? row[nameIdx] : "";
    const phone = phoneIdx !== -1 ? row[phoneIdx] : "";
    const email = emailIdx !== -1 ? row[emailIdx] : "";
    // Every row needs SOME identity to match across syncs — skip fully blank rows.
    const identitySource = email || phone || name;
    if (!identitySource?.trim()) continue;
    const externalKey = normalizeIdentity(`${email}|${phone}|${name}`);

    const rawStatus = statusColIdx !== -1 ? row[statusColIdx] ?? "" : "";
    const baseMappedStatus: LeadStatusValue = LEAD_STATUSES.includes(statusMapping[rawStatus] as LeadStatusValue)
      ? (statusMapping[rawStatus] as LeadStatusValue)
      : "NEW_LEAD";

    // The result column (e.g. "Prospect Status": did it actually close?)
    // overrides the outreach column above whenever it resolves to something
    // more conclusive — a client typing "DISQUALIFIED" or "SOLD" here beats
    // whatever the team's internal outreach-stage column still says.
    const rawResultStatus = resultStatusColIdx !== -1 ? row[resultStatusColIdx] ?? "" : "";
    const resultMappedStatus = LEAD_STATUSES.includes(resultStatusMapping[rawResultStatus] as LeadStatusValue)
      ? (resultStatusMapping[rawResultStatus] as LeadStatusValue)
      : null;
    const mappedStatus = resultMappedStatus ? moreConclusive(baseMappedStatus, resultMappedStatus) : baseMappedStatus;

    // Revenue is only ever counted once the result column resolves the deal
    // to Won — a bare "quoted" value (not yet accepted) never counts, even
    // though the Quote Value cell already has a dollar figure in it.
    // Quote Value takes priority over Revenue Generated when both are set.
    const value =
      mappedStatus === "WON"
        ? parseMoney(quoteIdx !== -1 ? row[quoteIdx] : undefined) ?? parseMoney(revenueIdx !== -1 ? row[revenueIdx] : undefined)
        : null;

    // The real-world date this lead came in — NOT when our app happened to
    // sync it. Without this, a bulk first-time sync of months-old leads
    // would stamp every single one with today's date, silently corrupting
    // month-attribution, the activity timeline, and time-to-convert. Only
    // set when the sheet actually has a parseable value — never invent one.
    const dateOptIn = parseDate(dateOptInIdx !== -1 ? row[dateOptInIdx] : undefined);

    // Everything else — every header not otherwise mapped — goes into `raw`
    // for display only, keyed by its actual header text.
    const mappedIdx = new Set([nameIdx, phoneIdx, emailIdx, sourceIdx, campaignIdx, adsetIdx, revenueIdx, quoteIdx, statusColIdx, resultStatusColIdx, dateOptInIdx]);
    const raw: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (!mappedIdx.has(i) && h) raw[h] = row[i] ?? "";
    });

    const existing = await prisma.lead.findFirst({ where: { clientId, externalKey } });

    const baseData = {
      name: name || null,
      phone: phone || null,
      email: email || null,
      source: sourceIdx !== -1 ? row[sourceIdx] || null : null,
      campaign: campaignIdx !== -1 ? row[campaignIdx] || null : null,
      adset: adsetIdx !== -1 ? row[adsetIdx] || null : null,
      ...(dateOptIn ? { createdAt: dateOptIn } : {}),
      // Prefer the result column's value when present (it's the more
      // decisive signal — "SOLD" tells you more than "LIVE TRANSFER") —
      // otherwise fall back to the outreach column, whichever is filled in.
      sheetStatus: rawResultStatus.trim() || rawStatus.trim() || null,
      value,
      raw,
      lastSyncedAt: new Date(),
    };

    if (existing) {
      // Respect a manual override — only apply the sheet's status (and the
      // stage timestamps that come with it) if nobody has manually touched
      // this lead's status yet.
      const statusChanging = !existing.statusManuallySetAt && mappedStatus !== existing.status;
      const statusPatch = existing.statusManuallySetAt
        ? {}
        : { status: mappedStatus, ...stageTimestampPatch(existing, mappedStatus) };
      await prisma.lead.update({
        where: { id: existing.id },
        data: { ...baseData, ...statusPatch },
      });
      // A re-sync moving an existing lead to a new stage IS a real status
      // transition worth a history entry — only the very first status a
      // lead gets on creation (below) is routine ingestion, not a "change".
      if (statusChanging) {
        await prisma.leadActivity.create({
          data: {
            leadId: existing.id,
            fromStatus: existing.status,
            toStatus: mappedStatus,
            value,
            changedBy: "Sheet sync",
          },
        });
      }
      updated++;
    } else {
      const emptyStages = { chaseUpAt: null, contactedAt: null, closedAt: null };
      await prisma.lead.create({
        data: { clientId, externalKey, status: mappedStatus, ...stageTimestampPatch(emptyStages, mappedStatus), ...baseData },
      });
      created++;
    }
  }

  return { total: rows.length, created, updated };
}

export type CampaignFunnelRow = {
  campaign: string;
  total: number;
  contacted: number; // CLIENT_CONTACTED or later (WON/LOST/DISQUALIFIED all imply contact happened)
  won: number;
  lost: number;
  disqualified: number;
  lostOrDisqualified: number; // won + lost convenience total, kept for the existing "Lost/DQ" stat
  closedTotal: number; // won + lost + disqualified — the denominator for the rates below
  winRate: number | null; // % of CLOSED leads that were won (null when nothing's closed yet)
  lossRate: number | null;
  disqualifiedRate: number | null;
  avgDaysToConvert: number | null; // avg calendar days from createdAt to closedAt, WON leads only
  spend: number | null;
  spendSource: "meta" | "manual" | null;
};

function campaignKey(campaign: string | null) {
  return campaign?.trim() || "Unattributed";
}

// Average days from lead creation to WON, grouped by campaign — a separate
// raw-SQL aggregate (like getClientLeadTimeSeries's bucketCounts below)
// since Prisma's groupBy can't average a computed date difference.
async function getCampaignAvgDaysToConvert(
  clientId: string,
  dateRange?: { from?: Date; to?: Date }
): Promise<Map<string, number>> {
  const fromClause = dateRange?.from ? Prisma.sql`AND "createdAt" >= ${dateRange.from}` : Prisma.empty;
  const toClause = dateRange?.to ? Prisma.sql`AND "createdAt" < ${dateRange.to}` : Prisma.empty;

  const rows = await prisma.$queryRaw<{ campaign: string; avg_days: number | null }[]>`
    SELECT COALESCE(NULLIF(TRIM(campaign), ''), 'Unattributed') AS campaign,
           AVG(EXTRACT(EPOCH FROM ("closedAt" - "createdAt")) / 86400) AS avg_days
    FROM "Lead"
    WHERE "clientId" = ${clientId} AND status = 'WON' AND "closedAt" IS NOT NULL
      ${fromClause}
      ${toClause}
    GROUP BY 1
  `;
  return new Map(rows.filter((r) => r.avg_days != null).map((r) => [r.campaign, Number(r.avg_days)]));
}

// Groups this client's synced leads by campaign and joins in spend — Meta's
// live per-campaign breakdown if connected, else the matching AdCampaign row
// already in our DB (matched by name), so the funnel still shows a cost
// figure even without a Meta connection.
//
// Uses groupBy (one small aggregate query, a few rows back) instead of
// findMany (which was pulling every lead — including its `raw` JSON blob —
// into Node just to count them; at 1000+ leads that's what was slowing the
// page down and shipping a huge payload to the browser for zero reason,
// since only the aggregated counts below ever reach the client).
export async function getClientCampaignFunnel(
  clientId: string,
  dateRange?: { from?: Date; to?: Date }
): Promise<CampaignFunnelRow[]> {
  const createdAt =
    dateRange?.from || dateRange?.to
      ? { ...(dateRange.from ? { gte: dateRange.from } : {}), ...(dateRange.to ? { lt: dateRange.to } : {}) }
      : undefined;

  const [grouped, client, adCampaigns, avgDaysByCampaign] = await Promise.all([
    prisma.lead.groupBy({ by: ["campaign", "status"], where: { clientId, ...(createdAt ? { createdAt } : {}) }, _count: true }),
    prisma.client.findUnique({ where: { id: clientId } }),
    prisma.adCampaign.findMany({ where: { clientId } }),
    getCampaignAvgDaysToConvert(clientId, dateRange),
  ]);

  let metaSpendByName: Map<string, number> | null = null;
  if (client?.metaAdAccountId && client.metaAccessToken) {
    try {
      const rows = await getMetaCampaignInsights(client.metaAdAccountId, client.metaAccessToken, dateRange);
      metaSpendByName = new Map(rows.map((r) => [r.campaignName.toLowerCase().trim(), r.spend]));
    } catch {
      metaSpendByName = null; // Meta connected but the call failed — fall back silently
    }
  }

  const manualSpendByName = new Map(adCampaigns.map((c) => [c.name.toLowerCase().trim(), Number(c.spend)]));

  const byCampaign = new Map<string, { campaign: string; total: number; contacted: number; won: number; lost: number; disqualified: number }>();
  for (const g of grouped) {
    const key = campaignKey(g.campaign);
    if (!byCampaign.has(key)) byCampaign.set(key, { campaign: key, total: 0, contacted: 0, won: 0, lost: 0, disqualified: 0 });
    const row = byCampaign.get(key)!;
    row.total += g._count;
    if (g.status !== "NEW_LEAD" && g.status !== "CHASE_UP") row.contacted += g._count;
    if (g.status === "WON") row.won += g._count;
    if (g.status === "LOST") row.lost += g._count;
    if (g.status === "DISQUALIFIED") row.disqualified += g._count;
  }

  return Array.from(byCampaign.values()).map((row) => {
    const key = row.campaign.toLowerCase().trim();
    const metaSpend = metaSpendByName?.get(key);
    const manualSpend = manualSpendByName.get(key);
    const closedTotal = row.won + row.lost + row.disqualified;
    return {
      ...row,
      lostOrDisqualified: row.lost + row.disqualified,
      closedTotal,
      winRate: closedTotal > 0 ? (row.won / closedTotal) * 100 : null,
      lossRate: closedTotal > 0 ? (row.lost / closedTotal) * 100 : null,
      disqualifiedRate: closedTotal > 0 ? (row.disqualified / closedTotal) * 100 : null,
      avgDaysToConvert: avgDaysByCampaign.get(row.campaign) ?? null,
      spend: metaSpend ?? manualSpend ?? null,
      spendSource: metaSpend !== undefined ? "meta" : manualSpend !== undefined ? "manual" : null,
    };
  });
}

export type LeadTimeSeriesPoint = {
  date: string;
  received: number;
  chaseUp: number;
  contacted: number;
  won: number;
  lostOrDisqualified: number;
};

type StageField = "createdAt" | "chaseUpAt" | "contactedAt" | "closedAt";

async function bucketCounts(
  clientId: string,
  field: StageField,
  granularity: "day" | "week" | "month",
  from: Date,
  to: Date,
  statuses?: LeadStatusValue[]
): Promise<{ bucket: Date; count: number }[]> {
  const col = Prisma.raw(`"${field}"`);
  const statusClause = statuses?.length ? Prisma.sql`AND status::text IN (${Prisma.join(statuses)})` : Prisma.empty;

  const rows = await prisma.$queryRaw<{ bucket: Date; count: bigint }[]>`
    SELECT date_trunc(${granularity}, ${col}) AS bucket, COUNT(*)::bigint AS count
    FROM "Lead"
    WHERE "clientId" = ${clientId}
      AND ${col} IS NOT NULL
      AND ${col} >= ${from}
      AND ${col} < ${to}
      ${statusClause}
    GROUP BY bucket
    ORDER BY bucket
  `;
  return rows.map((r) => ({ bucket: r.bucket, count: Number(r.count) }));
}

// Each series buckets by ITS OWN relevant date field (received by createdAt,
// contacted by contactedAt, etc.) — not all by createdAt — so the chart
// shows when each stage actually happened, not just when the lead first
// arrived. Granularity adapts to the window so a "Maximum" view doesn't try
// to plot years of daily points; "Maximum" itself has no lower bound, so it
// looks back 2 years for the chart specifically (the funnel/lead list still
// show truly all-time totals — this cap is chart-readability only).
export async function getClientLeadTimeSeries(
  clientId: string,
  dateRange?: { from?: Date; to?: Date }
): Promise<LeadTimeSeriesPoint[]> {
  const to = dateRange?.to ?? new Date();
  const twoYearsBack = new Date(to.getFullYear() - 2, to.getMonth(), to.getDate());
  const from = dateRange?.from ?? twoYearsBack;

  const spanDays = (to.getTime() - from.getTime()) / 86400000;
  const granularity: "day" | "week" | "month" = spanDays <= 31 ? "day" : spanDays <= 180 ? "week" : "month";

  const [received, chaseUp, contacted, won, lost] = await Promise.all([
    bucketCounts(clientId, "createdAt", granularity, from, to),
    bucketCounts(clientId, "chaseUpAt", granularity, from, to),
    bucketCounts(clientId, "contactedAt", granularity, from, to),
    bucketCounts(clientId, "closedAt", granularity, from, to, ["WON"]),
    bucketCounts(clientId, "closedAt", granularity, from, to, ["LOST", "DISQUALIFIED"]),
  ]);

  const byDate = new Map<string, LeadTimeSeriesPoint>();
  function ensure(d: Date) {
    const k = d.toISOString();
    if (!byDate.has(k)) byDate.set(k, { date: k, received: 0, chaseUp: 0, contacted: 0, won: 0, lostOrDisqualified: 0 });
    return byDate.get(k)!;
  }
  for (const r of received) ensure(r.bucket).received = r.count;
  for (const r of chaseUp) ensure(r.bucket).chaseUp = r.count;
  for (const r of contacted) ensure(r.bucket).contacted = r.count;
  for (const r of won) ensure(r.bucket).won = r.count;
  for (const r of lost) ensure(r.bucket).lostOrDisqualified = r.count;

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}
