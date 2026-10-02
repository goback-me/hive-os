import { prisma } from "./prisma";
import { WON_AT_SQL } from "./lead-wins";
import { clampRange, getReportingScope, type Range } from "./reporting-scope";

// Leads tab comparison chart: what happened in the selected period vs the
// period before it. Activity-based, like the Snapshot KPIs (lib/kpi.ts):
//
// leads           opt-in date in the window
// handovers       leads whose live or text handover happened in the window
// consultsBooked  leads whose consult was booked in the window
// quotes          leads whose quote went out in the window
// won             leads won in the window (WON_AT_SQL, same as the Sales section)
//
// A step's date is the team's dated note when there is one, else the stage
// change the app saw live (SYNC/MANUAL). Only leads on/after the client's
// reporting start date count.

export const COMPARE_METRICS = ["leads", "handovers", "consultsBooked", "quotes", "won"] as const;
export type CompareMetric = (typeof COMPARE_METRICS)[number];
export type PeriodCounts = Record<CompareMetric, number>;

async function countPeriod(clientId: string, since: Date, r: Range): Promise<PeriodCounts> {
  const from = r.from ?? since;
  const to = r.to ?? new Date();
  const [row] = await prisma.$queryRaw<Record<CompareMetric, bigint>[]>`
    WITH l AS (
      SELECT id FROM "Lead" WHERE "clientId" = ${clientId} AND "deletedAt" IS NULL AND "createdAt" >= ${since}
    ), ev AS (
      SELECT e."leadId", CASE WHEN e.stage IN ('HANDOVER_LIVE', 'HANDOVER_TEXT') THEN 'HANDOVER' ELSE e.stage::text END AS step, e.at, false AS note
      FROM "LeadStageEvent" e JOIN l ON l.id = e."leadId"
      WHERE e.source IN ('SYNC', 'MANUAL') AND e.stage IN ('HANDOVER_LIVE', 'HANDOVER_TEXT', 'CONSULT_BOOKED', 'QUOTE_SENT')
      UNION ALL
      SELECT ne."leadId", CASE WHEN ne.event IN ('HANDOVER_LIVE', 'HANDOVER_TEXT') THEN 'HANDOVER' ELSE ne.event::text END, ne.at, true
      FROM "LeadNoteEvent" ne JOIN l ON l.id = ne."leadId"
      WHERE ne.event IN ('HANDOVER_LIVE', 'HANDOVER_TEXT', 'CONSULT_BOOKED', 'QUOTE_SENT')
    ), first AS (
      SELECT "leadId", step, COALESCE(MIN(at) FILTER (WHERE note), MIN(at)) AS at
      FROM ev GROUP BY "leadId", step
    )
    SELECT
      (SELECT COUNT(*) FROM "Lead" WHERE "clientId" = ${clientId} AND "deletedAt" IS NULL AND "createdAt" >= ${from} AND "createdAt" < ${to}) AS leads,
      (SELECT COUNT(*) FROM first WHERE step = 'HANDOVER' AND at >= ${from} AND at < ${to}) AS handovers,
      (SELECT COUNT(*) FROM first WHERE step = 'CONSULT_BOOKED' AND at >= ${from} AND at < ${to}) AS "consultsBooked",
      (SELECT COUNT(*) FROM first WHERE step = 'QUOTE_SENT' AND at >= ${from} AND at < ${to}) AS quotes,
      (SELECT COUNT(*) FROM "Lead" l WHERE l."clientId" = ${clientId} AND l."deletedAt" IS NULL AND l.stage = 'WON' AND l."createdAt" >= ${since}
        AND ${WON_AT_SQL} >= ${from} AND ${WON_AT_SQL} < ${to}) AS won
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
