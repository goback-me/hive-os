import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { SHEET_TZ, sydneyLocalToDate } from "./sheet-parse";
import { getReportingScope, scopedSpend, type ReportingScope } from "./reporting-scope";
import { milestoneSql, wonAtSql } from "./milestones";
import { terms } from "./client-terms";
import type { ReportVisibility } from "./report-visibility";

// Snapshot KPIs — activity-based, bucketed by Sydney calendar month.
//
// leads           opt-in date (Lead.createdAt) in the window
// contacted       distinct leads first contacted in the window
// liveTransfers   distinct leads whose live handover happened in the window
// consultsBooked  distinct leads whose consult was booked in the window
// quotes          distinct leads whose quote went out in the window
// sales / revenue leads won in the window (won date) and their job values
//
// "Happened" = the step's milestone date (lib/milestones.ts): the team's
// dated note, else the stage change the app saw live — never IMPORT/INFERRED,
// whose timestamp is just when we first synced and would pile a client's
// whole history into their first month. Each lead counts once per step, in
// the month it first reached it. Only leads that came in on/after the client's
// reporting start date count, and only included campaigns' spend
// (lib/reporting-scope.ts).

export type MonthKey = string; // "2026-09"
type Window = { from: Date; to: Date; since: string; until: string }; // to exclusive; since/until inclusive days

export type KpiValues = {
  leads: number;
  contacted: number;
  liveTransfers: number;
  consultsBooked: number;
  quotes: number;
  sales: number;
  revenue: number;
  spend: number | null;
  spendSource: "meta" | "daily" | null;
  costPerBooking: number | null;
  costPerQuote: number | null;
  costPerSale: number | null;
};

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

// A month freezes once it's over — from the 1st of the next (Sydney).
export function isFreezable(k: MonthKey, now = new Date()) {
  return now.getTime() >= monthWindow(addMonths(k, 1)).from.getTime();
}

// ── Computing ──────────────────────────────────────────────────────────────

async function countKpis(clientId: string, w: Window, startDate: Date | null) {
  const since = startDate ?? new Date(0);
  const [row] = await prisma.$queryRaw<{ leads: bigint; contacted: bigint; live: bigint; booked: bigint; quotes: bigint; sales: bigint; revenue: unknown }[]>`
    WITH l AS (
      SELECT id, "createdAt", stage, value FROM "Lead" WHERE "clientId" = ${clientId} AND "deletedAt" IS NULL AND "createdAt" >= ${since}
    ), m AS (
      SELECT l."createdAt" AS opt_in, l.value,
        ${milestoneSql("CONTACTED")} AS contacted,
        ${milestoneSql("HANDOVER_LIVE")} AS live,
        ${milestoneSql("CONSULT_BOOKED")} AS booked,
        ${milestoneSql("QUOTE_SENT")} AS quote,
        CASE WHEN l.stage = 'WON' THEN ${wonAtSql()} END AS won
      FROM l
    )
    SELECT
      COUNT(*) FILTER (WHERE opt_in >= ${w.from} AND opt_in < ${w.to}) AS leads,
      COUNT(*) FILTER (WHERE contacted >= ${w.from} AND contacted < ${w.to}) AS contacted,
      COUNT(*) FILTER (WHERE live >= ${w.from} AND live < ${w.to}) AS live,
      COUNT(*) FILTER (WHERE booked >= ${w.from} AND booked < ${w.to}) AS booked,
      COUNT(*) FILTER (WHERE quote >= ${w.from} AND quote < ${w.to}) AS quotes,
      COUNT(*) FILTER (WHERE won >= ${w.from} AND won < ${w.to}) AS sales,
      COALESCE(SUM(value) FILTER (WHERE won >= ${w.from} AND won < ${w.to}), 0) AS revenue
    FROM m
  `;
  return {
    leads: Number(row.leads),
    contacted: Number(row.contacted),
    liveTransfers: Number(row.live),
    consultsBooked: Number(row.booked),
    quotes: Number(row.quotes),
    sales: Number(row.sales),
    revenue: Number(row.revenue ?? 0),
  };
}

