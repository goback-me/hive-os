import { prisma } from "./prisma";
import { wonAtSql } from "./milestones";
import { SHEET_TZ } from "./sheet-parse";

// Leads tab headline: won-lead revenue over the tab's date range, plus a
// daily chart of leads coming in and deals closing. Days are Sydney calendar
// days.

export type WinsDay = { date: string; leads: number; wins: number[] }; // wins = each closed deal's value
export type LeadWins = { days: WinsDay[]; revenue: number; won: number; leads: number };

const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: SHEET_TZ }).format(d); // "2026-09-29"
const addDays = (key: string, n: number) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

// Scoped to the client's reporting start date: earlier leads never count, and
// Maximum (no range.from) starts at the start date, else the first lead.
export async function getLeadWins(clientId: string, range: { from?: Date; to?: Date }, now = new Date()): Promise<LeadWins | null> {
  const since = (await prisma.client.findUnique({ where: { id: clientId }, select: { startDate: true } }))?.startDate ?? new Date(0);
  let from = range.from && range.from > since ? range.from : since;
  if (from.getTime() === 0) {
    const first = await prisma.lead.findFirst({ where: { clientId, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
    if (!first) return null;
    from = first.createdAt;
  }
  const to = range.to && range.to < now ? range.to : now;
  if (from >= to) return { days: [], revenue: 0, won: 0, leads: 0 };
  // ponytail: one bar per day, uncapped — a multi-year Maximum gets thin bars; bucket by week if that bites.
  const keys: string[] = [];
  for (let k = dayKey(from), last = dayKey(new Date(to.getTime() - 1)); k <= last; k = addDays(k, 1)) keys.push(k);

  const [leads, wins] = await Promise.all([
    prisma.lead.findMany({ where: { clientId, deletedAt: null, createdAt: { gte: from, lt: to } }, select: { createdAt: true } }),
    prisma.$queryRaw<{ value: unknown; closed_at: Date }[]>`
      SELECT l.value, ${wonAtSql()} AS closed_at
      FROM "Lead" l
      WHERE l."clientId" = ${clientId} AND l."deletedAt" IS NULL AND l.stage = 'WON' AND l."createdAt" >= ${since}
    `,
  ]);

  const days = new Map(keys.map((k) => [k, { date: k, leads: 0, wins: [] as number[] }]));
  for (const l of leads) {
    const d = days.get(dayKey(l.createdAt));
    if (d) d.leads++;
  }
  for (const w of wins) {
    const d = days.get(dayKey(w.closed_at));
    if (d) d.wins.push(Number(w.value ?? 0));
  }

  const all = Array.from(days.values());
  const closed = all.flatMap((d) => d.wins);
  return {
    days: all,
    revenue: closed.reduce((a, b) => a + b, 0),
    won: closed.length,
    leads: leads.length,
  };
}
