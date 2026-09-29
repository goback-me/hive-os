import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { SHEET_TZ, sydneyLocalToDate } from "./sheet-parse";
import { getCachedAccountSpend, getMetaAccountSpend } from "./meta-ads";
import type { ReportVisibility } from "./report-visibility";

// Snapshot KPIs — activity-based, bucketed by Sydney calendar month.
//
// leads           opt-in date (Lead.createdAt) in the window
// liveTransfers   distinct leads whose live handover happened in the window
// consultsBooked  distinct leads whose consult was booked in the window
// quotes          distinct leads whose quote went out in the window
//
// "Happened" = the team's own dated note for that step when there is one,
// else the stage change the app saw live (SYNC/MANUAL) — the same rule the
// funnel's timings use. IMPORT/INFERRED stage events are skipped: their
// timestamp is just when we first synced, which would pile a client's whole
// history into their first month. Each lead counts once per step, in the
// month it first reached it.

export type MonthKey = string; // "2026-09"
type Window = { from: Date; to: Date; since: string; until: string }; // to exclusive; since/until inclusive days

export type KpiValues = {
  leads: number;
  liveTransfers: number;
  consultsBooked: number;
  quotes: number;
  spend: number | null;
  spendSource: "meta" | "daily" | null;
  costPerBooking: number | null;
  costPerQuote: number | null;
};

// Closed months stay open this many days for late notes before freezing.
// ponytail: fixed grace period; make it per-client if a team logs later than this.
const FREEZE_GRACE_DAYS = 3;
const DAY = 86_400_000;

// ── Sydney calendar helpers ────────────────────────────────────────────────

function sydneyParts(d: Date) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: SHEET_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, m: number): MonthKey => `${y}-${pad(m)}`;
const parseKey = (k: MonthKey) => ({ y: Number(k.slice(0, 4)), m: Number(k.slice(5, 7)) });
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export const isMonthKey = (v: unknown): v is MonthKey => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

export function monthKeyOf(d: Date): MonthKey {
  const { y, m } = sydneyParts(d);
  return keyOf(y, m);
}

export function addMonths(k: MonthKey, n: number): MonthKey {
  const { y, m } = parseKey(k);
  const i = y * 12 + (m - 1) + n;
  return keyOf(Math.floor(i / 12), (i % 12) + 1);
}

export function monthLabel(k: MonthKey) {
  const { y, m } = parseKey(k);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-AU", { month: "long", year: "numeric", timeZone: "UTC" });
}

// Days 1..lastDay of a month (inclusive), as a Sydney window.
function monthWindow(k: MonthKey, lastDay?: number): Window {
  const { y, m } = parseKey(k);
  const last = Math.min(lastDay ?? daysIn(y, m), daysIn(y, m));
  const next = last === daysIn(y, m) ? parseKey(addMonths(k, 1)) : null;
  return {
    from: sydneyLocalToDate(y, m, 1)!,
    to: next ? sydneyLocalToDate(next.y, next.m, 1)! : sydneyLocalToDate(y, m, last + 1)!,
    since: `${k}-01`,
    until: `${k}-${pad(last)}`,
  };
}

export function isFreezable(k: MonthKey, now = new Date()) {
  return now.getTime() >= monthWindow(addMonths(k, 1)).from.getTime() + FREEZE_GRACE_DAYS * DAY;
}

// ── Computing ──────────────────────────────────────────────────────────────

async function countKpis(clientId: string, w: Window) {
  const [row] = await prisma.$queryRaw<{ leads: bigint; live: bigint; booked: bigint; quotes: bigint }[]>`
    WITH l AS (
      SELECT id, "createdAt" FROM "Lead" WHERE "clientId" = ${clientId} AND "deletedAt" IS NULL
    ), ev AS (
      SELECT e."leadId", e.stage::text AS step, e.at, false AS note
      FROM "LeadStageEvent" e JOIN l ON l.id = e."leadId"
      WHERE e.source IN ('SYNC', 'MANUAL') AND e.stage IN ('HANDOVER_LIVE', 'CONSULT_BOOKED', 'QUOTE_SENT')
      UNION ALL
      SELECT ne."leadId", ne.event::text, ne.at, true
      FROM "LeadNoteEvent" ne JOIN l ON l.id = ne."leadId"
      WHERE ne.event IN ('HANDOVER_LIVE', 'CONSULT_BOOKED', 'QUOTE_SENT')
    ), first AS (
      -- The team's dated note wins over when our sync noticed the change.
      SELECT "leadId", step, COALESCE(MIN(at) FILTER (WHERE note), MIN(at)) AS at
      FROM ev GROUP BY "leadId", step
    )
    SELECT
      (SELECT COUNT(*) FROM l WHERE "createdAt" >= ${w.from} AND "createdAt" < ${w.to}) AS leads,
      COUNT(*) FILTER (WHERE step = 'HANDOVER_LIVE' AND at >= ${w.from} AND at < ${w.to}) AS live,
      COUNT(*) FILTER (WHERE step = 'CONSULT_BOOKED' AND at >= ${w.from} AND at < ${w.to}) AS booked,
      COUNT(*) FILTER (WHERE step = 'QUOTE_SENT' AND at >= ${w.from} AND at < ${w.to}) AS quotes
    FROM first
  `;
  return { leads: Number(row.leads), liveTransfers: Number(row.live), consultsBooked: Number(row.booked), quotes: Number(row.quotes) };
}