// Included Meta spend for exactly these days; else the dated daily-spend
// table. Manual AdCampaign spend is deliberately NOT used: it has no dates, so
// it would put all-time spend into every month and wreck cost-per-booking.
// Throws if Meta is connected but the call fails — callers that freeze must
// not store a null spend over a transient Meta error.
async function spendFor(scope: ReportingScope, w: Window, cached: boolean): Promise<Pick<KpiValues, "spend" | "spendSource">> {
  const s = await scopedSpend(scope, w, { cached, strict: true });
  return s.source === "meta" || s.source === "daily" ? { spend: s.total, spendSource: s.source } : { spend: null, spendSource: null };
}

// Cost per X = spend ÷ X; null when there's no spend source or X is 0.
function withCosts(c: Omit<KpiValues, "costPerBooking" | "costPerQuote" | "costPerSale">): KpiValues {
  const per = (d: number) => (c.spend != null && d > 0 ? c.spend / d : null);
  return { ...c, costPerBooking: per(c.consultsBooked), costPerQuote: per(c.quotes), costPerSale: per(c.sales) };
}

async function computeWindow(scope: ReportingScope, w: Window, opts: { cached: boolean; strictSpend: boolean }): Promise<KpiValues> {
  const [counts, spend] = await Promise.all([
    countKpis(scope.clientId, w, scope.startDate),
    spendFor(scope, w, opts.cached).catch((e) => {
      if (opts.strictSpend) throw e;
      return { spend: null, spendSource: null } as const; // expired token etc. — cost cards just drop out
    }),
  ]);
  return withCosts({ ...counts, ...spend });
}

type KpiRow = NonNullable<Awaited<ReturnType<typeof prisma.monthlyKpi.findUnique>>>;
const fromRow = (row: KpiRow): KpiValues =>
  withCosts({
    leads: row.leads,
    contacted: row.contacted,
    liveTransfers: row.liveTransfers,
    consultsBooked: row.consultsBooked,
    quotes: row.quotes,
    sales: row.sales,
    revenue: Number(row.revenue),
    spend: row.spend == null ? null : Number(row.spend),
    spendSource: row.spendSource as KpiValues["spendSource"],
  });

// A month's KPIs: the stored row when there is one, else computed live.
export async function getMonthKpis(clientId: string, k: MonthKey): Promise<KpiValues> {
  const row = await prisma.monthlyKpi.findUnique({ where: { clientId_month: { clientId, month: k } } });
  if (row) return fromRow(row);
  return computeWindow(await getReportingScope(clientId), monthWindow(k), { cached: true, strictSpend: false });
}

// Months k-(n-1)..k, oldest first. Past months from MonthlyKpi (else live);
// the current month is live month-to-date.
export async function getKpiHistory(clientId: string, k: MonthKey, n: number, now = new Date()): Promise<{ month: MonthKey; values: KpiValues }[]> {
  const scope = await getReportingScope(clientId);
  const current = monthKeyOf(now);
  const keys = Array.from({ length: n }, (_, i) => addMonths(k, i - (n - 1))).filter((m) => m <= current);
  const rows = new Map((await prisma.monthlyKpi.findMany({ where: { clientId, month: { in: keys } } })).map((r) => [r.month, r]));
  const opts = { cached: true, strictSpend: false };
  return Promise.all(
    keys.map(async (m) => {
      const stored = rows.get(m);
      const values =
        m === current
          ? await computeWindow(scope, { ...monthWindow(m), to: now }, opts)
          : stored
          ? fromRow(stored)
          : await computeWindow(scope, monthWindow(m), opts);
      return { month: m, values };
    })
  );
}

// KPIs for any range (from/to exclusive), clamped to the start date — the
// portfolio's date picker and the weekly update draft. Live, cached Meta.
export async function getRangeKpis(clientId: string, range: { from?: Date; to?: Date }, now = new Date()): Promise<KpiValues> {
  const scope = await getReportingScope(clientId);
  const from = range.from && (!scope.startDate || range.from > scope.startDate) ? range.from : scope.startDate ?? new Date(0);
  const to = range.to ?? now;
  if (from >= to) return withCosts({ leads: 0, contacted: 0, liveTransfers: 0, consultsBooked: 0, quotes: 0, sales: 0, revenue: 0, spend: 0, spendSource: null });
  const day = (d: Date) => sydneyParts(d);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const last = day(new Date(to.getTime() - 1));
  const first = day(from);
  return computeWindow(scope, { from, to, since: `${first.y}-${pad2(first.m)}-${pad2(first.d)}`, until: `${last.y}-${pad2(last.m)}-${pad2(last.d)}` }, { cached: true, strictSpend: false });
}

