import { prisma } from "./prisma";

// 6-month revenue vs ad spend trend, aggregated across the whole agency
export async function getRevenueVsSpendTrend() {
  const now = new Date();
  const months: { label: string; start: Date; end: Date }[] = [];
  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    months.push({
      label: start.toLocaleDateString("en-US", { month: "short" }).toUpperCase(),
      start,
      end,
    });
  }

  const revenue: number[] = [];
  const spend: number[] = [];

  for (const m of months) {
    const [rev, sp] = await Promise.all([
      prisma.revenueMonthly.aggregate({ _sum: { amount: true }, where: { month: m.start } }),
      prisma.adSpendDaily.aggregate({
        _sum: { spend: true },
        where: { date: { gte: m.start, lt: m.end } },
      }),
    ]);
    revenue.push(Number(rev._sum.amount ?? 0));
    spend.push(Number(sp._sum.spend ?? 0));
  }

  return { labels: months.map((m) => m.label), revenue, spend };
}

// Ranks clients by ROAS this month for the "Top performing clients" table
export async function getTopPerformingClients(limit = 5) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const clients = await prisma.client.findMany({ where: { isActive: true } });

  const rows = await Promise.all(
    clients.map(async (client) => {
      const [revenue, spend, leadCount] = await Promise.all([
        prisma.revenueMonthly.findFirst({ where: { clientId: client.id, month: monthStart } }),
        prisma.adSpendDaily.aggregate({
          _sum: { spend: true },
          where: { clientId: client.id, date: { gte: monthStart } },
        }),
        prisma.lead.count({ where: { clientId: client.id, createdAt: { gte: monthStart } } }),
      ]);
      const rev = Number(revenue?.amount ?? 0);
      const sp = Number(spend._sum.spend ?? 0);
      return {
        id: client.id,
        name: client.name,
        slug: client.slug,
        roas: sp > 0 ? rev / sp : 0,
        conversions: leadCount,
      };
    })
  );

  return rows.sort((a, b) => b.roas - a.roas).slice(0, limit);
}

// Last N days of ad spend for a client — feeds sparklines on the client detail page
export async function getClientDailySpend(clientId: string, days = 10) {
  const start = new Date(Date.now() - days * 86400000);
  const rows = await prisma.adSpendDaily.findMany({
    where: { clientId, date: { gte: start } },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => Number(r.spend));
}

// Daily ad spend across the agency (or one client) for the bar chart
export async function getAgencyDailySpend(days = 30, clientId?: string) {
  const start = new Date(Date.now() - days * 86400000);
  const rows = await prisma.adSpendDaily.findMany({
    where: { date: { gte: start }, ...(clientId ? { clientId } : {}) },
    orderBy: { date: "asc" },
  });
  const byDate = new Map<string, number>();
  for (const r of rows) {
    const key = r.date.toISOString().slice(0, 10);
    byDate.set(key, (byDate.get(key) ?? 0) + Number(r.spend));
  }
  return Array.from(byDate.entries()).map(([date, spend]) => ({ date, spend }));
}

// Lead source breakdown (for the "channel allocation" visual) — real data
export async function getLeadSourceBreakdown(clientId?: string) {
  const leads = await prisma.lead.findMany({
    where: clientId ? { clientId } : {},
    select: { source: true },
  });
  const counts = new Map<string, number>();
  for (const l of leads) {
    const key = l.source ?? "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = leads.length || 1;
  return Array.from(counts.entries())
    .map(([source, count]) => ({ source, count, pct: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count);
}

// Report summary card numbers, scoped to one client or the whole agency
export async function getReportSummary(clientId?: string) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const where = clientId ? { clientId } : {};

  const [totalLeads, wonLeads, spendAgg] = await Promise.all([
    prisma.lead.count({ where: { ...where, createdAt: { gte: monthStart } } }),
    prisma.lead.count({ where: { ...where, status: "won", createdAt: { gte: monthStart } } }),
    prisma.adSpendDaily.aggregate({ _sum: { spend: true }, where: { ...where, date: { gte: monthStart } } }),
  ]);

  const totalSpend = Number(spendAgg._sum.spend ?? 0);
  const conversionRate = totalLeads > 0 ? (wonLeads / totalLeads) * 100 : 0;
  const avgCac = wonLeads > 0 ? totalSpend / wonLeads : 0;

  return { totalLeads, wonLeads, totalSpend, conversionRate, avgCac };
}

// Lead funnel counts by stage for a client
export async function getLeadFunnel(clientId: string) {
  const statuses = ["new", "contacted", "qualified", "won"] as const;
  const counts = await Promise.all(
    statuses.map((status) => prisma.lead.count({ where: { clientId, status } }))
  );
  return statuses.map((status, i) => ({ status, count: counts[i] }));
}
