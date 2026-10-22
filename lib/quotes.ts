import { prisma } from "./prisma";
import { liveAtSql, milestoneSql, quoteAtSql, wonAtSql } from "./milestones";
import { toneFor, type Tone } from "./kpi";
import { getReportingScope, type Range } from "./reporting-scope";
import { DQ_REASON_LABELS, LOST_REASON_LABELS, type DqReasonValue, type LeadStageValue, type LostReasonValue } from "./lead-status";
import type { ClientTypeValue } from "./client-terms";

// Quotes section (Leads tab → Quotes, and the Ads tab): every quoted lead,
// dated by its quote (quoteAtSql — the same rule as every quote count), with
// where it ended up:
//   won   the lead is Won
//   lost  quoted, then Lost or Disqualified
//   open  quoted and not closed yet — "outstanding"
// Only leads that came in on/after the client's reporting start date count
// (lib/reporting-scope.ts), like Sales.

export type QuoteStatus = "open" | "won" | "lost";

export type QuoteRow = {
  id: string;
  quotedAt: string;
  // False when there's no Quote Sent milestone and quotedAt is quoteAtSql's
  // stand-in (the outcome / last note / opt-in date) — day counts are then
  // left out rather than guessed.
  quoteDateKnown: boolean;
  name: string | null;
  campaign: string | null;
  value: number | null;
  status: QuoteStatus;
  stage: LeadStageValue;
  closedAt: string | null; // won / lost date
  daysOutstanding: number | null; // open: quote → today
  daysToClose: number | null; // won / lost: quote → outcome
  daysOptInToQuote: number | null;
  lostReason: string | null; // "Went elsewhere", "DQ · Price shopper", …
  updatePending: boolean; // open and waiting on the client's update
  likelyLost: boolean; // open and sat at its stage 2× the client's usual time
};

type Tally = { count: number; value: number };

export type QuotesResponse = {
  summary: {
    current: Tally;
    previous: Tally | null; // the period before the range; null for "Maximum"
    lifetime: Tally;
    tone: Tone | null;
    compareLabel: string | null;
    liveTransfers: number; // in the range — quote rate = quotes ÷ these
    quoteRate: number | null; // %
    open: Tally & { avgDaysOutstanding: number | null; updatePending: number };
    won: Tally & { rate: number | null; avgDaysToWon: number | null };
    lost: Tally & { rate: number | null };
  };
  lostByReason: { label: string; n: number }[];
  openByAge: { label: string; n: number }[];
  quotes: QuoteRow[]; // quoted in the range, newest first
  clientType: ClientTypeValue;
};

const DAY = 86_400_000;
const days = (from: Date, to: Date) => Math.max(0, Math.round((to.getTime() - from.getTime()) / DAY));
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);
const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);

export const AGE_BUCKETS = [
  { label: "0–7 days", max: 7 },
  { label: "8–14 days", max: 14 },
  { label: "15–30 days", max: 30 },
  { label: "31–60 days", max: 60 },
  { label: "60+ days", max: Infinity },
];

export function quoteStatus(stage: LeadStageValue): QuoteStatus {
  return stage === "WON" ? "won" : stage === "LOST" || stage === "DISQUALIFIED" ? "lost" : "open";
}

export function lostReasonLabel(stage: LeadStageValue, lostReason: LostReasonValue | null, dqReason: DqReasonValue | null) {
  if (stage === "LOST") return LOST_REASON_LABELS[lostReason ?? "UNKNOWN"];
  if (stage === "DISQUALIFIED") return `DQ · ${DQ_REASON_LABELS[dqReason ?? "UNKNOWN"]}`;
  return null;
}

export function ageBucket(daysOut: number) {
  return AGE_BUCKETS.find((b) => daysOut <= b.max)!.label;
}

