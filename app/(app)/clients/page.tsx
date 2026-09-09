import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createClient, bulkUpdateClientStatus, archiveClient, unarchiveClient } from "@/lib/actions";
import { requireCoach } from "@/lib/auth";
import AddClientModal from "./AddClientModal";
import ClientsGrid from "./ClientsGrid";

export const dynamic = "force-dynamic";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: { archived?: string };
}) {
  await requireCoach(); // client logins are redirected to their own client page, never this list

  const showArchived = searchParams.archived === "1";
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [clients, programs] = await Promise.all([
    prisma.client.findMany({
      where: showArchived ? { archivedAt: { not: null } } : { archivedAt: null },
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
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="page-title font-heading" style={{ color: "var(--text-primary)" }}>Clients</h1>
          <p className="text-base mt-1" style={{ color: "var(--text-secondary)" }}>
            {showArchived ? "Archived clients." : `All clients across ${programs.map((p) => p.name).join(", ")}.`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={showArchived ? "/clients" : "/clients?archived=1"}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold"
            style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            <span className="material-symbols-outlined text-[18px]">{showArchived ? "arrow_back" : "archive"}</span>
            {showArchived ? "Back to active clients" : "View archived"}
          </Link>
          {!showArchived && <AddClientModal action={createClient} />}
        </div>
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
        archivedView={showArchived}
      />
    </div>
  );
}
