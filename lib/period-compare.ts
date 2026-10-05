import { prisma } from "./prisma";
import { milestoneSql, wonAtSql } from "./milestones";
import { HANDOVER_STAGES } from "./lead-status";
import { clampRange, getReportingScope, type Range } from "./reporting-scope";

// Leads tab comparison chart: what happened in the selected period vs the
// period before it. Activity-based, like the Snapshot KPIs (lib/kpi.ts):
//
// leads           opt-in date in the window
// handovers       leads whose first handover (any HANDOVER_STAGES) happened in the window
// consultsBooked  leads whose consult was booked in the window
// quotes          leads whose quote went out in the window
// won             leads won in the window (wonAtSql, same as the Sales section)
//
// Each step is dated by its milestone (lib/milestones.ts). Only leads
// on/after the client's reporting start date count.

export const COMPARE_METRICS = ["leads", "handovers", "consultsBooked", "quotes", "won"] as const;
export type CompareMetric = (typeof COMPARE_METRICS)[number];
export type PeriodCounts = Record<CompareMetric, number>;

async function countPeriod(clientId: string, since: Date, r: Range): Promise<PeriodCounts> {
  const from = r.from ?? since;
  const to = r.to ?? new Date();
  const [row] = await prisma.$queryRaw<Record<CompareMetric, bigint>[]>`
    WITH l AS (
      SELECT id, "createdAt", stage FROM "Lead" WHERE "clientId" = ${clientId} AND "deletedAt" IS NULL AND "createdAt" >= ${since}
    ), m AS (
      SELECT l."createdAt" AS opt_in,
        ${milestoneSql(HANDOVER_STAGES)} AS handover,
        ${milestoneSql("CONSULT_BOOKED")} AS booked,
        ${milestoneSql("QUOTE_SENT")} AS quote,
        CASE WHEN l.stage = 'WON' THEN ${wonAtSql()} END AS won
      FROM l
    )
    SELECT
      COUNT(*) FILTER (WHERE opt_in >= ${from} AND opt_in < ${to}) AS leads,
      COUNT(*) FILTER (WHERE handover >= ${from} AND handover < ${to}) AS handovers,
      COUNT(*) FILTER (WHERE booked >= ${from} AND booked < ${to}) AS "consultsBooked",
      COUNT(*) FILTER (WHERE quote >= ${from} AND quote < ${to}) AS quotes,
      COUNT(*) FILTER (WHERE won >= ${from} AND won < ${to}) AS won
    FROM m
  `;
  return Object.fromEntries(COMPARE_METRICS.map((k) => [k, Number(row[k])])) as PeriodCounts;
}

export type PeriodComparison = { current: PeriodCounts; previous: PeriodCounts | null; previousLabel: string | null };

export async function getPeriodComparison(
  clientId: string,
  range: Range,
  previous: { from: Date; to: Date; label: string } | null
): Promise<PeriodComparison> {
  const scope = await getReportingScope(clientId);
  const since = scope.startDate ?? new Date(0);
  const prev = previous ? clampRange(previous, scope.startDate) : null;
  // A previous period entirely before the start date has nothing to show.
  const prevUsable = prev && prev.from! < prev.to! ? prev : null;
  const [current, before] = await Promise.all([
    countPeriod(clientId, since, clampRange(range, scope.startDate)),
    prevUsable ? countPeriod(clientId, since, prevUsable) : Promise.resolve(null),
  ]);
  return { current, previous: before, previousLabel: before ? previous!.label : null };
}
