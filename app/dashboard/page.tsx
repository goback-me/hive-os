import { prisma } from "@/lib/prisma";
import { getDashboardKpis } from "@/lib/needs-action";
import { getRevenueVsSpendTrend, getTopPerformingClients } from "@/lib/dashboard-data";
import { toSparklinePath } from "@/lib/sparkline";
import Link from "next/link";

export default async function DashboardPage() {
  const kpis = await getDashboardKpis();
  const trend = await getRevenueVsSpendTrend();
  const topClients = await getTopPerformingClients(3);
  const items = await prisma.needsActionItem.findMany({
    orderBy: [{ severity: "asc" }, { computedAt: "desc" }],
    take: 3,
    include: { client: { select: { slug: true } } },
  });

  const ICON_MAP: Record<string, { icon: string; bg: string; color: string; badgeBg: string; badgeText: string; label: string }> = {
    danger: { icon: "payments", bg: "bg-error-container/20", color: "text-error", badgeBg: "bg-error-container", badgeText: "text-on-error-container", label: "Overdue" },
    warning: { icon: "event_repeat", bg: "bg-secondary-container/20", color: "text-secondary", badgeBg: "bg-secondary-container/30", badgeText: "text-on-secondary-container", label: "Renewal" },
    success: { icon: "event_repeat", bg: "bg-secondary-container/20", color: "text-secondary", badgeBg: "bg-secondary-container/30", badgeText: "text-on-secondary-container", label: "Renewal" },
    muted: { icon: "person_off", bg: "bg-surface-container-highest", color: "text-outline", badgeBg: "bg-surface-container", badgeText: "text-on-surface-variant", label: "No contact" },
  };

  const chartW = 1000;
  const chartH = 300;
  const maxVal = Math.max(...trend.revenue, ...trend.spend, 1);
  const toXY = (arr: number[], i: number) => [(i / (arr.length - 1 || 1)) * chartW, chartH - (arr[i] / maxVal) * chartH];
  const path = (arr: number[]) =>
    arr.map((_, i) => { const [x, y] = toXY(arr, i); return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`; }).join(" ");
  const revenuePath = path(trend.revenue);
  const spendPath = path(trend.spend);

  return (
    <div className="max-w-[1440px] mx-auto p-margin-desktop space-y-xl">
      <section className="flex justify-between items-end">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-primary">Command dashboard</h2>
          <p className="font-body-md text-on-surface-variant">Real-time performance across all managed properties.</p>
        </div>
        <div className="flex gap-sm">
          <button className="px-lg py-sm rounded-lg border border-primary text-primary font-label-md hover:bg-primary/5 transition-colors flex items-center gap-xs">
            <span className="material-symbols-outlined text-[18px]">download</span>
            Export PDF
          </button>
          <Link href="/clients" className="px-lg py-sm rounded-lg bg-primary-container text-white font-label-md hover:opacity-90 transition-opacity flex items-center gap-xs">
            <span className="material-symbols-outlined text-[18px]">add</span>
            New client
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-gutter">
        <KpiCard label="Total revenue" value={`$${kpis.revenueThisMonth.toLocaleString()}`} delta="+12%" deltaTone="up" spark={trend.revenue} color="#4a2874" />
        <KpiCard label="Active clients" value={String(kpis.activeClients)} delta={`${kpis.totalClients} total`} deltaTone="neutral" spark={[kpis.activeClients - 2, kpis.activeClients - 1, kpis.activeClients]} color="#4a2874" />
        <KpiCard label="Total ad spend" value={`$${kpis.totalAdSpend.toLocaleString()}`} delta="+8%" deltaTone="up" spark={trend.spend} color="#f8b144" />
        <KpiCard label="Avg. ROAS" value={`${kpis.avgRoas.toFixed(1)}x`} delta="+0.4" deltaTone="up" spark={[kpis.avgRoas * 0.7, kpis.avgRoas * 0.85, kpis.avgRoas]} color="#4a2874" />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-12 gap-gutter">
        <div className="lg:col-span-8 custom-card p-lg">
          <div className="flex justify-between items-center mb-lg">
            <h4 className="font-headline-sm text-primary">Revenue vs ad spend</h4>
            <div className="flex items-center gap-md">
              <div className="flex items-center gap-xs"><span className="w-3 h-3 rounded-full bg-primary-container" /><span className="text-label-sm text-on-surface-variant">Revenue</span></div>
              <div className="flex items-center gap-xs"><span className="w-3 h-3 rounded-full bg-secondary" /><span className="text-label-sm text-on-surface-variant">Ad spend</span></div>
            </div>
          </div>
          <div className="h-[320px] w-full relative">
            <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none" viewBox={`0 0 ${chartW} ${chartH}`}>
              <path d={revenuePath} fill="none" stroke="#4a2874" strokeWidth="2.5" />
              <path d={spendPath} fill="none" stroke="#f8b144" strokeWidth="2.5" />
            </svg>
            <div className="absolute bottom-0 left-0 right-0 flex justify-between px-md text-label-sm text-on-surface-variant translate-y-6">
              {trend.labels.map((l) => <span key={l}>{l}</span>)}
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 flex flex-col gap-gutter">
          <h4 className="font-headline-sm text-primary flex items-center gap-xs px-xs">
            <span className="material-symbols-outlined text-error">warning</span>
            Needs action
          </h4>
          <div className="space-y-md">
            {items.length === 0 && (
              <div className="custom-card p-md text-center text-body-sm text-on-surface-variant">All clear — nothing needs attention.</div>
            )}
            {items.map((item) => {
              const s = ICON_MAP[item.severity] ?? ICON_MAP.muted;
              return (
                <Link key={item.id} href={`/clients/${item.client.slug}`} className="custom-card p-md flex items-center gap-md hover:border-primary/20 transition-all cursor-pointer block">
                  <div className={`w-12 h-12 rounded-lg ${s.bg} flex items-center justify-center ${s.color}`}>
                    <span className="material-symbols-outlined">{s.icon}</span>
                  </div>
                  <div className="flex-1">
                    <p className="font-label-md text-on-surface">{item.title}</p>
                    <p className="text-xs text-on-surface-variant">{item.description}</p>
                  </div>
                  <span className={`px-sm py-[2px] ${s.badgeBg} ${s.badgeText} text-[10px] rounded-full font-bold uppercase`}>{s.label}</span>
                </Link>
              );
            })}
          </div>
          <Link href="/clients" className="w-full py-sm text-center text-primary font-label-md hover:bg-primary/5 rounded-lg transition-colors border border-dashed border-primary/20 block">
            View all alerts
          </Link>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-primary/10 overflow-hidden">
        <div className="p-lg border-b border-outline-variant flex justify-between items-center">
          <h4 className="font-headline-sm text-primary">Top performing clients</h4>
          <Link href="/clients" className="text-primary text-label-sm font-bold hover:underline">View full leaderboard</Link>
        </div>
        <table className="w-full text-left">
          <thead className="bg-surface-container-low text-on-surface-variant font-label-sm uppercase tracking-wider text-[11px]">
            <tr>
              <th className="px-lg py-md">Client</th>
              <th className="px-lg py-md text-center">ROAS</th>
              <th className="px-lg py-md text-center">Conversions</th>
              <th className="px-lg py-md text-right">Trend</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant">
            {topClients.map((c) => (
              <tr key={c.id} className="hover:bg-surface-container-lowest transition-colors">
                <td className="px-lg py-md">
                  <Link href={`/clients/${c.slug}`} className="flex items-center gap-md">
                    <div className="h-10 w-10 rounded-lg bg-primary/5 flex items-center justify-center text-primary font-bold border border-outline-variant">
                      {c.name.slice(0, 1).toUpperCase()}
                    </div>
                    <p className="font-label-md text-on-surface">{c.name}</p>
                  </Link>
                </td>
                <td className="px-lg py-md text-center font-bold text-primary">{c.roas.toFixed(1)}x</td>
                <td className="px-lg py-md text-center font-label-md">{c.conversions}</td>
                <td className="px-lg py-md text-right">
                  <span className={`material-symbols-outlined ${c.roas >= 2 ? "text-green-600" : "text-secondary"}`}>
                    {c.roas >= 2 ? "trending_up" : "trending_flat"}
                  </span>
                </td>
              </tr>
            ))}
            {topClients.length === 0 && (
              <tr><td colSpan={4} className="px-lg py-md text-on-surface-variant">No client data yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function KpiCard({ label, value, delta, deltaTone, spark, color }: { label: string; value: string; delta: string; deltaTone: "up" | "down" | "neutral"; spark: number[]; color: string }) {
  const toneColor = deltaTone === "up" ? "text-green-600" : deltaTone === "down" ? "text-error" : "text-primary";
  const path = toSparklinePath(spark.length ? spark : [0, 0], 100, 40);
  return (
    <div className="custom-card p-lg flex flex-col justify-between">
      <div className="flex justify-between items-start mb-sm">
        <p className="font-label-md text-on-surface-variant uppercase tracking-wider text-[10px]">{label}</p>
        <span className={`${toneColor} font-label-sm flex items-center`}>{delta}</span>
      </div>
      <div className="flex justify-between items-end">
        <h3 className="font-headline-md text-primary">{value}</h3>
        <svg width="96" height="40" viewBox="0 0 100 40">
          <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
