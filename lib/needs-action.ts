import { unstable_cache } from "next/cache";
import { prisma } from "./prisma";
import { getRevenueByMonth, revenueInMonth } from "./revenue";

const UPCOMING_SESSION_WINDOW_DAYS = 3;
const NO_CONTACT_DAYS = 14;
// Hive OS thresholds — kept distinct from the original coaching app's ones above since
// they drive different checks (contract renewal window, contact-log gap).
const RENEWAL_WINDOW_DAYS = 14;
const NO_CALL_DAYS = 10;
// The cron syncs every 5 min, so an hour without a good sync means it's broken.
const SYNC_STALE_MS = 60 * 60 * 1000;

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

// Computed on read (no cache table) — merges the original coaching app's
// session/onboarding checks with Hive OS's contract/contact-log/lead-sync
// checks, since a client can trip either set of rules. Most urgent first.
// ponytail: a few queries per client, sequential — fine for tens of clients
// behind the 5-min cache below; batch per rule if the client list grows large.
export async function computeNeedsAction(): Promise<NeedsActionItem[]> {
  const now = new Date();
  const clients = await prisma.client.findMany({ where: { isActive: true, archivedAt: null }, include: { clientSheet: true } });

  const items: Omit<NeedsActionItem, "id" | "clientSlug">[] = [];

  for (const client of clients) {
    // ── Lead sheet sync health ─────────────────────────────────────────
    const sheet = client.clientSheet;
    if (sheet) {
      if (sheet.lastSyncError) {
        items.push({
          clientId: client.id,
          type: "sync_failing",
          severity: "danger",
          title: client.name,
          description: `Lead sync failing: ${sheet.lastSyncError.slice(0, 120)}`,
        });
      } else if (!sheet.lastSyncedAt || now.getTime() - sheet.lastSyncedAt.getTime() > SYNC_STALE_MS) {
        const hours = sheet.lastSyncedAt ? Math.floor((now.getTime() - sheet.lastSyncedAt.getTime()) / 3600000) : null;
        items.push({
          clientId: client.id,
          type: "sync_stale",
          severity: "danger",
          title: client.name,
          description: hours == null ? "Lead sheet has never synced" : `Leads not synced in ${hours}h — check the cron`,
        });
      }
    }

    const overduePayments = await prisma.payment.findMany({
      where: { clientId: client.id, status: { in: ["PENDING", "OVERDUE"] }, dueDate: { lt: now } },
    });
    for (const p of overduePayments) {
      const overdueDays = daysBetween(now, p.dueDate);
      items.push({
        clientId: client.id,
        type: "overdue_payment",
        severity: "danger",
        title: client.name,
        description: `${p.label} — $${p.amountDue} (${overdueDays}d overdue)`,
        amount: Number(p.amountDue),
        daysDelta: -overdueDays,
      });
    }

    // ── Hive OS — contracts ────────────────────────────────────────────
    const expiredContracts = await prisma.contract.findMany({
      where: { clientId: client.id, endDate: { lt: now }, status: { not: "CANCELLED" } },
    });
    for (const c of expiredContracts) {
      const expiredDays = daysBetween(now, c.endDate);
      items.push({
        clientId: client.id,
        type: "contract_expired",
        severity: "danger",
        title: client.name,
        description: `Contract expired ${expiredDays}d ago — renew`,
        daysDelta: -expiredDays,
      });
    }

    const upcomingContracts = await prisma.contract.findMany({
      where: {
        clientId: client.id,
        endDate: { gte: now, lte: new Date(now.getTime() + RENEWAL_WINDOW_DAYS * 86400000) },
        status: { not: "CANCELLED" },
      },
    });
    for (const c of upcomingContracts) {
      const daysUntil = daysBetween(c.endDate, now);
      items.push({
        clientId: client.id,
        type: "renewal_upcoming",
        severity: "success",
        title: client.name,
        description: daysUntil === 0 ? "Renewal expires today" : `Renewal in ${daysUntil}d`,
        daysDelta: daysUntil,
      });
    }

    // ── Hive OS — contact log (separate signal from the original coaching app's session-
    // based "no_contact" check below; a client can trip either or both) ──
    const lastContact = await prisma.contactLog.findFirst({
      where: { clientId: client.id },
      orderBy: { contactedAt: "desc" },
    });
    if (lastContact) {
      const sinceLastContact = daysBetween(now, lastContact.contactedAt);
      if (sinceLastContact >= NO_CALL_DAYS) {
        items.push({
          clientId: client.id,
          type: "no_call",
          severity: "muted",
          title: client.name,
          description: `No call in ${sinceLastContact}+ days`,
        });
      }
    }

    // ── Original coaching app — sessions / onboarding ────────────────────────────────
    const missedSessions = await prisma.session.findMany({
      where: { clientId: client.id, status: "SCHEDULED", scheduledAt: { lt: now } },
    });
    for (const s of missedSessions) {
      items.push({
        clientId: client.id,
        type: "missed_session",
        severity: "danger",
        title: client.name,
        description: `Session on ${s.scheduledAt.toLocaleDateString()} was never marked complete`,
      });
    }

    const upcoming = await prisma.session.findFirst({
      where: {
        clientId: client.id,
        status: "SCHEDULED",
        scheduledAt: { gte: now, lte: new Date(now.getTime() + UPCOMING_SESSION_WINDOW_DAYS * 86400000) },
      },
      orderBy: { scheduledAt: "asc" },
    });
    if (upcoming) {
      const daysUntil = daysBetween(upcoming.scheduledAt, now);
      items.push({
        clientId: client.id,
        type: "upcoming_session",
        severity: "success",
        title: client.name,
        description: daysUntil === 0 ? "Session today" : `Session in ${daysUntil}d`,
      });
    }

    const lastSession = await prisma.session.findFirst({
      where: { clientId: client.id, status: "COMPLETED" },
      orderBy: { scheduledAt: "desc" },
    });
    const sinceLast = lastSession ? daysBetween(now, lastSession.scheduledAt) : Infinity;
    if (sinceLast >= NO_CONTACT_DAYS) {
      items.push({
        clientId: client.id,
        type: "no_contact",
        severity: "muted",
        title: client.name,
        description: lastSession ? `No session in ${sinceLast}+ days` : "No sessions logged yet",
      });
    }
    const totalSteps = await prisma.onboardingStepTemplate.count();
    if (totalSteps > 0) {
      const completedSteps = await prisma.clientOnboardingStep.count({
        where: { clientId: client.id, completedAt: { not: null } },
      });
      if (completedSteps < totalSteps) {
        items.push({
          clientId: client.id,
          type: "onboarding_incomplete",
          severity: "muted",
          title: client.name,
          description: `Onboarding ${completedSteps}/${totalSteps} steps complete`,
        });
      }
    }
  }

  const slugById = new Map(clients.map((c) => [c.id, c.slug]));
  return items
    .map((i, n) => ({ ...i, id: `${i.clientId}:${i.type}:${n}`, clientSlug: slugById.get(i.clientId)! }))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

// Dashboard read path — recomputed at most every 5 minutes.
export const getNeedsAction = unstable_cache(computeNeedsAction, ["needs-action"], { revalidate: 300 });

// Main dashboard page.tsx (unchanged UI) destructures revenueThisMonth/
// activeClients/totalClients/sessionsThisMonth from this — those four keep
// their exact original meaning from the pre-merge coaching app. totalAdSpend/avgRoas are Hive OS additions,
// available once the page's KPI cards are extended to show them.
export async function getDashboardKpis() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [activeClients, totalClients, revenue, sessionsThisMonth, spendAgg] = await Promise.all([
    prisma.client.count({ where: { isActive: true, archivedAt: null } }),
    prisma.client.count({ where: { archivedAt: null } }),
    // Same source as the client pages (lib/revenue.ts) — keeps this KPI equal
    // to the sum of every client's "Revenue this month" card.
    getRevenueByMonth(),
    prisma.session.count({
      where: { status: "COMPLETED", scheduledAt: { gte: monthStart } },
    }),
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
    sessionsThisMonth,
    totalAdSpend,
    avgRoas: totalAdSpend > 0 ? revenueThisMonth / totalAdSpend : 0,
  };
}
