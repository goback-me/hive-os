import type { MeetingStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { weekStart, sydneyDay } from "./sheet-parse";
import { getMonthToDateVsLast, toneFor } from "./kpi";
import { getClientsHealth, kpisRed, type Health } from "./client-health";
import { OUTCOME_LABELS, slotLabel } from "./am-calls";

// Account Management (app/(app)/account-management): how the account
// managers' calls are going over a date range. "Due" = calls whose time has
// come (held, rescheduled, didn't happen, or still not logged).

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type StatCall = { clientId: string; callPersonId: string | null; scheduledAt: Date; status: MeetingStatus; loggedAt: Date | null; emailedToClientAt: Date | null; dayAfterAt: Date | null };
export type CallStats = { due: number; held: number; rescheduled: number; notHeld: number; notLogged: number; emailed: number; onTimePct: number | null; avgDaysToLog: number | null };

// Logged on time = within 24h of the day-after reminder (or before it went).
export const loggedOnTime = (c: Pick<StatCall, "scheduledAt" | "loggedAt" | "dayAfterAt">) =>
  !!c.loggedAt && c.loggedAt.getTime() <= (c.dayAfterAt ?? new Date(c.scheduledAt.getTime() + DAY)).getTime() + DAY;

export function callStats(calls: StatCall[], now: Date): CallStats {
  const due = calls.filter((c) => c.scheduledAt <= now);
  const logged = due.filter((c) => (c.status === "HELD" || c.status === "NOT_HELD") && c.loggedAt);
  const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : null);
  return {
    due: due.length,
    held: due.filter((c) => c.status === "HELD").length,
    rescheduled: due.filter((c) => c.status === "RESCHEDULED").length,
    notHeld: due.filter((c) => c.status === "NOT_HELD").length,
    notLogged: due.filter((c) => c.status === "PENDING").length,
    emailed: calls.filter((c) => c.emailedToClientAt).length,
    onTimePct: pct(logged.filter(loggedOnTime).length, logged.length),
    avgDaysToLog: logged.length ? Math.round((logged.reduce((s, c) => s + (c.loggedAt!.getTime() - c.scheduledAt.getTime()), 0) / logged.length / DAY) * 10) / 10 : null,
  };
}

// One week's cell in the weekly grid: what happened to the client's call(s)
// that week, the most telling first.
export type WeekCell = "HELD" | "NOT_HELD" | "NOT_LOGGED" | "RESCHEDULED" | "UPCOMING" | "NONE";
export function weekCell(calls: { status: MeetingStatus; scheduledAt: Date }[], now: Date): WeekCell {
  const has = (s: MeetingStatus, past?: boolean) => calls.some((c) => c.status === s && (past === undefined || (c.scheduledAt <= now) === past));
  if (has("HELD")) return "HELD";
  if (has("NOT_HELD")) return "NOT_HELD";
  if (has("PENDING", true)) return "NOT_LOGGED";
  if (has("RESCHEDULED")) return "RESCHEDULED";
  if (has("PENDING", false)) return "UPCOMING";
  return "NONE";
}

// ↑ more of this month's numbers up than down vs the same days last month, ↓ the reverse.
export function kpiTrend(tones: (string | null)[]): "up" | "down" | "flat" {
  const up = tones.filter((t) => t === "green").length;
  const down = tones.filter((t) => t === "red").length;
  return up > down ? "up" : down > up ? "down" : "flat";
}

export type AmClientRow = {
  id: string;
  name: string;
  slug: string;
  amId: string | null;
  am: string | null;
  slot: string;
  next: { id: string; at: string } | null;
  last: { at: string; status: MeetingStatus } | null;
  outcome: string | null;
  health: Health;
  comment: string | null; // latest internal note
  awaiting: number;
  trend: "up" | "down" | "flat";
};
export type AmPerson = { id: string; name: string; clients: number; atRisk: number; stats: CallStats; weekly: { week: string; held: number }[] };
export type AccountManagementData = {
  cards: CallStats & { atRisk: number; critical: number; perAm: { name: string; held: number }[] };
  clients: AmClientRow[];
  people: AmPerson[];
  grid: { weeks: string[]; rows: { clientId: string; name: string; cells: { cell: WeekCell; callId: string | null }[] }[] };
};

const COUNT_KEYS = ["leads", "liveTransfers", "consultsBooked", "quotes", "sales"] as const;

