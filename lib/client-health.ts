import type { ClientHealth } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getMonthToDateVsLast, toneFor, type KpiValues } from "./kpi";

// A client's account health, from five warning signs:
//   calls      the last 2 calls weren't held (didn't happen / not logged)
//   outcome    the last held call's outcome was "At risk"
//   kpis       most of this month's numbers are red vs the same days last month
//   updates    a lead has waited 14+ days on the client's update
//   alerts     an open DANGER data alert
// Any one → AT_RISK, 3+ → CRITICAL. Client.healthOverride (a coach's) wins,
// but both are shown.

export type HealthSigns = { calls: boolean; outcome: boolean; kpis: boolean; updates: boolean; alerts: boolean };
export const HEALTH_LABELS: Record<ClientHealth, string> = { ON_TRACK: "On track", AT_RISK: "At risk", CRITICAL: "Critical" };
const SIGN_LABELS: Record<keyof HealthSigns, string> = {
  calls: "Last 2 calls didn't happen or weren't logged",
  outcome: "Last call's outcome was At risk",
  kpis: "This month's numbers are down vs last month",
  updates: "Leads waiting 14+ days on the client's update",
  alerts: "Open danger alerts",
};

export function computeHealth(s: HealthSigns): { level: ClientHealth; reasons: string[] } {
  const reasons = (Object.keys(SIGN_LABELS) as (keyof HealthSigns)[]).filter((k) => s[k]).map((k) => SIGN_LABELS[k]);
  return { level: reasons.length >= 3 ? "CRITICAL" : reasons.length ? "AT_RISK" : "ON_TRACK", reasons };
}

// "Red" = more than half of the comparable counts are red (toneFor in lib/kpi.ts).
const KPI_KEYS = ["leads", "liveTransfers", "consultsBooked", "quotes", "sales"] as const;
export function kpisRed(current: KpiValues, previous: KpiValues) {
  const tones = KPI_KEYS.map((k) => toneFor("count", current[k], previous[k])).filter(Boolean);
  return tones.length > 0 && tones.filter((t) => t === "red").length > tones.length / 2;
}

export type Health = { level: ClientHealth; reasons: string[]; override: ClientHealth | null; effective: ClientHealth };

// "The last 2 calls weren't held": the two latest calls that were due (a
// reschedule isn't one — its replacement is), both not HELD.
export const lastTwoMissed = (statuses: string[]) => statuses.length >= 2 && statuses.slice(0, 2).every((s) => s !== "HELD");

// Health for many clients in a few queries (My Calls, Account Management, the
// portfolio). `kpisRedFor` skips the per-client KPI fetch when the caller
// already has the numbers.
export async function getClientsHealth(ids: string[], opts: { now?: Date; kpisRedFor?: Map<string, boolean> } = {}): Promise<Map<string, Health>> {
  const now = opts.now ?? new Date();
  if (!ids.length) return new Map();
  const cutoff = new Date(now.getTime() - 14 * 86_400_000);
  const [clients, calls, overdue, danger, kpis] = await Promise.all([
    prisma.client.findMany({ where: { id: { in: ids } }, select: { id: true, healthOverride: true } }),
    prisma.amCall.findMany({
      where: { clientId: { in: ids }, scheduledAt: { lte: now, gte: new Date(now.getTime() - 120 * 86_400_000) }, status: { not: "RESCHEDULED" } },
      orderBy: { scheduledAt: "desc" },
      select: { clientId: true, status: true, outcome: true },
    }),
    // Leads before a client's reporting start date don't count (lib/reporting-scope.ts).
    prisma.$queryRaw<{ clientId: string; n: bigint }[]>`
      SELECT l."clientId", COUNT(*) AS n FROM "Lead" l JOIN "Client" c ON c.id = l."clientId"
      WHERE l."clientId" IN (${Prisma.join(ids)}) AND l."deletedAt" IS NULL AND l."awaitingClientUpdate"
        AND (c."startDate" IS NULL OR l."createdAt" >= c."startDate") AND COALESCE(l."handoverAt", l."createdAt") <= ${cutoff}
      GROUP BY l."clientId"`,
    prisma.dataAlert.groupBy({ by: ["clientId"], where: { clientId: { in: ids }, status: "OPEN", severity: "DANGER" }, _count: true }),
    opts.kpisRedFor ?? Promise.all(ids.map(async (id) => [id, await getMonthToDateVsLast(id, now).then((m) => kpisRed(m.current, m.previous))] as const)).then((e) => new Map(e)),
  ]);
  const overdueSet = new Set(overdue.map((o) => o.clientId));
  const dangerSet = new Set(danger.map((d) => d.clientId));
  return new Map(
    clients.map((c) => {
      const mine = calls.filter((x) => x.clientId === c.id);
      const computed = computeHealth({
        calls: lastTwoMissed(mine.map((x) => x.status)),
        outcome: mine.find((x) => x.status === "HELD")?.outcome === "AT_RISK",
        kpis: kpis.get(c.id) ?? false,
        updates: overdueSet.has(c.id),
        alerts: dangerSet.has(c.id),
      });
      return [c.id, { ...computed, override: c.healthOverride, effective: c.healthOverride ?? computed.level }];
    })
  );
}

export const getClientHealth = async (clientId: string, now = new Date()) => (await getClientsHealth([clientId], { now })).get(clientId)!;