// This month so far, and the same days of last month — a like-for-like pair.
export async function getMonthToDateVsLast(clientId: string, now = new Date()) {
  const scope = await getReportingScope(clientId);
  const k = monthKeyOf(now);
  const today = sydneyParts(now).d;
  const opts = { cached: true, strictSpend: false };
  const [current, previous] = await Promise.all([
    computeWindow(scope, { ...monthWindow(k), to: now }, opts),
    computeWindow(scope, monthWindow(addMonths(k, -1), today), opts),
  ]);
  return { current, previous, today, daysInMonth: daysIn(parseKey(k).y, parseKey(k).m) };
}

// ── Month-end freeze + backfill ────────────────────────────────────────────

// Stores a closed month. FROZEN rows are final — never overwritten, not even
// by another freeze; a BACKFILL row is replaced by either.
async function storeMonth(scope: ReportingScope, k: MonthKey, source: "BACKFILL" | "FROZEN", cached: boolean) {
  const clientId = scope.clientId;
  const existing = await prisma.monthlyKpi.findUnique({ where: { clientId_month: { clientId, month: k } }, select: { source: true } });
  if (existing?.source === "FROZEN") return false;
  const v = await computeWindow(scope, monthWindow(k), { cached, strictSpend: true });
  const data = {
    leads: v.leads,
    contacted: v.contacted,
    liveTransfers: v.liveTransfers,
    consultsBooked: v.consultsBooked,
    quotes: v.quotes,
    sales: v.sales,
    revenue: v.revenue,
    spend: v.spend,
    spendSource: v.spendSource,
    source,
  };
  await prisma.monthlyKpi.upsert({
    where: { clientId_month: { clientId, month: k } },
    create: { clientId, month: k, ...data },
    update: { ...data, frozenAt: new Date() },
  });
  return true;
}

