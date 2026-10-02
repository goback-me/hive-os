import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { sydneyDay } from "./sheet-parse";
import { wonAtSql } from "./milestones";

// One place every screen gets revenue from, so the client card, the agency
// dashboard, the trend chart and awards always agree.
//
// Revenue = cash collected: only Won leads count (never booked, attended or
// quoted). Per client per Sydney month: a RevenueMonthly row (manual /
// Stripe) when one exists for that month, otherwise the sum of that month's
// won-lead values from the sheet. A won lead is dated by its won date — the
// same rule as the Sales section (wonAtSql in lib/milestones.ts) — and still
// belongs to the lead's own campaign.

const key = (d: Date) => sydneyDay(d).slice(0, 7); // Sydney "2026-09"

// One dated amount: a manual month (dated the 1st) or a won lead (dated won).
export type RevenueEntry = { clientId: string; at: Date; amount: number };

// Scoped to each client's reporting start date (lib/reporting-scope.ts):
// nothing from before it counts anywhere — not a won lead that came in or
// closed before it, nor a manual month before its month.
export async function getRevenueEntries(clientIds?: string[]): Promise<RevenueEntry[]> {
  if (clientIds && !clientIds.length) return [];
  const clientFilter = clientIds ? { clientId: { in: clientIds } } : { client: { archivedAt: null } };
  const clientSql = clientIds
    ? Prisma.sql`l."clientId" IN (${Prisma.join(clientIds)})`
    : Prisma.sql`l."clientId" IN (SELECT id FROM "Client" WHERE "archivedAt" IS NULL)`;
  const [manualRows, won, starts] = await Promise.all([
    prisma.revenueMonthly.findMany({ where: clientFilter, select: { clientId: true, month: true, amount: true } }),
    prisma.$queryRaw<{ clientId: string; value: unknown; at: Date }[]>`
      SELECT * FROM (
        SELECT l."clientId", l.value, ${wonAtSql()} AS at, c."startDate"
        FROM "Lead" l JOIN "Client" c ON c.id = l."clientId"
        WHERE ${clientSql} AND l."deletedAt" IS NULL AND l.stage = 'WON' AND l.value IS NOT NULL
          AND (c."startDate" IS NULL OR l."createdAt" >= c."startDate")
      ) w
      WHERE w."startDate" IS NULL OR w.at >= w."startDate"
    `,
    prisma.client.findMany({ where: clientIds ? { id: { in: clientIds } } : { archivedAt: null }, select: { id: true, startDate: true } }),
  ]);

  const startMonth = new Map(starts.map((c) => [c.id, c.startDate ? key(c.startDate) : null]));
  const manual = manualRows.filter((r) => {
    const start = startMonth.get(r.clientId);
    return !start || key(r.month) >= start;
  });
  const manualMonths = new Set(manual.map((r) => `${r.clientId}:${key(r.month)}`));
  const entries: RevenueEntry[] = manual.map((r) => ({ clientId: r.clientId, at: r.month, amount: Number(r.amount) }));
  for (const l of won) {
    if (!manualMonths.has(`${l.clientId}:${key(l.at)}`)) entries.push({ clientId: l.clientId, at: l.at, amount: Number(l.value) });
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

export type RevenueByMonth = Map<string, Map<string, number>>; // clientId → Sydney month ("2026-09") → amount

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
