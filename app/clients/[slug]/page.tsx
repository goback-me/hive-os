import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getClientDailySpend, getLeadFunnel } from "@/lib/dashboard-data";
import { toSparklinePath } from "@/lib/sparkline";
import Kanban from "@/components/Kanban";
import { toggleTask, createTask } from "@/lib/actions";

export default async function ClientDetailPage({ params }: { params: { slug: string } }) {
  const client = await prisma.client.findUnique({ where: { slug: params.slug } });
  if (!client) notFound();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [spendAgg, revenue, leadCount, tasks, dailySpend, funnel] = await Promise.all([
    prisma.adSpendDaily.aggregate({ _sum: { spend: true }, where: { clientId: client.id, date: { gte: monthStart } } }),
    prisma.revenueMonthly.findFirst({ where: { clientId: client.id, month: monthStart } }),
    prisma.lead.count({ where: { clientId: client.id, createdAt: { gte: monthStart } } }),
    prisma.task.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "asc" } }),
    getClientDailySpend(client.id, 10),
    getLeadFunnel(client.id),
  ]);

  const totalSpend = Number(spendAgg._sum.spend ?? 0);
  const totalRevenue = Number(revenue?.amount ?? 0);
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
        <MetricCard label="Ad spend" value={`$${totalSpend.toLocaleString()}`} suffix="/mo" spark={dailySpend} color="#4a2874" />
        <MetricCard label="Revenue" value={`$${totalRevenue.toLocaleString()}`} suffix="/mo" spark={[totalRevenue * 0.7, totalRevenue * 0.85, totalRevenue]} color="#f8b144" />
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
          <div className="custom-card p-lg">
            <div className="flex justify-between items-center mb-md">
              <h4 className="font-headline-sm text-primary">Ad review</h4>
              {client.swarmProjectId ? (
                <span className="px-2 py-1 bg-green-100 text-green-700 text-[10px] font-bold rounded uppercase">Connected</span>
              ) : (
                <span className="px-2 py-1 bg-surface-container text-on-surface-variant text-[10px] font-bold rounded uppercase">Not connected</span>
              )}
            </div>
            {client.swarmProjectId ? (
              <div className="p-md border border-outline-variant rounded-xl">
                <p className="text-body-sm font-bold">Swarm project</p>
                <p className="text-label-sm text-on-surface-variant">{client.swarmProjectId}</p>
              </div>
            ) : (
              <div className="p-lg flex flex-col items-center justify-center text-center gap-md min-h-[140px] border-2 border-dashed border-outline rounded-xl">
                <div className="w-12 h-12 rounded-full bg-surface-container-high flex items-center justify-center text-outline">
                  <span className="material-symbols-outlined">ads_click</span>
                </div>
                <p className="text-[12px] text-on-surface-variant max-w-[200px]">
                  Connect a Swarm project on this client to review ad creative here.
                </p>
              </div>
            )}
          </div>
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