// The first month with a lead on/after the reporting start date.
async function firstLeadMonth(clientId: string, startDate: Date | null): Promise<MonthKey | null> {
  const first = await prisma.lead.findFirst({
    where: { clientId, deletedAt: null, ...(startDate ? { createdAt: { gte: startDate } } : {}) },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  return first ? monthKeyOf(first.createdAt) : null;
}

// The cron, from the 1st: freezes the last `lookback` closed months that
// aren't FROZEN yet (a BACKFILL row for that month becomes FROZEN).
export async function freezeDueMonths(clientId: string, opts: { lookback?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const scope = await getReportingScope(clientId, { cached: false });
  const start = await firstLeadMonth(clientId, scope.startDate);
  if (!start) return [];
  const current = monthKeyOf(now);
  const earliest = addMonths(current, -(opts.lookback ?? 2));
  const frozen = new Set((await prisma.monthlyKpi.findMany({ where: { clientId, source: "FROZEN" }, select: { month: true } })).map((r) => r.month));
  const done: MonthKey[] = [];
  for (let k = earliest > start ? earliest : start; k < current; k = addMonths(k, 1)) {
    if (frozen.has(k) || !isFreezable(k, now)) continue;
    if (await storeMonth(scope, k, "FROZEN", false)) done.push(k);
  }
  return done;
}

// "Rebuild history": every closed month from the start date (or first lead)
// recomputed from opt-in dates and notes, stored as BACKFILL. FROZEN months
// are left alone. `cached` = false outside Next (the backfill script).
export async function rebuildHistory(clientId: string, { cached = true, now = new Date() }: { cached?: boolean; now?: Date } = {}) {
  const scope = await getReportingScope(clientId, { cached });
  const start = await firstLeadMonth(clientId, scope.startDate);
  if (!start) return [];
  const current = monthKeyOf(now);
  const done: MonthKey[] = [];
  for (let k = start; k < current; k = addMonths(k, 1)) {
    if (await storeMonth(scope, k, "BACKFILL", cached)) done.push(k);
  }
  return done;
}

// ── Snapshot cards ─────────────────────────────────────────────────────────

export type CardKey = "liveTransfers" | "consultsBooked" | "quotes" | "sales" | "costPerQuote" | "costPerSale" | "leads";
export type Tone = "green" | "amber" | "red";

export type SnapshotCard = {
  key: CardKey;
  label: string;
  kind: "count" | "cost";
  value: number | null;
  previous: number | null;
  tone: Tone | null;
  pace: number | null; // current month only: where a count is headed by month end
  history: { month: MonthKey; value: number | null }[]; // last 6 months, oldest first
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

function cardsFor(clientType: Parameters<typeof terms>[0]): { key: CardKey; label: string; kind: "count" | "cost" }[] {
  const t = terms(clientType);
  return [
    { key: "liveTransfers", label: "Live transfers", kind: "count" },
    { key: "consultsBooked", label: "Consults booked", kind: "count" },
    { key: "quotes", label: t.quotes, kind: "count" },
    { key: "sales", label: t.sales, kind: "count" },
    { key: "costPerQuote", label: `Cost per ${t.quote.toLowerCase()}`, kind: "cost" },
    { key: "costPerSale", label: `Cost per ${t.sale.toLowerCase()}`, kind: "cost" },
    { key: "leads", label: "Leads", kind: "count" },
  ];
}

// Green = at least as good as before (costs: as low or lower); amber = worse
// but within 10%; red = more than 10% worse. No tone when there's nothing to
// compare with (previous missing or 0).
export function toneFor(kind: "count" | "cost", value: number | null, previous: number | null): Tone | null {
  if (value == null || previous == null || previous === 0) return null;
  const worse = kind === "count" ? (previous - value) / previous : (value - previous) / previous;
  return worse <= 0 ? "green" : worse <= 0.1 ? "amber" : "red";
}

function hiddenReason(card: { key: CardKey; kind: "count" | "cost" }, value: number | null, v: ReportVisibility): string | null {
  if (card.kind === "cost" && !v.showCostMetrics) return "Cost metrics are hidden";
  if (card.kind === "cost" && value == null) return card.key === "costPerQuote" ? "No quotes or spend yet" : "No sales or spend yet";
  if (card.kind === "count" && value === 0) return "Zero this period";
  return null;
}

// The current month compares month-to-date against the same days of last
// month (a partial month vs a full one would always look like a drop), and
// projects counts to month end. A closed month compares against the whole
// previous month.
export async function getSnapshot(
  clientId: string,
  month: MonthKey | null,
  viewer: { role: "COACH" | "CLIENT" },
  visibility: ReportVisibility,
  now = new Date()
): Promise<Snapshot> {
  const current = monthKeyOf(now);
  const [scope, client] = await Promise.all([
    getReportingScope(clientId),
    prisma.client.findUnique({ where: { id: clientId }, select: { clientType: true } }),
  ]);
  const start = (await firstLeadMonth(clientId, scope.startDate)) ?? current;
  const months: { key: MonthKey; label: string }[] = [];
  for (let k = current; k >= start && months.length < 12; k = addMonths(k, -1)) months.push({ key: k, label: monthLabel(k) });

  const k = month && month <= current && month >= start ? month : current;
  const isCurrent = k === current;
  const prevKey = addMonths(k, -1);
  const today = sydneyParts(now).d;

  let previous: KpiValues;
  let compareLabel: string;
  const history = await getKpiHistory(clientId, k, 6, now);
  const values = history[history.length - 1].values;
  if (isCurrent) {
    previous = await computeWindow(scope, monthWindow(prevKey, today), { cached: true, strictSpend: false });
    compareLabel = `vs 1–${today} ${monthLabel(prevKey).split(" ")[0]}`;
  } else {
    previous = history.length > 1 ? history[history.length - 2].values : await getMonthKpis(clientId, prevKey);
    compareLabel = `vs ${monthLabel(prevKey).split(" ")[0]}`;
  }
  const { y, m } = parseKey(k);
  const pace = (v: number) => Math.round((v / today) * daysIn(y, m));

  const isClient = viewer.role === "CLIENT";
  const cards = cardsFor(client?.clientType).flatMap((c): SnapshotCard[] => {
    const value = values[c.key];
    const reason = hiddenReason(c, value, visibility);
    if (isClient && reason) return []; // never sent to the client at all
    return [
      {
        ...c,
        value,
        previous: previous[c.key],
        tone: toneFor(c.kind, value, previous[c.key]),
        pace: isCurrent && c.kind === "count" && value ? (today < daysIn(y, m) ? pace(value) : null) : null,
        history: history.map((h) => ({ month: h.month, value: h.values[c.key] })),
        hiddenFromClient: reason,
      },
    ];
  });

  return { month: k, monthLabel: monthLabel(k), isCurrent, compareLabel, months, cards, spendSource: isClient ? null : values.spendSource };
}

// Exported for the self-check (lib/kpi.check.ts).
export const _test = { monthWindow, sydneyParts };
