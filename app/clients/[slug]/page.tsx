import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getClientDailySpend, getLeadFunnel } from "@/lib/dashboard-data";
import { getMetaInsights } from "@/lib/meta-ads";
import { toSparklinePath } from "@/lib/sparkline";
import Kanban from "@/components/Kanban";
import MetaAdsCard from "@/components/MetaAdsCard";
import { toggleTask, createTask } from "@/lib/actions";

export default async function ClientDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const client = await prisma.client.findUnique({ where: { slug } });
  if (!client) notFound();

  const metaConnected = Boolean(client.metaAdAccountId && client.metaAccessToken);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [spendAgg, revenue, leadCount, tasks, dailySpend, funnel, metaInsights] = await Promise.all([
    prisma.adSpendDaily.aggregate({ _sum: { spend: true }, where: { clientId: client.id, date: { gte: monthStart } } }),
    prisma.revenueMonthly.findFirst({ where: { clientId: client.id, month: monthStart } }),
    prisma.lead.count({ where: { clientId: client.id, createdAt: { gte: monthStart } } }),
    prisma.task.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "asc" } }),
    getClientDailySpend(client.id, 10),
    getLeadFunnel(client.id),
    metaConnected
      ? getMetaInsights(client.metaAdAccountId!, client.metaAccessToken!).catch(() => null)
      : Promise.resolve(null),
  ]);

  // Meta, when connected, is live ground truth for spend/revenue — falls
  // back to the manually-entered DB tables when there's no connection yet,
  // or if the Meta call fails for some reason (expired token, API hiccup).
  const totalSpend = metaInsights ? metaInsights.spend : Number(spendAgg._sum.spend ?? 0);
  const totalRevenue = metaInsights?.revenue != null ? metaInsights.revenue : Number(revenue?.amount ?? 0);
  const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const maxFunnel = Math.max(...funnel.map((f) => f.count), 1);

  return (
    <div className="p-margin-desktop">
      <div className="mb-xl flex justify-between items-end">
        <div>
          <div className="flex items-center gap-sm text-on-surface-variant mb-xs">
            <span className="text-label-sm">Clients</span>
            <span className="material-symbols-outlined text-[14px]">chevron_right</span>
            <span className="text-label-sm font-bold text-primary">{client.name}</span>
          </div>
          <h2 className="font-headline-lg text-headline-lg text-primary">{client.name} performance</h2>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-gutter mb-xl">
        <MetricCard label="Ad spend" value={`$${totalSpend.toLocaleString()}`} suffix={metaConnected ? "/30d · Meta" : "/mo"} spark={dailySpend} color="#4a2874" />
        <MetricCard label="Revenue" value={`$${totalRevenue.toLocaleString()}`} suffix={metaConnected && metaInsights?.revenue != null ? "/30d · Meta" : "/mo"} spark={[totalRevenue * 0.7, totalRevenue * 0.85, totalRevenue]} color="#f8b144" />
        <MetricCard label="ROAS" value={`${roas.toFixed(2)}x`} spark={[roas * 0.7, roas * 0.9, roas]} color="#4a2874" />
        <MetricCard label="Total leads" value={String(leadCount)} spark={[leadCount * 0.8, leadCount * 0.95, leadCount]} color="#4a2874" />
      </div>

      <div className="mb-xl">
        <h4 className="font-headline-sm text-primary mb-md">Acquisition pipeline</h4>
        <div className="flex h-16 w-full gap-1">
          {funnel.map((stage, i) => {
            const isWon = i === funnel.length - 1;
            const pctOfFirst = funnel[0]?.count > 0 ? Math.round((stage.count / funnel[0].count) * 100) : 0;
            return (
              <div
                key={stage.status}
                className={`funnel-step flex-1 flex items-center justify-center border-y ${isWon ? "bg-[#f8b144] border-[#f8b144]/40" : "border-primary/20"}`}
                style={!isWon ? { backgroundColor: `rgba(74, 40, 116, ${0.1 + i * 0.08})` } : undefined}
              >
                <div className="text-center">
                  <span className={`block font-bold ${isWon ? "text-[#4a2874]" : "text-primary"}`}>
                    {stage.status.charAt(0).toUpperCase() + stage.status.slice(1)}
                  </span>
                  <span className={`text-xs ${isWon ? "text-[#4a2874]/80" : "text-on-surface-variant"}`}>
                    {stage.count} {i > 0 ? `(${pctOfFirst}%)` : "leads"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-gutter">
        <div className="col-span-12 lg:col-span-8">
          <Kanban
            clientId={client.id}
            initialTasks={tasks.map((t) => ({ id: t.id, title: t.title, status: t.status }))}
            onToggle={toggleTask}
            onCreate={createTask}
          />
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-gutter">
          <MetaAdsCard
            clientId={client.id}
            connected={Boolean(client.metaAdAccountId && client.metaAccessToken)}
            adAccountId={client.metaAdAccountId}
          />
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, suffix, spark, color }: { label: string; value: string; suffix?: string; spark: number[]; color: string }) {
  const path = toSparklinePath(spark.length ? spark : [0, 0], 100, 30);
  return (
    <div className="custom-card p-lg">
      <div className="flex justify-between items-start mb-md">
        <p className="text-on-surface-variant font-label-md">{label}</p>
      </div>
      <div className="flex items-baseline gap-xs mb-md">
        <h3 className="font-headline-md text-primary">{value}</h3>
        {suffix && <span className="text-on-surface-variant text-label-sm">{suffix}</span>}
      </div>
      <svg width="100%" height="30" viewBox="0 0 100 30" preserveAspectRatio="none">
        <path d={path} fill="none" stroke={color} strokeWidth="2" />
      </svg>
    </div>
  );
}