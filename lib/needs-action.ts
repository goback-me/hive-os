import { unstable_cache } from "next/cache";
import { prisma } from "./prisma";
import { getRevenueByMonth, revenueInMonth } from "./revenue";
import { getMonthToDateVsLast } from "./kpi";
import { overdueLeads } from "./reminders";

const RENEWAL_WINDOW_DAYS = 14;
const NO_CALL_DAYS = 10;
// Live transfers this month vs the same days last month: flag a drop of
// more than 10%, once last month had at least this many (1 → 0 isn't a trend).
const LIVE_DROP = 0.1;
const LIVE_MIN_BASE = 2;

export type NeedsActionItem = {
  id: string;
  clientId: string;
  clientSlug: string;
  type: string;
  severity: "danger" | "success" | "muted";
  title: string;
  description: string;
  amount?: number;
  daysDelta?: number;
};

const SEVERITY_ORDER: Record<NeedsActionItem["severity"], number> = { danger: 0, muted: 1, success: 2 };

function daysBetween(a: Date, b: Date) {
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

// Computed on read from live data (no cache table, nothing seeded) — most
// urgent first. Each rule loads its rows for every client at once; only the
// live-transfer and overdue-update checks run per client.
export async function computeNeedsAction(now = new Date()): Promise<NeedsActionItem[]> {
  const clients = await prisma.client.findMany({ where: { isActive: true, archivedAt: null }, select: { id: true, name: true, slug: true } });
  const ids = clients.map((c) => c.id);
  const items: Omit<NeedsActionItem, "id" | "clientSlug">[] = [];
  const name = new Map(clients.map((c) => [c.id, c.name]));

  const [payments, expired, renewals, contacts, missedSessions, dangerAlerts] = await Promise.all([
    prisma.payment.findMany({ where: { clientId: { in: ids }, status: { in: ["PENDING", "OVERDUE"] }, dueDate: { lt: now } } }),
    prisma.contract.findMany({ where: { clientId: { in: ids }, endDate: { lt: now }, status: { not: "CANCELLED" } } }),
    prisma.contract.findMany({
      where: { clientId: { in: ids }, endDate: { gte: now, lte: new Date(now.getTime() + RENEWAL_WINDOW_DAYS * 86400000) }, status: { not: "CANCELLED" } },
    }),
    prisma.contactLog.groupBy({ by: ["clientId"], where: { clientId: { in: ids } }, _max: { contactedAt: true } }),
    prisma.session.findMany({ where: { clientId: { in: ids }, status: "SCHEDULED", scheduledAt: { lt: now } } }),
    prisma.dataAlert.findMany({ where: { clientId: { in: ids }, status: "OPEN", severity: "DANGER" }, select: { clientId: true, title: true } }),
  ]);

  for (const p of payments) {
    const overdueDays = daysBetween(now, p.dueDate);
    items.push({ clientId: p.clientId, type: "overdue_payment", severity: "danger", title: name.get(p.clientId)!, description: `${p.label} — $${p.amountDue} (${overdueDays}d overdue)`, amount: Number(p.amountDue), daysDelta: -overdueDays });
  }
  for (const c of expired) {
    const expiredDays = daysBetween(now, c.endDate);
    items.push({ clientId: c.clientId, type: "contract_expired", severity: "danger", title: name.get(c.clientId)!, description: `Contract expired ${expiredDays}d ago — renew`, daysDelta: -expiredDays });
  }
  for (const c of renewals) {
    const daysUntil = daysBetween(c.endDate, now);
    items.push({ clientId: c.clientId, type: "renewal_upcoming", severity: "success", title: name.get(c.clientId)!, description: daysUntil === 0 ? "Renewal expires today" : `Renewal in ${daysUntil}d`, daysDelta: daysUntil });
  }
  // Account-manager contact (ContactLog — logged on each client's page).
  const lastContact = new Map(contacts.map((c) => [c.clientId, c._max.contactedAt]));
  for (const c of clients) {
    const last = lastContact.get(c.id);
    const since = last ? daysBetween(now, last) : null;
    if (since == null || since >= NO_CALL_DAYS) {
      items.push({ clientId: c.id, type: "no_call", severity: "muted", title: c.name, description: since == null ? "No calls logged yet" : `No call in ${since}+ days` });
    }
  }
  for (const s of missedSessions) {
    items.push({ clientId: s.clientId, type: "missed_session", severity: "danger", title: name.get(s.clientId)!, description: `Session on ${s.scheduledAt.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney" })} was never marked complete` });
  }
  // Serious data problems (lib/data-health.ts) — one item per client.
  const dangerBy = new Map<string, string[]>();
  for (const a of dangerAlerts) dangerBy.set(a.clientId, [...(dangerBy.get(a.clientId) ?? []), a.title]);
  for (const [clientId, titles] of dangerBy) {
    items.push({ clientId, type: "data_alert", severity: "danger", title: name.get(clientId)!, description: titles.length === 1 ? titles[0] : `${titles.length} data problems — ${titles[0]}` });
  }

  for (const c of clients) {
    const [mtd, overdue] = await Promise.all([getMonthToDateVsLast(c.id, now).catch(() => null), overdueLeads(c.id, now)]);
    if (mtd && mtd.previous.liveTransfers >= LIVE_MIN_BASE && mtd.current.liveTransfers < mtd.previous.liveTransfers * (1 - LIVE_DROP)) {
      const drop = Math.round((1 - mtd.current.liveTransfers / mtd.previous.liveTransfers) * 100);
      items.push({ clientId: c.id, type: "live_transfers_down", severity: "danger", title: c.name, description: `Live transfers down ${drop}% (${mtd.current.liveTransfers} vs ${mtd.previous.liveTransfers} same days last month)` });
    }
    if (overdue.length) {
      items.push({ clientId: c.id, type: "client_updates_overdue", severity: "muted", title: c.name, description: `${overdue.length} lead${overdue.length === 1 ? "" : "s"} waiting 7+ days on the client's update` });
    }
  }

  const slugById = new Map(clients.map((c) => [c.id, c.slug]));
  return items
    .map((i, n) => ({ ...i, id: `${i.clientId}:${i.type}:${n}`, clientSlug: slugById.get(i.clientId)! }))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

// Dashboard read path — recomputed at most every 5 minutes.
export const getNeedsAction = unstable_cache(() => computeNeedsAction(), ["needs-action-v2"], { revalidate: 300 });

// Main dashboard page.tsx reads revenueThisMonth/activeClients/totalClients
// from this — they keep their exact original meaning from the pre-merge
// coaching app. totalAdSpend/avgRoas are Hive OS additions,
// available once the page's KPI cards are extended to show them.
export async function getDashboardKpis() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [activeClients, totalClients, revenue, spendAgg] = await Promise.all([
    prisma.client.count({ where: { isActive: true, archivedAt: null } }),
    prisma.client.count({ where: { archivedAt: null } }),
    // Same source as the client pages (lib/revenue.ts) — keeps this KPI equal
    // to the sum of every client's "Revenue this month" card.
    getRevenueByMonth(),
    prisma.adSpendDaily.aggregate({
      _sum: { spend: true },
      where: { date: { gte: monthStart } },
    }),
  ]);

  const revenueThisMonth = revenueInMonth(revenue, monthStart);
  const totalAdSpend = Number(spendAgg._sum.spend ?? 0);

  return {
    activeClients,
    totalClients,
    revenueThisMonth,
    totalAdSpend,
    avgRoas: totalAdSpend > 0 ? revenueThisMonth / totalAdSpend : 0,
  };
}