// Meta spend for exactly these days; else the dated daily-spend table.
// Manual AdCampaign spend is deliberately NOT used: it has no dates, so it
// would put all-time spend into every month and wreck cost-per-booking.
// Throws if Meta is connected but the call fails — callers that freeze must
// not store a null spend over a transient Meta error.
async function spendFor(clientId: string, w: Window, cached: boolean): Promise<Pick<KpiValues, "spend" | "spendSource">> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { metaAdAccountId: true, metaAccessToken: true } });
  if (client?.metaAdAccountId && client.metaAccessToken) {
    const get = cached ? getCachedAccountSpend : getMetaAccountSpend;
    return { spend: await get(client.metaAdAccountId, client.metaAccessToken, w.since, w.until), spendSource: "meta" };
  }
  const daily = await prisma.adSpendDaily.aggregate({ _sum: { spend: true }, _count: true, where: { clientId, date: { gte: w.from, lt: w.to } } });
  return daily._count ? { spend: Number(daily._sum.spend ?? 0), spendSource: "daily" } : { spend: null, spendSource: null };
}

function withCosts(c: Omit<KpiValues, "costPerBooking" | "costPerQuote">): KpiValues {
  const per = (d: number) => (c.spend != null && d > 0 ? c.spend / d : null);
  return { ...c, costPerBooking: per(c.consultsBooked), costPerQuote: per(c.quotes) };
}

async function computeWindow(clientId: string, w: Window, opts: { cached: boolean; strictSpend: boolean }): Promise<KpiValues> {
  const [counts, spend] = await Promise.all([
    countKpis(clientId, w),
    spendFor(clientId, w, opts.cached).catch((e) => {
      if (opts.strictSpend) throw e;
      return { spend: null, spendSource: null } as const; // expired token etc. — cost cards just drop out
    }),
  ]);
  return withCosts({ ...counts, ...spend });
}

// A month's KPIs: the frozen row when there is one, else computed live.
export async function getMonthKpis(clientId: string, k: MonthKey): Promise<KpiValues> {
  const row = await prisma.monthlyKpi.findUnique({ where: { clientId_month: { clientId, month: k } } });
  if (row) {
    return withCosts({
      leads: row.leads,
      liveTransfers: row.liveTransfers,
      consultsBooked: row.consultsBooked,
      quotes: row.quotes,
      spend: row.spend == null ? null : Number(row.spend),
      spendSource: row.spendSource as KpiValues["spendSource"],
    });
  }
  return computeWindow(clientId, monthWindow(k), { cached: true, strictSpend: false });
}

// ── Month-end freeze + backfill ────────────────────────────────────────────

async function freezeMonth(clientId: string, k: MonthKey) {
  const v = await computeWindow(clientId, monthWindow(k), { cached: false, strictSpend: true });
  const data = { leads: v.leads, liveTransfers: v.liveTransfers, consultsBooked: v.consultsBooked, quotes: v.quotes, spend: v.spend, spendSource: v.spendSource };
  await prisma.monthlyKpi.upsert({
    where: { clientId_month: { clientId, month: k } },
    create: { clientId, month: k, ...data },
    update: { ...data, frozenAt: new Date() },
  });
}

