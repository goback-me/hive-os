import { prisma } from "@/lib/prisma";
import { getAgencyDailySpend, getLeadSourceBreakdown, getReportSummary } from "@/lib/dashboard-data";

const SOURCE_COLORS = ["#4a2874", "#f8b144", "#feb649", "#7c7481"];

export default async function ReportsPage({ searchParams }: { searchParams: { clientId?: string } }) {
  const clientId = searchParams.clientId || undefined;

  const [clients, summary, sourceBreakdown, dailySpend, recentReports] = await Promise.all([
    prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    getReportSummary(clientId),
    getLeadSourceBreakdown(clientId),
    getAgencyDailySpend(14, clientId),
    prisma.generatedReport.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { client: { select: { name: true } } },
    }),
  ]);

  const maxSpend = Math.max(...dailySpend.map((d) => d.spend), 1);
  const exportHref = `/api/reports/export${clientId ? `?clientId=${clientId}` : ""}`;

  return (
    <div className="max-w-[1440px] mx-auto p-margin-desktop space-y-xl">
      <section className="flex flex-wrap items-end justify-between gap-lg">
        <div className="flex flex-wrap items-end gap-md">
          <form className="flex items-end gap-sm" method="get">
            <div className="flex flex-col gap-xs">
              <label className="font-label-sm text-on-surface-variant px-1">Select client</label>
              <select
                name="clientId"
                defaultValue={clientId ?? ""}
                className="min-w-[240px] appearance-none bg-white border border-outline-variant rounded-xl px-md py-[10px] text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none cursor-pointer"
              >
                <option value="">All agency clients</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="px-md py-[10px] border border-outline-variant rounded-xl hover:bg-surface-container transition-colors font-label-md">
              View
            </button>
          </form>
        </div>
        <a
          href={exportHref}
          className="flex items-center gap-xs px-md py-2 bg-primary text-white rounded-lg font-label-md hover:opacity-90 transition-all"
        >
          <span className="material-symbols-outlined text-[20px]">download</span>
          Export CSV
        </a>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-gutter items-start">
        <div className="lg:col-span-2 bg-white border border-primary/10 rounded-2xl p-xl shadow-sm">
          <h2 className="font-headline-sm text-primary mb-xs">Executive performance summary</h2>
          <p className="font-body-md text-on-surface-variant mb-lg">This month's consolidated metrics.</p>
          <div className="grid grid-cols-3 gap-lg">
            <SummaryStat label="Conversion rate" value={`${summary.conversionRate.toFixed(1)}%`} />
            <SummaryStat label="Total spend" value={`$${summary.totalSpend.toLocaleString()}`} />
            <SummaryStat label="Avg. CAC" value={summary.wonLeads > 0 ? `$${summary.avgCac.toFixed(0)}` : "—"} />
          </div>
        </div>

        <div className="bg-white border border-primary/10 rounded-2xl p-lg shadow-sm">
          <h3 className="font-label-md text-on-surface-variant uppercase tracking-wider mb-lg">Lead source breakdown</h3>
          {sourceBreakdown.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">No lead data yet.</p>
          ) : (
            <ul className="space-y-sm">
              {sourceBreakdown.map((s, i) => (
                <li key={s.source} className="flex items-center justify-between text-body-sm">
                  <div className="flex items-center gap-sm">
                    <div className="w-3 h-3 rounded-full" style={{ background: SOURCE_COLORS[i % SOURCE_COLORS.length] }} />
                    <span className="capitalize">{s.source}</span>
                  </div>
                  <span className="font-bold">{s.pct}%</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="col-span-12 lg:col-span-3 bg-white border border-primary/10 rounded-2xl p-xl shadow-sm w-full">
          <h2 className="font-headline-sm text-primary mb-xs">Ad spend, last 14 days</h2>
          <div className="relative h-[220px] w-full flex items-end justify-between gap-2 px-md mt-lg">
            {dailySpend.length === 0 && (
              <p className="text-body-sm text-on-surface-variant m-auto">No ad spend recorded in this window.</p>
            )}
            {dailySpend.map((d) => (
              <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full bg-primary/20 hover:bg-primary/40 transition-all rounded-t-sm"
                  style={{ height: `${Math.max((d.spend / maxSpend) * 180, 2)}px` }}
                  title={`$${d.spend.toLocaleString()}`}
                />
                <span className="text-[10px] text-on-surface-variant">{d.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="col-span-12 lg:col-span-3 bg-white border border-primary/10 rounded-2xl overflow-hidden shadow-sm w-full">
          <div className="px-xl py-lg border-b border-outline-variant flex items-center justify-between">
            <h3 className="font-headline-sm text-primary">Recent exports</h3>
          </div>
          <table className="w-full text-left">
            <thead className="bg-surface-container-low">
              <tr>
                <th className="px-xl py-md font-label-sm text-on-surface-variant uppercase">Scope</th>
                <th className="px-xl py-md font-label-sm text-on-surface-variant uppercase">Period</th>
                <th className="px-xl py-md font-label-sm text-on-surface-variant uppercase">Generated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/30">
              {recentReports.map((r) => (
                <tr key={r.id} className="hover:bg-surface-container transition-colors">
                  <td className="px-xl py-md flex items-center gap-sm">
                    <span className="material-symbols-outlined text-primary">table_chart</span>
                    <span className="font-body-md text-on-surface font-medium">{r.client?.name ?? "All clients"}</span>
                  </td>
                  <td className="px-xl py-md text-on-surface-variant">{r.rangeLabel}</td>
                  <td className="px-xl py-md text-on-surface-variant">{r.createdAt.toLocaleString()}</td>
                </tr>
              ))}
              {recentReports.length === 0 && (
                <tr><td colSpan={3} className="px-xl py-lg text-on-surface-variant">No reports exported yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-md bg-surface-container-lowest rounded-xl border border-outline-variant/30">
      <p className="font-label-sm text-on-surface-variant uppercase tracking-wider mb-xs">{label}</p>
      <p className="font-display text-[32px] font-bold text-primary">{value}</p>
    </div>
  );
}
