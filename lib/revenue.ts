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

// One dated amount: a manual month (dated the 1st) or a won lead (dated won).
export type RevenueEntry = { clientId: string; at: Date; amount: number };

export async function getRevenueEntries(clientIds?: string[]): Promise<RevenueEntry[]> {
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

  const manualMonths = new Set(manual.map((r) => `${r.clientId}:${key(r.month)}`));
  const entries: RevenueEntry[] = manual.map((r) => ({ clientId: r.clientId, at: r.month, amount: Number(r.amount) }));
  for (const l of won) {
    const at = l.stageEvents[0]?.at ?? l.createdAt;
    if (!manualMonths.has(`${l.clientId}:${key(at)}`)) entries.push({ clientId: l.clientId, at, amount: Number(l.value) });
  }
  return entries;
}

// Sum for a date range (either bound optional). A manual month counts when
// its 1st falls in the range.
// ponytail: manual entries are monthly, so a sub-month range (e.g. last 7
// days) includes or excludes a whole manual month; lead revenue is exact.
export function revenueBetween(entries: RevenueEntry[], range: { from?: Date; to?: Date }, clientId?: string) {
  let total = 0;
  for (const e of entries) {
    if (clientId && e.clientId !== clientId) continue;
    if (range.from && e.at < range.from) continue;
    if (range.to && e.at >= range.to) continue;
    total += e.amount;
  }
  return total;
}

export type RevenueByMonth = Map<string, Map<number, number>>; // clientId → month start (ms) → amount

export async function getRevenueByMonth(clientIds?: string[]): Promise<RevenueByMonth> {
  const out: RevenueByMonth = new Map();
  for (const e of await getRevenueEntries(clientIds)) {
    if (!out.has(e.clientId)) out.set(e.clientId, new Map());
    const m = out.get(e.clientId)!;
    m.set(key(e.at), (m.get(key(e.at)) ?? 0) + e.amount);
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