async function firstLeadMonth(clientId: string): Promise<MonthKey | null> {
  const first = await prisma.lead.findFirst({ where: { clientId, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  return first ? monthKeyOf(first.createdAt) : null;
}

// Every closed, past-grace month from the client's first lead up to
// `lookback` months back that isn't frozen yet (all of them when lookback is
// omitted — the backfill). `force` re-freezes months already stored.
export async function freezeDueMonths(clientId: string, opts: { lookback?: number; force?: boolean; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const start = await firstLeadMonth(clientId);
  if (!start) return [];
  const current = monthKeyOf(now);
  const earliest = opts.lookback ? addMonths(current, -opts.lookback) : start;
  const existing = new Set(
    opts.force ? [] : (await prisma.monthlyKpi.findMany({ where: { clientId }, select: { month: true } })).map((r) => r.month)
  );
  const frozen: MonthKey[] = [];
  for (let k = earliest > start ? earliest : start; k < current; k = addMonths(k, 1)) {
    if (existing.has(k) || !isFreezable(k, now)) continue;
    await freezeMonth(clientId, k);
    frozen.push(k);
  }
  return frozen;
}

// ── Snapshot cards ─────────────────────────────────────────────────────────

export type CardKey = "liveTransfers" | "consultsBooked" | "quotes" | "costPerBooking" | "costPerQuote" | "leads";
export type Tone = "green" | "amber" | "red";

export type SnapshotCard = {
  key: CardKey;
  label: string;
  kind: "count" | "cost";
  value: number | null;
  previous: number | null;
  tone: Tone | null;
  hiddenFromClient: string | null; // why a CLIENT doesn't see this card (coach view only)
};

export type Snapshot = {
  month: MonthKey;
  monthLabel: string;
  isCurrent: boolean;
  compareLabel: string;
  months: { key: MonthKey; label: string }[];
  cards: SnapshotCard[];
  spendSource: KpiValues["spendSource"]; // coach only (null for a CLIENT)
};

const CARDS: { key: CardKey; label: string; kind: "count" | "cost" }[] = [
  { key: "liveTransfers", label: "Live transfers", kind: "count" },
  { key: "consultsBooked", label: "Consults booked", kind: "count" },
  { key: "quotes", label: "Quotes", kind: "count" },
  { key: "costPerBooking", label: "Cost per booking", kind: "cost" },
  { key: "costPerQuote", label: "Cost per quote", kind: "cost" },
  { key: "leads", label: "Leads", kind: "count" },
];

// ±10% vs the comparison period is "holding steady" (amber). Costs are
// inverted: lower is better, so a falling cost is green.
export function toneFor(kind: "count" | "cost", value: number | null, previous: number | null): Tone | null {
  if (value == null || previous == null) return null;
  if (previous === 0) return kind === "count" && value > 0 ? "green" : null;
  const change = (value - previous) / previous;
  const better = kind === "count" ? change : -change;
  return better >= 0.1 ? "green" : better <= -0.1 ? "red" : "amber";
}

function hiddenReason(card: (typeof CARDS)[number], value: number | null, v: ReportVisibility): string | null {
  if (card.kind === "cost" && !v.showCostMetrics) return "Cost metrics are hidden";
  if (card.kind === "cost" && value == null) return card.key === "costPerBooking" ? "No bookings or spend yet" : "No quotes or spend yet";
  if (card.kind === "count" && value === 0) return "Zero this period";
  return null;
}

// The current month compares month-to-date against the same days of last
// month (a partial month vs a full one would always look like a drop).
// A closed month compares against the whole previous month.
export async function getSnapshot(
  clientId: string,
  month: MonthKey | null,
  viewer: { role: "COACH" | "CLIENT" },
  visibility: ReportVisibility,
  now = new Date()
): Promise<Snapshot> {
  const current = monthKeyOf(now);
  const start = (await firstLeadMonth(clientId)) ?? current;
  const months: { key: MonthKey; label: string }[] = [];
  for (let k = current; k >= start && months.length < 12; k = addMonths(k, -1)) months.push({ key: k, label: monthLabel(k) });

  const k = month && month <= current && month >= start ? month : current;
  const isCurrent = k === current;
  const prevKey = addMonths(k, -1);

  let values: KpiValues;
  let previous: KpiValues;
  let compareLabel: string;
  if (isCurrent) {
    const today = sydneyParts(now).d;
    const w = monthWindow(k);
    const opts = { cached: true, strictSpend: false };
    [values, previous] = await Promise.all([
      computeWindow(clientId, { ...w, to: now, until: `${k}-${pad(today)}` }, opts),
      computeWindow(clientId, monthWindow(prevKey, today), opts),
    ]);
    compareLabel = `vs 1–${today} ${monthLabel(prevKey).split(" ")[0]}`;
  } else {
    [values, previous] = await Promise.all([getMonthKpis(clientId, k), getMonthKpis(clientId, prevKey)]);
    compareLabel = `vs ${monthLabel(prevKey).split(" ")[0]}`;
  }

  const isClient = viewer.role === "CLIENT";
  const cards = CARDS.flatMap((c): SnapshotCard[] => {
    const value = values[c.key];
    const reason = hiddenReason(c, value, visibility);
    if (isClient && reason) return []; // never sent to the client at all
    return [{ ...c, value, previous: previous[c.key], tone: toneFor(c.kind, value, previous[c.key]), hiddenFromClient: reason }];
  });

  return { month: k, monthLabel: monthLabel(k), isCurrent, compareLabel, months, cards, spendSource: isClient ? null : values.spendSource };
}

// Exported for the self-check (lib/kpi.check.ts).
export const _test = { monthWindow, sydneyParts };