export async function getQuotes(clientId: string, range: Range, prev: { from: Date; to: Date; label: string } | null, now = new Date()): Promise<QuotesResponse> {
  const scope = await getReportingScope(clientId);
  const since = scope.startDate ?? new Date(0);

  const rows = await prisma.$queryRaw<
    {
      id: string;
      name: string | null;
      campaign: string | null;
      value: unknown;
      stage: LeadStageValue;
      lostReason: LostReasonValue | null;
      dqReason: DqReasonValue | null;
      awaitingClientUpdate: boolean;
      staleInStage: boolean;
      createdAt: Date;
      quote_at: Date | null;
      quote_known: Date | null;
      live_at: Date | null;
      won_at: Date | null;
      closed_at: Date | null;
    }[]
  >`
    SELECT * FROM (
      SELECT l.id, l.name, l.campaign, l.value, l.stage, l."lostReason", l."dqReason", l."awaitingClientUpdate", l."staleInStage", l."createdAt",
        ${quoteAtSql()} AS quote_at,
        ${milestoneSql("QUOTE_SENT")} AS quote_known,
        ${liveAtSql()} AS live_at,
        CASE WHEN l.stage = 'WON' THEN ${wonAtSql()} END AS won_at,
        CASE WHEN l.stage IN ('LOST', 'DISQUALIFIED') THEN ${milestoneSql(["LOST", "DISQUALIFIED"])} END AS closed_at
      FROM "Lead" l
      WHERE l."clientId" = ${clientId} AND l."deletedAt" IS NULL AND l."createdAt" >= ${since}
    ) q
    WHERE q.quote_at IS NOT NULL OR q.live_at IS NOT NULL
  `;

  const inRange = (d: Date) => (!range.from || d >= range.from) && (!range.to || d < range.to);
  const liveTransfers = rows.filter((r) => r.live_at && inRange(r.live_at)).length;

  const all: QuoteRow[] = rows
    .filter((r): r is typeof r & { quote_at: Date } => r.quote_at != null)
    .map((r) => {
      const status = quoteStatus(r.stage);
      const closed = status === "won" ? r.won_at : status === "lost" ? r.closed_at : null;
      const known = r.quote_known != null;
      return {
        id: r.id,
        quotedAt: r.quote_at.toISOString(),
        quoteDateKnown: known,
        name: r.name,
        campaign: r.campaign,
        value: r.value == null ? null : Number(r.value),
        status,
        stage: r.stage,
        closedAt: closed?.toISOString() ?? null,
        daysOutstanding: status === "open" ? days(r.quote_at, now) : null,
        daysToClose: known && closed ? days(r.quote_at, closed) : null,
        daysOptInToQuote: known ? days(r.createdAt, r.quote_at) : null,
        lostReason: lostReasonLabel(r.stage, r.lostReason, r.dqReason),
        updatePending: status === "open" && r.awaitingClientUpdate,
        likelyLost: status === "open" && r.staleInStage,
      };
    })
    .sort((a, b) => b.quotedAt.localeCompare(a.quotedAt) || a.id.localeCompare(b.id));

  const tally = (list: QuoteRow[]): Tally => ({ count: list.length, value: list.reduce((s, q) => s + (q.value ?? 0), 0) });
  const quotes = all.filter((q) => inRange(new Date(q.quotedAt)));
  const current = tally(quotes);
  const previous = prev ? tally(all.filter((q) => new Date(q.quotedAt) >= prev.from && new Date(q.quotedAt) < prev.to)) : null;

  const open = quotes.filter((q) => q.status === "open");
  const won = quotes.filter((q) => q.status === "won");
  const lost = quotes.filter((q) => q.status === "lost");

  const reasons = new Map<string, number>();
  for (const q of lost) reasons.set(q.lostReason!, (reasons.get(q.lostReason!) ?? 0) + 1);

  return {
    summary: {
      current,
      previous,
      lifetime: tally(all),
      tone: previous ? toneFor("count", current.count, previous.count) : null,
      compareLabel: prev ? `vs ${prev.label}` : null,
      liveTransfers,
      quoteRate: pct(current.count, liveTransfers),
      open: { ...tally(open), avgDaysOutstanding: avg(open.map((q) => q.daysOutstanding!)), updatePending: open.filter((q) => q.updatePending).length },
      won: { ...tally(won), rate: pct(won.length, current.count), avgDaysToWon: avg(won.flatMap((q) => (q.daysToClose == null ? [] : [q.daysToClose]))) },
      lost: { ...tally(lost), rate: pct(lost.length, current.count) },
    },
    lostByReason: Array.from(reasons, ([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n),
    openByAge: AGE_BUCKETS.map((b) => ({ label: b.label, n: open.filter((q) => ageBucket(q.daysOutstanding!) === b.label).length })),
    quotes,
    clientType: (await prisma.client.findUnique({ where: { id: clientId }, select: { clientType: true } }))?.clientType ?? "OTHER",
  };
}
