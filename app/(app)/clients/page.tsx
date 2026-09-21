import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createClient, bulkUpdateClientStatus, archiveClient, unarchiveClient, deleteClientPermanently } from "@/lib/actions";
import { requireCoach } from "@/lib/auth";
import AddClientModal from "./AddClientModal";
import ClientsGrid from "./ClientsGrid";

export const dynamic = "force-dynamic";

type View = "active" | "not-active" | "archived";

const VIEW_WHERE: Record<View, object> = {
  active: { archivedAt: null, status: { not: "CHURNED" } },
  "not-active": { archivedAt: null, status: "CHURNED" },
  archived: { archivedAt: { not: null } },
};

const TABS: { key: View; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "not-active", label: "Not Active" },
  { key: "archived", label: "Archived" },
];

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: { view?: string };
}) {
  await requireCoach(); // client logins are redirected to their own client page, never this list

  const view: View = searchParams.view === "not-active" || searchParams.view === "archived" ? searchParams.view : "active";
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [clients, programs] = await Promise.all([
    prisma.client.findMany({
      where: VIEW_WHERE[view],
      orderBy: { name: "asc" },
      include: { program: true },
    }),
    prisma.program.findMany({ orderBy: { name: "asc" } }),
  ]);

  const revenueByClient = await Promise.all(
    clients.map((c) =>
      prisma.revenueMonthly.aggregate({
        _sum: { amount: true },
        where: { clientId: c.id, month: monthStart },
      })
    )
  );

  return (
    <div className="p-10 max-w-[1500px] mx-auto">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="page-title font-heading" style={{ color: "var(--text-primary)" }}>Clients</h1>
          <p className="text-base mt-1" style={{ color: "var(--text-secondary)" }}>
            {view === "active"
              ? `Active clients across ${programs.map((p) => p.name).join(", ")}.`
              : view === "not-active"
              ? "Not active clients — change status here to reactivate."
              : "Archived clients — unarchive or delete permanently."}
          </p>
        </div>
        {view === "active" && <AddClientModal action={createClient} />}
      </div>

      <div className="flex gap-2 mb-6">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "active" ? "/clients" : `/clients?view=${t.key}`}
            className="px-3 py-2 rounded-lg text-sm font-semibold"
            style={
              view === t.key
                ? { background: "var(--primary)", color: "#fff" }
                : { border: "1px solid var(--border)", color: "var(--text-secondary)" }
            }
          >
            {t.label}
          </Link>
        ))}
      </div>

      <ClientsGrid
        clients={clients.map((client, i) => ({
          id: client.id,
          slug: client.slug,
          name: client.name,
          description: client.description,
          status: client.status,
          programName: client.program?.name ?? null,
          revenue: Number(revenueByClient[i]._sum.amount ?? 0),
        }))}
        onBulkUpdateStatus={bulkUpdateClientStatus}
        onArchive={archiveClient}
        onUnarchive={unarchiveClient}
        onDeletePermanently={deleteClientPermanently}
        view={view}
      />
    </div>
  );
}