// Everything the page shows, for the clients in scope (`am` = one account
// manager's, or null = all) over `range`.
export async function getAccountManagement(opts: { am: string | null; clientIds?: string[]; range: { from?: Date; to?: Date }; now?: Date }): Promise<AccountManagementData> {
  const now = opts.now ?? new Date();
  const to = opts.range.to && opts.range.to < now ? opts.range.to : now;
  const clients = await prisma.client.findMany({
    where: { archivedAt: null, ...(opts.am ? { accountManagerId: opts.am } : {}), ...(opts.clientIds ? { id: { in: opts.clientIds } } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true, accountManagerId: true, accountManager: { select: { name: true } }, callDay: true, callTime: true, callFrequency: true },
  });
  const ids = clients.map((c) => c.id);
  const gridFrom = new Date(weekStart(now).getTime() - 7 * 7 * DAY);
  const [rangeCalls, gridCalls, nextCalls, lastCalls, comments, awaiting, months, team] = await Promise.all([
    prisma.amCall.findMany({
      where: { clientId: { in: ids }, scheduledAt: { ...(opts.range.from ? { gte: opts.range.from } : {}), lt: to } },
      select: { clientId: true, callPersonId: true, scheduledAt: true, status: true, loggedAt: true, emailedToClientAt: true, reminders: { where: { kind: "DAY_AFTER" }, select: { sentAt: true } } },
    }),
    prisma.amCall.findMany({ where: { clientId: { in: ids }, scheduledAt: { gte: gridFrom, lt: new Date(weekStart(now).getTime() + 7 * DAY + 2 * HOUR) } }, select: { id: true, clientId: true, scheduledAt: true, status: true } }),
    prisma.amCall.findMany({ where: { clientId: { in: ids }, status: "PENDING", scheduledAt: { gt: now } }, orderBy: { scheduledAt: "asc" }, distinct: ["clientId"], select: { id: true, clientId: true, scheduledAt: true } }),
    prisma.amCall.findMany({ where: { clientId: { in: ids }, scheduledAt: { lte: now }, status: { not: "RESCHEDULED" } }, orderBy: { scheduledAt: "desc" }, distinct: ["clientId"], select: { clientId: true, scheduledAt: true, status: true, outcome: true } }),
    prisma.amCall.findMany({ where: { clientId: { in: ids }, internalNotes: { not: null } }, orderBy: { scheduledAt: "desc" }, distinct: ["clientId"], select: { clientId: true, internalNotes: true } }),
    prisma.lead.groupBy({ by: ["clientId"], where: { clientId: { in: ids }, deletedAt: null, awaitingClientUpdate: true }, _count: true }),
    Promise.all(ids.map(async (id) => [id, await getMonthToDateVsLast(id, now)] as const)).then((e) => new Map(e)),
    prisma.user.findMany({ where: { role: { in: ["ADMIN", "COACH", "AGENT"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const health = await getClientsHealth(ids, { now, kpisRedFor: new Map(ids.map((id) => [id, kpisRed(months.get(id)!.current, months.get(id)!.previous)])) });
  const stat = rangeCalls.map((c): StatCall => ({ ...c, dayAfterAt: c.reminders[0]?.sentAt ?? null }));

  const clientRows: AmClientRow[] = clients.map((c) => {
    const next = nextCalls.find((n) => n.clientId === c.id);
    const last = lastCalls.find((l) => l.clientId === c.id);
    const m = months.get(c.id)!;
    return {
      id: c.id,
      name: c.name,
      slug: c.slug,
      amId: c.accountManagerId,
      am: c.accountManager?.name ?? null,
      slot: c.accountManagerId ? slotLabel(c) : "—",
      next: next ? { id: next.id, at: next.scheduledAt.toISOString() } : null,
      last: last ? { at: last.scheduledAt.toISOString(), status: last.status } : null,
      outcome: last?.outcome ? OUTCOME_LABELS[last.outcome] : null,
      health: health.get(c.id)!,
      comment: comments.find((x) => x.clientId === c.id)?.internalNotes ?? null,
      awaiting: awaiting.find((a) => a.clientId === c.id)?._count ?? 0,
      trend: kpiTrend(COUNT_KEYS.map((k) => toneFor("count", m.current[k], m.previous[k]))),
    };
  });

  // Weekly buckets (Mon, Sydney) across the range — the most recent 26.
  const weekKeys: string[] = [];
  const firstWeek = weekStart(opts.range.from ?? (stat.length ? new Date(Math.min(...stat.map((c) => c.scheduledAt.getTime()))) : now));
  for (let w = weekStart(to); w >= firstWeek && weekKeys.length < 26; w = weekStart(new Date(w.getTime() - 3 * DAY))) weekKeys.unshift(sydneyDay(w));
  const weekOf = (d: Date) => sydneyDay(weekStart(d));

  const people: AmPerson[] = team
    .map((u) => {
      const mine = stat.filter((c) => c.callPersonId === u.id);
      const theirClients = clientRows.filter((c) => c.amId === u.id);
      return {
        id: u.id,
        name: u.name,
        clients: theirClients.length,
        atRisk: theirClients.filter((c) => c.health.effective !== "ON_TRACK").length,
        stats: callStats(mine, now),
        weekly: weekKeys.map((week) => ({ week, held: mine.filter((c) => c.status === "HELD" && weekOf(c.scheduledAt) === week).length })),
      };
    })
    .filter((p) => p.clients || p.stats.due);

  const gridWeeks = Array.from({ length: 8 }, (_, i) => sydneyDay(new Date(gridFrom.getTime() + i * 7 * DAY + 12 * HOUR)));
  const all = callStats(stat, now);
  return {
    cards: {
      ...all,
      atRisk: clientRows.filter((c) => c.health.effective === "AT_RISK").length,
      critical: clientRows.filter((c) => c.health.effective === "CRITICAL").length,
      perAm: people.map((p) => ({ name: p.name, held: p.stats.held })).filter((p) => p.held),
    },
    clients: clientRows,
    people,
    grid: {
      weeks: gridWeeks,
      rows: clientRows.map((c) => ({
        clientId: c.id,
        name: c.name,
        cells: gridWeeks.map((week) => {
          const calls = gridCalls.filter((x) => x.clientId === c.id && weekOf(x.scheduledAt) === week);
          return { cell: weekCell(calls, now), callId: calls.find((x) => x.status !== "RESCHEDULED")?.id ?? calls[0]?.id ?? null };
        }),
      })),
    },
  };
}

// The client table as CSV (the page's Export).
export function clientsCsv(rows: AmClientRow[]) {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
  const head = ["Client", "Account manager", "Regular call", "Next call", "Last call", "Last call status", "Outcome", "Health", "Computed health", "Latest internal note", "Leads waiting on client", "KPI trend"];
  const lines = rows.map((r) =>
    [r.name, r.am, r.slot, when(r.next?.at), when(r.last?.at), r.last?.status, r.outcome, r.health.effective, r.health.level, r.comment, r.awaiting, r.trend].map(esc).join(",")
  );
  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}
