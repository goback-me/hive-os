import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken, getSheetValues } from "@/lib/google-sheets";
import { getMetaCampaignInsights } from "@/lib/meta-ads";
import type { LeadStatusValue } from "@/lib/lead-status";
import { LEAD_STATUSES, moreConclusive, stageTimestampPatch } from "@/lib/lead-status";
import {
  DATE_OPT_IN_KEYWORDS,
  findColumn,
  formatSheetDate,
  normalizeEmail,
  normalizeHeader,
  normalizePhone,
  normalizeStatus,
  parseSheetDate,
} from "@/lib/sheet-parse";

function normalizeIdentity(v: string) {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeName(v: string | null | undefined) {
  return normalizeIdentity(v ?? "");
}

// Stored mappings may have been saved with raw sheet text as keys — always
// compare on the normalized form so "DQ " and "dq" hit the same entry.
export function normalizeMappingKeys<T>(mapping: unknown): Record<string, T> {
  if (!mapping || typeof mapping !== "object") return {};
  return Object.fromEntries(Object.entries(mapping as Record<string, T>).map(([k, v]) => [normalizeStatus(k), v]));
}

export type UnmappedStatuses = { status: Record<string, number>; result: Record<string, number> };

function parseMoney(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n !== 0 ? n : null;
}

// total = sheet rows, leads = rows with an identity; updated only counts leads that actually changed.
export type SyncSummary = { total: number; leads: number; created: number; updated: number; removed: number; restored: number };

// Soft-deletes every synced lead for a client — used when the client's sheet
// is changed or removed, so leads from a sheet that's no longer assigned never
// show alongside the new one. Notes/history stay, and a lead is restored if
// its row turns up again.
export async function clearClientLeads(clientId: string) {
  await prisma.lead.updateMany({ where: { clientId, deletedAt: null }, data: { deletedAt: new Date() } });
}

// Pulls the client's assigned sheet (read-only, always) and upserts each row
// into the Lead table. A lead whose status has been manually set in the app
// (statusManuallySetAt) never has its status overwritten by a later sync —
// every other field still refreshes normally. The outcome (time or error) is
// recorded on ClientSheet so the Leads tab can show it.
export async function syncLeadsFromSheet(clientId: string): Promise<SyncSummary> {
  const sheet = await prisma.clientSheet.findUnique({ where: { clientId } });
  if (!sheet) throw new Error("No Google Sheet assigned to this client yet — connect one on the Leads page first.");

  try {
    const { summary, unmapped } = await runSync(clientId, sheet);
    await prisma.clientSheet.update({
      where: { clientId },
      data: { lastSyncedAt: new Date(), lastSyncError: null, unmappedStatuses: unmapped },
    });
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.clientSheet.update({ where: { clientId }, data: { lastSyncError: message.slice(0, 500) } }).catch(() => {});
    throw err;
  }
}

const CHUNK = 200;
function chunks<T>(arr: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
  return out;
}

type ExistingLead = Awaited<ReturnType<typeof prisma.lead.findMany>>[number];

// Nothing to write if every synced field already matches — keeps a 5-minute
// cron from rewriting thousands of identical rows.
function leadChanged(existing: ExistingLead, data: Record<string, unknown>) {
  for (const [k, v] of Object.entries(data)) {
    const cur = (existing as Record<string, unknown>)[k];
    if (k === "raw") {
      if (JSON.stringify(cur ?? {}) !== JSON.stringify(v ?? {})) return true;
    } else if (k === "value") {
      if ((cur == null ? null : Number(cur)) !== (v == null ? null : Number(v))) return true;
    } else if (cur instanceof Date || v instanceof Date) {
      if ((cur as Date | null)?.getTime() !== (v as Date | null)?.getTime()) return true;
    } else if ((cur ?? null) !== (v ?? null)) return true;
  }
  return false;
}

type PendingUpdate = {
  lead: ExistingLead;
  data: Record<string, unknown>;
  statusFrom?: LeadStatusValue;
  statusTo?: LeadStatusValue;
  value: number | null;
};

async function runSync(
  clientId: string,
  sheet: NonNullable<Awaited<ReturnType<typeof prisma.clientSheet.findUnique>>>
): Promise<{ summary: SyncSummary; unmapped: UnmappedStatuses }> {
  const accessToken = await getValidAccessToken();
  const { headers, rows, cells } = await getSheetValues(accessToken, sheet.spreadsheetId, sheet.sheetName, { unformatted: true });

  const statusMapping = normalizeMappingKeys<LeadStatusValue>(sheet.statusMapping);
  const statusColIdx = sheet.statusColumn ? headers.indexOf(sheet.statusColumn) : -1;
  const resultStatusMapping = normalizeMappingKeys<LeadStatusValue>(sheet.resultStatusMapping);
  const resultStatusColIdx = sheet.resultStatusColumn ? headers.indexOf(sheet.resultStatusColumn) : -1;

  const nameIdx = findColumn(headers, ["name", "full name"], ["campaign", "ad", "adset", "ad set", "business"]);
  const phoneIdx = findColumn(headers, ["phone"]);
  const emailIdx = findColumn(headers, ["email"]);
  const sourceIdx = findColumn(headers, ["source"], ["utm"]);
  const campaignIdx = findColumn(headers, ["campaign"]);
  const adsetIdx = findColumn(headers, ["adset", "ad set"]);
  const revenueIdx = findColumn(headers, ["revenue generated", "revenue"]);
  const quoteIdx = findColumn(headers, ["quote value", "quote"]);
  const dateOptInIdx = findColumn(headers, DATE_OPT_IN_KEYWORDS);
  // Other date-ish columns only go into `raw` for display — turn serials
  // back into dd/mm/yyyy so they don't show as "46000.5".
  const dateLikeIdx = new Set(headers.map((h, i) => (normalizeHeader(h).split(" ").includes("date") ? i : -1)).filter((i) => i !== -1));
  const unmapped: UnmappedStatuses = { status: {}, result: {} };

  // Every lead this client has ever had from a sheet, soft-deleted included —
  // a row that reappears restores its old lead (notes + history intact)
  // instead of creating a duplicate.
  const existingLeads = await prisma.lead.findMany({ where: { clientId, externalKey: { not: null } } });
  const byEmail = new Map<string, ExistingLead>();
  const byPhone = new Map<string, ExistingLead>();
  const byName = new Map<string, ExistingLead>();
  // Soft-deleted first so an active lead with the same identity overwrites it.
  const ordered = [...existingLeads].sort((a, b) => Number(!!b.deletedAt) - Number(!!a.deletedAt));
  for (const l of ordered) {
    const e = normalizeEmail(l.email);
    const p = normalizePhone(l.phone);
    const n = normalizeName(l.name);
    if (e) byEmail.set(e, l);
    if (p) byPhone.set(p, l);
    if (n) byName.set(n, l);
  }

  // Match order: email, then phone, then name. A lead already matched by one
  // row can't be claimed by a different row via the weaker phone/name
  // fallback; a duplicate row with the same email still lands on the same lead.
  // ponytail: the name-only fallback can merge two different people with the
  // same name when neither has a matching email/phone. Fine at our volumes.
  const claimed = new Map<string, number>(); // leadId -> row index that claimed it
  const pending = new Map<string, PendingUpdate>();
  const creates = new Map<string, Record<string, unknown>>(); // externalKey -> data (dedupes identical rows)
  let identifiedRows = 0;

  rows.forEach((row, rowIdx) => {
    const name = nameIdx !== -1 ? row[nameIdx].trim() : "";
    // A mobile stored as a number comes back without its leading 0.
    const phoneText = phoneIdx !== -1 ? row[phoneIdx].trim() : "";
    const phone = /^4\d{8}$/.test(phoneText) ? "0" + phoneText : phoneText;
    const email = emailIdx !== -1 ? row[emailIdx].trim() : "";
    // Every row needs SOME identity to match across syncs — skip fully blank rows.
    if (!(email || phone || name)?.trim()) return;
    identifiedRows++;
    const externalKey = normalizeIdentity(`${email}|${phone}|${name}`);

    const e = normalizeEmail(email);
    const p = normalizePhone(phone);
    const n = normalizeName(name);
    const free = (l: ExistingLead | undefined) => (l && (!claimed.has(l.id) || claimed.get(l.id) === rowIdx) ? l : undefined);
    const existing = (e && byEmail.get(e)) || free(p ? byPhone.get(p) : undefined) || free(n ? byName.get(n) : undefined) || undefined;

    const rawStatus = statusColIdx !== -1 ? row[statusColIdx] ?? "" : "";
    const statusKey = normalizeStatus(rawStatus);
    const statusHit = LEAD_STATUSES.includes(statusMapping[statusKey] as LeadStatusValue);
    if (statusKey && !statusHit) unmapped.status[statusKey] = (unmapped.status[statusKey] ?? 0) + 1;
    const baseMappedStatus: LeadStatusValue = statusHit ? statusMapping[statusKey] : "NEW_LEAD";

    // The result column (e.g. "Prospect Status": did it actually close?)
    // overrides the outreach column above whenever it resolves to something
    // more conclusive — a client typing "DISQUALIFIED" or "SOLD" here beats
    // whatever the team's internal outreach-stage column still says.
    const rawResultStatus = resultStatusColIdx !== -1 ? row[resultStatusColIdx] ?? "" : "";
    const resultKey = normalizeStatus(rawResultStatus);
    const resultHit = LEAD_STATUSES.includes(resultStatusMapping[resultKey] as LeadStatusValue);
    if (resultKey && !resultHit) unmapped.result[resultKey] = (unmapped.result[resultKey] ?? 0) + 1;
    const resultMappedStatus = resultHit ? resultStatusMapping[resultKey] : null;
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
    const dateOptIn = dateOptInIdx !== -1 ? parseSheetDate(cells[rowIdx][dateOptInIdx]) : null;

    // Everything else — every header not otherwise mapped — goes into `raw`
    // for display only, keyed by its actual header text.
    const mappedIdx = new Set([nameIdx, phoneIdx, emailIdx, sourceIdx, campaignIdx, adsetIdx, revenueIdx, quoteIdx, statusColIdx, resultStatusColIdx, dateOptInIdx]);
    const raw: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (mappedIdx.has(i) || !h) return;
      const cell = cells[rowIdx][i];
      const asDate = dateLikeIdx.has(i) && typeof cell === "number" ? parseSheetDate(cell) : null;
      raw[h] = asDate ? formatSheetDate(asDate) : row[i] ?? "";
    });

    const baseData: Record<string, unknown> = {
      externalKey,
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
      deletedAt: null,
    };

    if (existing) {
      claimed.set(existing.id, rowIdx);
      // Respect a manual override — only apply the sheet's status (and the
      // stage timestamps that come with it) if nobody has manually touched
      // this lead's status yet.
      const statusPatch = existing.statusManuallySetAt ? {} : { status: mappedStatus, ...stageTimestampPatch(existing, mappedStatus) };
      const statusChanging = !existing.statusManuallySetAt && mappedStatus !== existing.status;
      pending.set(existing.id, {
        lead: existing,
        data: { ...baseData, ...statusPatch },
        ...(statusChanging ? { statusFrom: existing.status, statusTo: mappedStatus } : {}),
        value,
      });
    } else {
      const emptyStages = { chaseUpAt: null, contactedAt: null, closedAt: null };
      creates.set(externalKey, { clientId, status: mappedStatus, ...stageTimestampPatch(emptyStages, mappedStatus), ...baseData });
    }
  });

  // The sheet is the source of truth: an active lead whose row is gone is
  // soft-deleted. Leads without an externalKey (added outside the sheet) are
  // never touched.
  const activeLeads = existingLeads.filter((l) => !l.deletedAt);
  const staleIds = activeLeads.filter((l) => !claimed.has(l.id)).map((l) => l.id);

  // Safety guard — a renamed tab, a filter view or a bad paste can make the
  // sheet look empty. Refuse (changing nothing) rather than wipe most of a
  // client's leads.
  if (activeLeads.length > 0 && (identifiedRows === 0 || (staleIds.length > 5 && staleIds.length > activeLeads.length * 0.2))) {
    const removing = identifiedRows === 0 ? activeLeads.length : staleIds.length;
    throw new Error(`Sync aborted: would remove ${removing} of ${activeLeads.length} leads — check the sheet/tab`);
  }

  const updates = Array.from(pending.values()).filter((u) => leadChanged(u.lead, u.data));
  const restored = updates.filter((u) => u.lead.deletedAt).length;
  const now = new Date();

  // All-or-nothing: a sync that fails halfway leaves the previous state intact.
  await prisma.$transaction(
    async (tx) => {
      for (const batch of chunks(Array.from(creates.values()))) {
        await tx.lead.createMany({ data: batch.map((d) => ({ ...d, lastSyncedAt: now })) as Prisma.LeadCreateManyInput[] });
      }
      for (const batch of chunks(updates)) {
        await Promise.all(batch.map((u) => tx.lead.update({ where: { id: u.lead.id }, data: { ...u.data, lastSyncedAt: now } })));
        // A re-sync moving an existing lead to a new stage IS a real status
        // transition worth a history entry — only the very first status a
        // lead gets on creation is routine ingestion, not a "change".
        const activity = batch
          .filter((u) => u.statusTo)
          .map((u) => ({ leadId: u.lead.id, fromStatus: u.statusFrom!, toStatus: u.statusTo!, value: u.value, changedBy: "Sheet sync" }));
        if (activity.length) await tx.leadActivity.createMany({ data: activity });
      }
      for (const batch of chunks(staleIds)) {
        await tx.lead.updateMany({ where: { id: { in: batch } }, data: { deletedAt: now } });
      }
    },
    { timeout: 120_000, maxWait: 10_000 }
  );

  return {
    summary: { total: rows.length, leads: identifiedRows, created: creates.size, updated: updates.length - restored, removed: staleIds.length, restored },
    unmapped,
  };
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
    WHERE "clientId" = ${clientId} AND "deletedAt" IS NULL AND status = 'WON' AND "closedAt" IS NOT NULL
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
    prisma.lead.groupBy({ by: ["campaign", "status"], where: { clientId, deletedAt: null, ...(createdAt ? { createdAt } : {}) }, _count: true }),
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
      AND "deletedAt" IS NULL
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
