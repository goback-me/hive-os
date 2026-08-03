import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/actions";
import AddClientModal from "./AddClientModal";

export default async function ClientsPage() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const clients = await prisma.client.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { needsActionItems: true } },
      revenueMonthly: { where: { month: monthStart }, take: 1 },
    },
  });

  const maxRevenue = Math.max(...clients.map((c) => Number(c.revenueMonthly[0]?.amount ?? 0)), 1);
  const activeCount = clients.filter((c) => c.isActive).length;
  const inactiveCount = clients.length - activeCount;

  return (
    <div className="p-margin-desktop">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-lg mb-xl">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-primary">Client directory</h2>
          <p className="font-body-md text-on-surface-variant mt-xs">Manage your active accounts and agency partnerships.</p>
        </div>
        <AddClientModal action={createClient} />
      </div>

      <div className="flex flex-wrap items-center gap-md bg-white p-md rounded-2xl border border-primary/10 mb-lg">
        <div className="flex items-center gap-sm px-md py-sm bg-surface-container rounded-lg">
          <span className="material-symbols-outlined text-body-md">filter_list</span>
          <span className="font-label-md">Status: All</span>
        </div>
        <div className="h-6 w-px bg-outline-variant mx-xs" />
        <div className="flex gap-xs">
          <span className="px-md py-xs bg-primary-container text-white rounded-full font-label-sm">Active ({activeCount})</span>
          <span className="px-md py-xs bg-surface-variant text-on-surface-variant rounded-full font-label-sm">Inactive ({inactiveCount})</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-gutter">
        {clients.map((client) => {
          const revenue = Number(client.revenueMonthly[0]?.amount ?? 0);
          const pct = Math.round((revenue / maxRevenue) * 100);
          const needsAction = client._count.needsActionItems;

          return (
            <Link key={client.id} href={`/clients/${client.slug}`} className="bg-white p-lg rounded-2xl border border-primary/10 hover:shadow-lg hover:shadow-primary/5 transition-all block">
              <div className="flex justify-between items-start mb-lg">
                <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center font-bold text-primary border border-outline-variant">
                  {client.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex flex-col items-end gap-xs">
                  <span className={`px-md py-xs rounded-full text-label-sm font-bold flex items-center gap-xs ${client.isActive ? "bg-[#e7f5ed] text-[#0d5c31]" : "bg-surface-variant text-on-surface-variant"}`}>
                    <span className={`w-2 h-2 rounded-full ${client.isActive ? "bg-[#0d5c31]" : "bg-outline"}`} />
                    {client.isActive ? "Active" : "Inactive"}
                  </span>
                  {needsAction > 0 && (
                    <span className="bg-secondary/10 text-secondary px-md py-xs rounded-full text-label-sm font-bold flex items-center gap-xs">
                      <span className="material-symbols-outlined text-[14px]">warning</span>
                      Needs action
                    </span>
                  )}
                </div>
              </div>
              <h3 className="font-headline-sm text-on-surface mb-xs">{client.name}</h3>
              <p className="text-label-sm text-outline mb-lg">{client.slug}.client.hivesocial.agency</p>
              <div className="space-y-sm">
                <div className="flex justify-between text-label-sm">
                  <span className="text-on-surface-variant">Monthly revenue</span>
                  <span className="font-bold text-primary">${revenue.toLocaleString()}</span>
                </div>
                <div className="h-2 w-full bg-surface-container rounded-full overflow-hidden">
                  <div className="h-full bg-primary-container rounded-full" style={{ width: `${pct}%` }} />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
