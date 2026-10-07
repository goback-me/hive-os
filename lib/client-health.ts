import type { ClientHealth } from "@prisma/client";
import { prisma } from "./prisma";
import { getMonthToDateVsLast, toneFor, type KpiValues } from "./kpi";

// A client's account health, from five warning signs:
//   calls      the last 2 calls weren't held (didn't happen / not logged)
//   outcome    the last held call's outcome was "At risk"
//   kpis       most of this month's numbers are red vs the same days last month
//   updates    a lead has waited 14+ days on the client's update
//   alerts     an open DANGER data alert
// Any one → AT_RISK, 3+ → CRITICAL. Client.health (a coach's override) wins,
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

export async function getClientHealth(clientId: string, now = new Date()) {
  const cutoff = new Date(now.getTime() - 14 * 86_400_000);
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { health: true, startDate: true } });
  const [lastCalls, lastHeld, month, overdue, danger] = await Promise.all([
    prisma.weeklyMeeting.findMany({ where: { clientId, weekOf: { lte: now } }, orderBy: { weekOf: "desc" }, take: 2, select: { status: true } }),
    prisma.weeklyMeeting.findFirst({ where: { clientId, status: "HELD" }, orderBy: { weekOf: "desc" }, select: { clientMood: true } }),
    getMonthToDateVsLast(clientId, now),
    prisma.lead.count({
      where: {
        clientId,
        deletedAt: null,
        awaitingClientUpdate: true,
        // Leads before the reporting start date don't count (lib/reporting-scope.ts).
        ...(client.startDate ? { createdAt: { gte: client.startDate } } : {}),
        OR: [{ handoverAt: { lte: cutoff } }, { handoverAt: null, createdAt: { lte: cutoff } }],
      },
    }),
    prisma.dataAlert.count({ where: { clientId, status: "OPEN", severity: "DANGER" } }),
  ]);
  const computed = computeHealth({
    calls: lastCalls.length === 2 && lastCalls.every((c) => c.status !== "HELD"),
    outcome: lastHeld?.clientMood === "AT_RISK",
    kpis: kpisRed(month.current, month.previous),
    updates: overdue > 0,
    alerts: danger > 0,
  });
  return { ...computed, override: client.health, effective: client.health ?? computed.level };
}
