import { prisma } from "@/lib/prisma";
import { getDashboardKpis, getNeedsAction } from "@/lib/needs-action";
import { getRevenueTrend } from "@/lib/dashboard-data";
import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import RevenueChart from "@/components/RevenueChart";
import PortfolioTable from "@/components/PortfolioTable";
import CallBoard, { type BoardRow } from "@/components/CallBoard";
import { ACTIVE_CLIENT } from "@/lib/am-calls";
import { getClientsHealth } from "@/lib/client-health";
import { sydneyDay } from "@/lib/sheet-parse";

export const dynamic = "force-dynamic";

const SEVERITY_STYLE: Record<string, { color: string; bg: string; icon: string }> = {
  danger: { color: "var(--danger)", bg: "var(--danger-tint)", icon: "priority_high" },
  success: { color: "var(--primary)", bg: "var(--primary-tint)", icon: "check_circle" },
  muted: { color: "var(--text-secondary)", bg: "var(--surface-hover)", icon: "schedule" },
};

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const user = await requireUser();
  // This dashboard is an agency-wide overview (all clients, all revenue) —
  // a client login gets sent straight to their own portal instead.
  if (user.role === "CLIENT") {
    const client = await prisma.client.findUnique({ where: { id: user.clientId ?? "" }, select: { slug: true } });
    redirect(client ? `/clients/${client.slug}` : "/login");
  }

  const kpis = await getDashboardKpis();
  // The portfolio picker's "Maximum" starts at the earliest data.
  const firstLead = await prisma.lead.findFirst({ where: { deletedAt: null, client: { archivedAt: null } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  const trend = await getRevenueTrend(12);
  const allItems = await getNeedsAction();
  // One card per client — their most urgent item (list is already sorted by urgency).
  const seenClients = new Set<string>();
  const items = allItems.filter((i) => !seenClients.has(i.clientId) && seenClients.add(i.clientId)).slice(0, 8);

  // The call board: active clients with an account manager.
  const now = new Date();
  const boardClients = await prisma.client.findMany({
    where: { ...ACTIVE_CLIENT, accountManagerId: { not: null } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true, callDay: true, callTime: true, accountManager: { select: { name: true } } },
  });
  const boardIds = boardClients.map((c) => c.id);
  const [nextCalls, overdueCalls, noted, boardHealth] = await Promise.all([
    prisma.amCall.findMany({ where: { clientId: { in: boardIds }, status: "PENDING", scheduledAt: { gt: now } }, orderBy: { scheduledAt: "asc" }, distinct: ["clientId"], select: { id: true, clientId: true, scheduledAt: true } }),
    prisma.amCall.findMany({ where: { clientId: { in: boardIds }, status: "PENDING", scheduledAt: { lte: now } }, orderBy: { scheduledAt: "asc" }, distinct: ["clientId"], select: { id: true, clientId: true, scheduledAt: true } }),
    prisma.amCall.groupBy({ by: ["clientId"], where: { clientId: { in: boardIds }, status: { in: ["HELD", "NOT_HELD"] }, OR: [{ summary: { not: null } }, { internalNotes: { not: null } }] }, _count: true }),
    getClientsHealth(boardIds, { now }),
  ]);
  const at = (c?: { id: string; scheduledAt: Date }) => (c ? { id: c.id, at: c.scheduledAt.toISOString() } : null);
  const board: BoardRow[] = boardClients.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    am: c.accountManager?.name ?? null,
    callDay: c.callDay,
    callTime: c.callTime,
    next: at(nextCalls.find((n) => n.clientId === c.id)),
    overdue: at(overdueCalls.find((n) => n.clientId === c.id)),
    notes: noted.find((n) => n.clientId === c.id)?._count ?? 0,
    health: boardHealth.get(c.id)!,
  }));

  const lastMonth = trend.at(-2)?.revenue ?? 0;
  const delta = lastMonth > 0 ? Math.round(((kpis.revenueThisMonth - lastMonth) / lastMonth) * 100) : null;

  return (
    <div className="p-10 max-w-[1400px] mx-auto space-y-10">
      <div>
        <h1 className="page-title font-heading" style={{ color: "var(--text-primary)" }}>
          {greeting()}, {user.name.split(" ")[0]}.
        </h1>
        <p className="text-base mt-1" style={{ color: "var(--text-secondary)" }}>Here's how the agency is doing.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <KpiCard icon="payments" label="Revenue this month" value={`$${kpis.revenueThisMonth.toLocaleString()}`} delta={delta === null ? undefined : `${delta >= 0 ? "+" : ""}${delta}%`} />
        <KpiCard icon="diversity_3" label="Active clients" value={String(kpis.activeClients)} sub={`${kpis.totalClients} total`} />
        <KpiCard icon="trending_up" label="Avg. retention" value={kpis.totalClients > 0 ? `${Math.round((kpis.activeClients / kpis.totalClients) * 100)}%` : "0%"} />
      </div>

      <div>
        <div className="text-xs font-bold tracking-widest mb-3" style={{ color: "var(--text-secondary)" }}>NEEDS ACTION</div>
        <div className="grid grid-cols-4 gap-3">
          {items.length === 0 && (
            <div className="card rounded-xl p-4 text-center col-span-4" style={{ color: "var(--text-secondary)" }}>
              Nothing needs attention right now.
            </div>
          )}
          {items.map((item) => {
            const s = SEVERITY_STYLE[item.severity] ?? SEVERITY_STYLE.muted;
            return (
              <Link key={item.id} href={`/clients/${item.clientSlug}`} className="card rounded-xl p-3 flex items-center gap-3">
                <span className="icon-chip w-8 h-8" style={{ background: s.bg }}>
                  <span className="material-symbols-outlined text-[16px]" style={{ color: s.color }}>{s.icon}</span>
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate" style={{ color: "var(--text-primary)" }}>{item.title}</p>
                  <p className="text-xs truncate" style={{ color: s.color }}>{item.description}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <div>
        <div className="text-xs font-bold tracking-widest mb-3" style={{ color: "var(--text-secondary)" }}>CLIENT CALLS</div>
        <CallBoard rows={board} />
      </div>

      <div className="card rounded-2xl p-6">
        <div className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>Revenue (Last 12 Months)</div>
        <RevenueChart trend={trend} />
      </div>

      {/* One row per client, at-risk first — replaces the old client cards. */}
      <PortfolioTable maxFrom={firstLead ? sydneyDay(firstLead.createdAt) : null} />
    </div>
  );
}

function KpiCard({ icon, label, value, delta, sub }: { icon: string; label: string; value: string; delta?: string; sub?: string }) {
  return (
    <div className="card rounded-2xl p-5">
      <div className="flex justify-between items-start mb-3">
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{label}</p>
        <span className="icon-chip w-8 h-8" style={{ background: "var(--primary-tint)" }}>
          <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--primary)" }}>{icon}</span>
        </span>
      </div>
      <div className="flex items-end justify-between">
        <p className="font-heading text-3xl font-bold" style={{ color: "var(--text-primary)" }}>{value}</p>
        {delta && <span className="text-xs font-bold" style={{ color: "var(--primary)" }}>{delta}</span>}
      </div>
      {sub && <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{sub}</p>}
    </div>
  );
}
