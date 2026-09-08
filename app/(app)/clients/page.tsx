import { prisma } from "@/lib/prisma";
import { createClient, bulkUpdateClientStatus } from "@/lib/actions";
import { requireCoach } from "@/lib/auth";
import AddClientModal from "./AddClientModal";
import ClientsGrid from "./ClientsGrid";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  await requireCoach(); // client logins are redirected to their own client page, never this list

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [clients, programs] = await Promise.all([
    prisma.client.findMany({
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
            All clients across {programs.map((p) => p.name).join(", ")}.
          </p>
        </div>
        <AddClientModal action={createClient} />
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
      />
    </div>
  );
}
