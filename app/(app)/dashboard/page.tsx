import { prisma } from "@/lib/prisma";
import { getDashboardKpis } from "@/lib/needs-action";
import { getRevenueTrend } from "@/lib/dashboard-data";
import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import RevenueChart from "@/components/RevenueChart";

export const dynamic = "force-dynamic";

const SEVERITY_STYLE: Record<string, { color: string; bg: string; icon: string }> = {
  danger: { color: "var(--danger)", bg: "var(--danger-tint)", icon: "priority_high" },
  success: { color: "var(--primary)", bg: "var(--primary-tint)", icon: "check_circle" },
  muted: { color: "var(--text-secondary)", bg: "var(--surface-hover)", icon: "schedule" },
};

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  ACTIVE: { bg: "var(--primary-tint)", color: "var(--primary)", label: "Active" },
  ONBOARDING: { bg: "var(--surface-hover)", color: "var(--text-secondary)", label: "Onboarding" },
  CHURNED: { bg: "var(--danger-tint)", color: "var(--danger)", label: "Not Active" },
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
  const trend = await getRevenueTrend(12);
  const items = await prisma.needsActionItem.findMany({
    orderBy: [{ severity: "asc" }, { computedAt: "desc" }],
    take: 8,
    include: { client: { select: { slug: true } } },
  });
  const clients = await prisma.client.findMany({
    orderBy: { name: "asc" },
    include: { program: true },
    take: 12,
  });

  return (
    <div className="p-10 max-w-[1400px] mx-auto space-y-10">
      <div>
        <h1 className="page-title font-heading" style={{ color: "var(--text-primary)" }}>
          {greeting()}, {user.name.split(" ")[0]}.
        </h1>
        <p className="text-base mt-1" style={{ color: "var(--text-secondary)" }}>Here's how the agency is doing.</p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <KpiCard icon="payments" label="Revenue this month" value={`$${kpis.revenueThisMonth.toLocaleString()}`} delta="+8%" />
        <KpiCard icon="diversity_3" label="Active clients" value={String(kpis.activeClients)} sub={`${kpis.totalClients} total`} />
        <KpiCard icon="event_available" label="Sessions this month" value={String(kpis.sessionsThisMonth)} />
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
              <Link key={item.id} href={`/clients/${item.client.slug}`} className="card rounded-xl p-3 flex items-center gap-3">
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

      <div className="card rounded-2xl p-6">
        <div className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>Revenue (Last 12 Months)</div>
        <RevenueChart trend={trend} />
      </div>

      <div>
        <div className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Clients</div>
        <div className="grid grid-cols-3 gap-3">
          {clients.map((client) => {
            const s = STATUS_STYLE[client.status] ?? STATUS_STYLE.ONBOARDING;
            return (
              <Link key={client.id} href={`/clients/${client.slug}`} className="card rounded-xl p-4 block">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: "var(--primary-tint)", color: "var(--primary)" }}>
                      {client.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>{client.name}</p>
                      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{client.program?.name ?? "No program"}</p>
                    </div>
                  </div>
                  <span className="w-2 h-2 rounded-full mt-1" style={{ background: s.color }} />
                </div>
                <div className="flex justify-between items-end mt-3">
                  <div>
                    <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>Revenue this month</p>
                    <p className="font-bold" style={{ color: "var(--text-primary)" }}>$0</p>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ background: s.bg, color: s.color }}>
                    {s.label}
                  </span>
                </div>
              </Link>
            );
          })}
          {clients.length === 0 && <p style={{ color: "var(--text-secondary)" }}>No clients yet.</p>}
        </div>
      </div>
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
