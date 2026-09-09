import { prisma } from "./prisma";

const UPCOMING_SESSION_WINDOW_DAYS = 3;
const NO_CONTACT_DAYS = 14;
// Hive OS thresholds — kept distinct from the original coaching app's ones above since
// they drive different checks (contract renewal window, contact-log gap).
const RENEWAL_WINDOW_DAYS = 14;
const NO_CALL_DAYS = 10;

function daysBetween(a: Date, b: Date) {
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

// Wipes and rebuilds the NeedsActionItem cache table. Merges the original coaching app's
// session/onboarding-based checks with Hive OS's contract/contact-log
// checks — both feed the same table and the same dashboard "Needs Action"
// list, since a client can trip either agency's rules.
export async function computeNeedsAction() {
  const now = new Date();
  const clients = await prisma.client.findMany({ where: { isActive: true, archivedAt: null } });

  const items: {
    clientId: string;
    type: string;
    severity: string;
    title: string;
    description: string;
    amount?: number;
    daysDelta?: number;
  }[] = [];

  for (const client of clients) {
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

  await prisma.$transaction([
    prisma.needsActionItem.deleteMany({}),
    prisma.needsActionItem.createMany({
      data: items.map((i) => ({
        clientId: i.clientId,
        type: i.type,
        severity: i.severity,
        title: i.title,
        description: i.description,
        amount: i.amount,
        daysDelta: i.daysDelta,
      })),
    }),
  ]);

  return items.length;
}

// Main dashboard page.tsx (unchanged UI) destructures revenueThisMonth/
// activeClients/totalClients/sessionsThisMonth from this — those four keep
// their exact original meaning from the pre-merge coaching app. totalAdSpend/avgRoas are Hive OS additions,
// available once the page's KPI cards are extended to show them.
export async function getDashboardKpis() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [activeClients, totalClients, revenueAgg, sessionsThisMonth, spendAgg] = await Promise.all([
    prisma.client.count({ where: { isActive: true, archivedAt: null } }),
    prisma.client.count({ where: { archivedAt: null } }),
    prisma.payment.aggregate({
      _sum: { amountDue: true },
      where: { status: "PAID", paidDate: { gte: monthStart } },
    }),
    prisma.session.count({
      where: { status: "COMPLETED", scheduledAt: { gte: monthStart } },
    }),
    prisma.adSpendDaily.aggregate({
      _sum: { spend: true },
      where: { date: { gte: monthStart } },
    }),
  ]);

  const revenueThisMonth = Number(revenueAgg._sum.amountDue ?? 0);
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
