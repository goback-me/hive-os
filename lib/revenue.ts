import { prisma } from "./prisma";

// One place every screen gets revenue from, so the client card, the agency
// dashboard, the trend chart and awards always agree.
//
// Per client per month: a RevenueMonthly row (manual / Stripe) when one
// exists for that month, otherwise the sum of that month's won-lead values
// from the sheet. A lead is dated by when the app saw it become Won
// (SYNC/MANUAL event); one that arrived already won uses its opt-in date.

export const monthStartOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const key = (d: Date) => monthStartOf(d).getTime();

export type RevenueByMonth = Map<string, Map<number, number>>; // clientId → month start (ms) → amount

export async function getRevenueByMonth(clientIds?: string[]): Promise<RevenueByMonth> {
  const clientFilter = clientIds ? { clientId: { in: clientIds } } : { client: { archivedAt: null } };
  const [manual, won] = await Promise.all([
    prisma.revenueMonthly.findMany({ where: clientFilter, select: { clientId: true, month: true, amount: true } }),
    prisma.lead.findMany({
      where: { ...clientFilter, deletedAt: null, stage: "WON", value: { not: null } },
      select: {
        clientId: true,
        value: true,
        createdAt: true,
        stageEvents: { where: { stage: "WON", source: { in: ["SYNC", "MANUAL"] } }, select: { at: true }, orderBy: { at: "asc" }, take: 1 },
      },
    }),
  ]);

  const out: RevenueByMonth = new Map();
  const add = (clientId: string, month: number, amount: number) => {
    if (!out.has(clientId)) out.set(clientId, new Map());
    const m = out.get(clientId)!;
    m.set(month, (m.get(month) ?? 0) + amount);
  };

  const manualMonths = new Set(manual.map((r) => `${r.clientId}:${key(r.month)}`));
  for (const r of manual) add(r.clientId, key(r.month), Number(r.amount));
  for (const l of won) {
    const month = key(l.stageEvents[0]?.at ?? l.createdAt);
    if (!manualMonths.has(`${l.clientId}:${month}`)) add(l.clientId, month, Number(l.value));
  }
  return out;
}

export function revenueInMonth(rev: RevenueByMonth, month: Date, clientId?: string) {
  const k = key(month);
  if (clientId) return rev.get(clientId)?.get(k) ?? 0;
  let total = 0;
  for (const m of rev.values()) total += m.get(k) ?? 0;
  return total;
}

export function lifetimeRevenue(rev: RevenueByMonth, clientId: string) {
  let total = 0;
  for (const v of rev.get(clientId)?.values() ?? []) total += v;
  return total;
}
