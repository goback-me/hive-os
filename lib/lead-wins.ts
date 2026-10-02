import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { SHEET_TZ, sydneyLocalToDate } from "./sheet-parse";

// Leads tab headline: won-lead revenue over a 60-day window, plus a daily
// chart of leads coming in and deals closing. "first" = the client's first
// 60 days (from their first lead), "last" = the 60 days up to today.
// Days are Sydney calendar days.

export const WIN_WINDOW_DAYS = 60;
export type WinsWindow = "first" | "last";
export type WinsDay = { date: string; leads: number; wins: number[] }; // wins = each closed deal's value
export type LeadWins = { window: WinsWindow; days: WinsDay[]; revenue: number; won: number; leads: number };

const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: SHEET_TZ }).format(d); // "2026-09-29"
const addDays = (key: string, n: number) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const startOf = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return sydneyLocalToDate(y, m, d)!;
};

// A win's date: when the app saw it turn Won (sync or manual change). A lead
// that was already Won when first imported has no real close time, so its
// last dated note stands in, else its opt-in date. Needs the lead aliased `l`.
// Shared with the Sales section (lib/sales.ts) so both date a sale the same.
export const WON_AT_SQL = Prisma.sql`COALESCE(
  (SELECT MIN(e.at) FROM "LeadStageEvent" e WHERE e."leadId" = l.id AND e.stage = 'WON' AND e.source IN ('SYNC', 'MANUAL')),
  (SELECT MAX(ne.at) FROM "LeadNoteEvent" ne WHERE ne."leadId" = l.id),
  l."createdAt"
)`;

export async function getLeadWins(clientId: string, window: WinsWindow, now = new Date()): Promise<LeadWins | null> {
  let start: string;
  if (window === "first") {
    const first = await prisma.lead.findFirst({ where: { clientId, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
    if (!first) return null;
    start = dayKey(first.createdAt);
  } else {
    start = addDays(dayKey(now), -(WIN_WINDOW_DAYS - 1));
  }
  const keys = Array.from({ length: WIN_WINDOW_DAYS }, (_, i) => addDays(start, i));
  const from = startOf(keys[0]);
  const to = startOf(addDays(keys[keys.length - 1], 1));

  const [leads, wins] = await Promise.all([
    prisma.lead.findMany({ where: { clientId, deletedAt: null, createdAt: { gte: from, lt: to } }, select: { createdAt: true } }),
    prisma.$queryRaw<{ value: unknown; closed_at: Date }[]>`
      SELECT l.value, ${WON_AT_SQL} AS closed_at
      FROM "Lead" l
      WHERE l."clientId" = ${clientId} AND l."deletedAt" IS NULL AND l.stage = 'WON'
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
    window,
    days: all.filter((d) => startOf(d.date).getTime() <= now.getTime()), // a new client's first 60 days may still be running
    revenue: closed.reduce((a, b) => a + b, 0),
    won: closed.length,
    leads: leads.length,
  };
}
