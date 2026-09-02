import { prisma } from "./prisma";

const RENEWAL_WINDOW_DAYS = 14;
const NO_CONTACT_DAYS = 10;

function daysBetween(a: Date, b: Date) {
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

// Wipes and rebuilds the NeedsActionItem cache table.
// Run this on a cron (e.g. every 15 min or daily at minimum).
export async function computeNeedsAction() {
  const now = new Date();
  const clients = await prisma.client.findMany({ where: { isActive: true } });

  const items: Array<{
    clientId: string;
    type: string;
    severity: string;
    title: string;
    description: string;
    amount?: number;
    daysDelta?: number;
  }> = [];

  for (const client of clients) {
    // 1. Overdue payments
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

    // 2. Expired contracts
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

    // 3. Upcoming renewals (within window, not yet expired)
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

    // 4. No contact in N+ days
    const lastContact = await prisma.contactLog.findFirst({
      where: { clientId: client.id },
      orderBy: { contactedAt: "desc" },
    });
    const sinceLastContact = lastContact ? daysBetween(now, lastContact.contactedAt) : Infinity;
    if (sinceLastContact >= NO_CONTACT_DAYS) {
      items.push({
        clientId: client.id,
        type: "no_contact",
        severity: "muted",
        title: client.name,
        description: lastContact ? `No call in ${sinceLastContact}+ days` : "No contact logged yet",
      });
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

// KPI aggregates for the top cards
export async function getDashboardKpis() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [revenueRows, spendRows, activeClients, totalClients] = await Promise.all([
    prisma.revenueMonthly.findMany({ where: { month: monthStart } }),
    prisma.adSpendDaily.aggregate({
      _sum: { spend: true },
      where: { date: { gte: monthStart } },
    }),
    prisma.client.count({ where: { isActive: true } }),
    prisma.client.count(),
  ]);

  const totalRevenue = revenueRows.reduce(
    (sum: number, r: { amount: import("@prisma/client").Prisma.Decimal }) => sum + Number(r.amount),
    0
  );
  const totalSpend = Number(spendRows._sum.spend ?? 0);
  const avgRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;

  return {
    revenueThisMonth: totalRevenue,
    activeClients,
    totalClients,
    totalAdSpend: totalSpend,
    avgRoas,
  };
}
